import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

import LogLevel from "../enums/LogLevel";
import Colors, { AnsiCode, stripAnsi } from "../constants/Colors";
import ILogger, { IModuleDiffInput, LogArgs, ShutdownTask } from "../interfaces/logger/ILogger";
import ILoggerOptions from "../interfaces/logger/ILoggerOptions";
import ISessionManifest, { ISessionEntry } from "../interfaces/logger/ISessionManifest";

const DIVIDER_WIDTH = 60;

function emptyManifest(): ISessionManifest {
    return {
        totalRestarts: 0,
        lastStartedAt: null,
        lastEndedAt: null,
        lastCommandNames: [],
        lastEventFiles: [],
        lastFileHashes: {},
        sessions: [],
    };
}

export default class ChronicleLogger implements ILogger {
    public readonly colors = Colors;

    private readonly namespace: string;
    private readonly rootDirectory: string;
    private readonly logDirectory: string;
    private readonly sessionsDirectory: string;
    private readonly manifestPath: string;

    private readonly sessionsPerPage: number;
    private readonly maxLinesPerPart: number;
    private readonly maxBytesPerPart: number;
    private readonly shutdownTimeoutMs: number;
    private readonly reportVersionsOf: string[];
    private readonly scanExtensions: string[];
    private readonly scanExcludeDirs: string[];
    private readonly version: string;
    private readonly developer: string;
    private readonly engine: string;
    private readonly language: string;

    private currentLevel: LogLevel;
    private sessionTracking: boolean;

    private lineCount = 0;
    private byteCount = 0;
    private partNumber = 1;
    private sessionNumber = 0;

    private writeStream: fs.WriteStream | null = null;
    private currentSessionFile: string | null = null;
    private sessionStartedAt: Date | null = null;
    private manifest: ISessionManifest = emptyManifest();

    private ended = false;
    private shuttingDown = false;
    private readonly shutdownTasks: ShutdownTask[] = [];

    constructor(options: ILoggerOptions = {}) {
        this.namespace = options.namespace ?? "app";
        this.rootDirectory = options.rootDirectory ?? process.cwd();
        this.logDirectory = options.logDirectory ?? path.join(this.rootDirectory, "logs");
        this.sessionsDirectory = path.join(this.logDirectory, "sessions", this.namespace);
        this.manifestPath = path.join(
            this.logDirectory,
            `.session-manifest-${this.namespace}.json`,
        );

        this.sessionsPerPage = options.sessionsPerPage ?? 25;
        this.maxLinesPerPart = options.maxLinesPerPart ?? 20_000;
        this.maxBytesPerPart = options.maxBytesPerPart ?? 2 * 1024 * 1024;
        this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 8_000;
        this.reportVersionsOf = options.reportVersionsOf ?? [];
        this.scanExtensions = options.scanExtensions ?? [".ts", ".js", ".json"];
        this.scanExcludeDirs = options.scanExcludeDirs ?? [
            "node_modules",
            "dist",
            "build",
            ".git",
            "logs",
            "coverage",
        ];

        this.version = options.version ?? "1.0.0";
        this.developer = options.developer ?? "unknown";
        this.engine = options.engine ?? `Node.js ${process.version}`;
        this.language = options.language ?? "unknown";

        this.currentLevel = options.level ?? LogLevel.DEBUG;

        this.sessionTracking =
            options.sessionTracking ??
            (!process.env.NODE_TEST_CONTEXT && process.env.CHRONICLE_DISABLED !== "1");

        this.initialize();
    }

    private initialize(): void {
        try {
            if (!fs.existsSync(this.logDirectory)) {
                fs.mkdirSync(this.logDirectory, { recursive: true });
            }

            if (!this.sessionTracking) {
                this.manifest = this.loadManifest();
                return;
            }

            if (!fs.existsSync(this.sessionsDirectory)) {
                fs.mkdirSync(this.sessionsDirectory, { recursive: true });
            }

            this.manifest = this.loadManifest();
            this.sessionNumber = (this.manifest.totalRestarts || 0) + 1;
            this.sessionStartedAt = new Date();

            this.openSessionFile();
            this.writeSessionHeader();
            this.registerShutdownHooks();
        } catch (err) {
            console.error("Error initializing the Chronicle Logger:", err);
            this.sessionTracking = false;
        }
    }

    private loadManifest(): ISessionManifest {
        try {
            if (fs.existsSync(this.manifestPath)) {
                const parsed = JSON.parse(
                    fs.readFileSync(this.manifestPath, "utf8"),
                ) as Partial<ISessionManifest>;

                return { ...emptyManifest(), ...parsed };
            }
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            const backupPath = `${this.manifestPath}.corrupt-${Date.now()}`;
            try {
                fs.renameSync(this.manifestPath, backupPath);
                console.error(
                    `⚠️  Session-Manifest war unlesbar (${reason}). Gesichert als ${path.basename(backupPath)}, starte mit leerer Historie.`,
                );
            } catch (renameErr) {
                const renameReason =
                    renameErr instanceof Error ? renameErr.message : String(renameErr);
                console.error(
                    `⚠️  Session-Manifest war unlesbar (${reason}) und konnte nicht gesichert werden: ${renameReason}`,
                );
            }
        }
        return emptyManifest();
    }

    private saveManifest(): void {
        if (!this.sessionTracking) return;
        try {
            const tempPath = `${this.manifestPath}.${process.pid}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(this.manifest, null, 2));
            fs.renameSync(tempPath, this.manifestPath);
        } catch (err) {
            console.error("Error saving the session manifest:", err);
        }
    }

    private currentEntry(): ISessionEntry | undefined {
        return this.manifest.sessions.find((s) => s.sessionNumber === this.sessionNumber);
    }

    private sessionFileName(): string {
        const startedAt = this.sessionStartedAt ?? new Date();
        const timestamp = startedAt.toISOString().replace(/:/g, "-").split(".")[0];
        const partSuffix = this.partNumber > 1 ? `_part${this.partNumber}` : "";
        return `session-${this.sessionNumber}_${timestamp}${partSuffix}.log`;
    }

    private openSessionFile(): void {
        if (this.writeStream) this.writeStream.end();

        this.currentSessionFile = path.join(this.sessionsDirectory, this.sessionFileName());
        this.writeStream = fs.createWriteStream(this.currentSessionFile, { flags: "a" });
        this.writeStream.on("error", (err) => {
            console.error("Session log stream error:", err);
        });

        this.lineCount = 0;
        this.byteCount = 0;

        const entry = this.currentEntry();
        if (entry) {
            if (!Array.isArray(entry.files)) entry.files = [];
            entry.files.push(path.basename(this.currentSessionFile));
            this.saveManifest();
        }
    }

    private getGitCommitInternal(): string | null {
        try {
            return (
                execFileSync("git", ["rev-parse", "--short", "HEAD"], {
                    cwd: this.rootDirectory,
                    stdio: ["ignore", "pipe", "ignore"],
                })
                    .toString()
                    .trim() || null
            );
        } catch {
            return null;
        }
    }

    private getDependencyVersion(packageName: string): string {
        try {
            const pkgPath = path.join(
                this.rootDirectory,
                "node_modules",
                packageName,
                "package.json",
            );
            const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
            return parsed.version ?? "unknown";
        } catch {
            return "unknown";
        }
    }

    private formatDurationMs(ms: number): string | null {
        if (!Number.isFinite(ms) || ms < 0) return null;

        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const parts: string[] = [];
        if (hours) parts.push(`${hours}h`);
        if (minutes) parts.push(`${minutes}m`);
        parts.push(`${seconds}s`);
        return parts.join(" ");
    }

    private writeSessionHeader(): void {
        const startedAt = this.sessionStartedAt;
        if (!startedAt || !this.currentSessionFile) return;

        const hadPreviousSession = Boolean(this.manifest.lastStartedAt);
        const previousEndedCleanly = Boolean(this.manifest.lastEndedAt);
        const previousCrashed = hadPreviousSession && !previousEndedCleanly;

        const previousDuration =
            previousEndedCleanly && this.manifest.lastEndedAt && this.manifest.lastStartedAt
                ? this.formatDurationMs(
                      new Date(this.manifest.lastEndedAt).getTime() -
                          new Date(this.manifest.lastStartedAt).getTime(),
                  )
                : null;

        const gitCommit = this.getGitCommitInternal();
        const divider = "═".repeat(DIVIDER_WIDTH);

        const versionInfo = this.reportVersionsOf
            .map((pkg) => `${pkg}: v${this.getDependencyVersion(pkg)}`)
            .join("  |  ");

        const lines: Array<string | null> = [
            divider,
            `🚀 [${this.namespace.toUpperCase()}] SESSION #${this.sessionNumber} GESTARTET — ${this.getTimestamp()}`,
            divider,
            `PID: ${process.pid}  |  Node: ${process.version}${versionInfo ? `  |  ${versionInfo}` : ""}`,
            `Plattform: ${process.platform} (${process.arch})`,
            gitCommit ? `Git-Commit: ${gitCommit}` : null,
            `Neustarts insgesamt: ${this.sessionNumber}`,
            previousCrashed
                ? `⚠️  Vorherige Session (#${this.sessionNumber - 1}) wurde nicht sauber beendet — evtl. Absturz oder harter Kill.`
                : previousDuration
                  ? `⏱️  Vorherige Session lief: ${previousDuration}`
                  : null,
            divider,
        ];

        const headerText = lines.filter((line): line is string => line !== null).join("\n");

        console.log(`${this.colors.bright}${this.colors.cyan}${headerText}${this.colors.reset}`);
        this.appendRaw(headerText);

        this.manifest.lastStartedAt = startedAt.toISOString();
        this.manifest.lastEndedAt = null;
        this.manifest.totalRestarts = this.sessionNumber;

        if (!Array.isArray(this.manifest.sessions)) this.manifest.sessions = [];
        this.manifest.sessions.push({
            sessionNumber: this.sessionNumber,
            files: [path.basename(this.currentSessionFile)],
            startedAt: startedAt.toISOString(),
            endedAt: null,
            exitReason: null,
            crashed: false,
            commandCount: null,
            eventCount: null,
        });

        if (previousCrashed) {
            const previousEntry = this.manifest.sessions.find(
                (s) => s.sessionNumber === this.sessionNumber - 1,
            );
            if (previousEntry && !previousEntry.endedAt) previousEntry.crashed = true;
        }

        this.manifest.sessions.sort((a, b) => b.sessionNumber - a.sessionNumber);
        this.saveManifest();
    }

    public reportModuleDiff({ commandNames = [], eventFiles = [] }: IModuleDiffInput = {}): void {
        const isFirstEverSession =
            this.sessionNumber === 1 &&
            !this.manifest.lastCommandNames.length &&
            !this.manifest.lastEventFiles.length;

        const diffCounts = (
            previous: string[],
            current: string[],
        ): { added: number; removed: number } => {
            const previousSet = new Set(previous);
            const currentSet = new Set(current);
            return {
                added: current.filter((x) => !previousSet.has(x)).length,
                removed: previous.filter((x) => !currentSet.has(x)).length,
            };
        };

        const formatCountSuffix = ({ added, removed }: { added: number; removed: number }): string => {
            if (!added && !removed) return "";
            const parts: string[] = [];
            if (added) parts.push(`${this.colors.green}+${added} neu${this.colors.reset}`);
            if (removed) parts.push(`${this.colors.red}-${removed} entfernt${this.colors.reset}`);
            return `  (${parts.join(", ")})`;
        };

        const commandDiff = diffCounts(this.manifest.lastCommandNames, commandNames);
        const eventDiff = diffCounts(this.manifest.lastEventFiles, eventFiles);

        const lines: string[] = [
            `📦 Commands geladen: ${commandNames.length}${formatCountSuffix(commandDiff)}`,
            `🧩 Events geladen: ${eventFiles.length}${formatCountSuffix(eventDiff)}`,
            "─".repeat(DIVIDER_WIDTH),
        ];

        if (isFirstEverSession) {
            lines.unshift("👋 Erste getrackte Session — noch nichts zum Vergleichen vorhanden.");
        } else if (
            !commandDiff.added &&
            !commandDiff.removed &&
            !eventDiff.added &&
            !eventDiff.removed
        ) {
            lines.splice(2, 0, "✅ Keine Änderungen an Commands/Events seit der letzten Session.");
        }

        const consoleText = lines.join("\n");
        console.log(`${this.colors.cyan}${consoleText}${this.colors.reset}`);
        this.appendRaw(stripAnsi(consoleText));

        this.manifest.lastCommandNames = commandNames;
        this.manifest.lastEventFiles = eventFiles;

        const entry = this.currentEntry();
        if (entry) {
            entry.commandCount = commandNames.length;
            entry.eventCount = eventFiles.length;
        }

        this.saveManifest();
    }

    private hashFile(filePath: string): string {
        return crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");
    }

    private scanProjectFiles(rootDir: string): Record<string, string> {
        const result: Record<string, string> = {};

        const walk = (dir: string): void => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (this.scanExcludeDirs.includes(entry.name)) continue;
                    walk(path.join(dir, entry.name));
                } else if (this.scanExtensions.some((ext) => entry.name.endsWith(ext))) {
                    const fullPath = path.join(dir, entry.name);
                    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
                    result[relativePath] = this.hashFile(fullPath);
                }
            }
        };

        walk(rootDir);
        return result;
    }

    public reportFileChanges(): void {
        try {
            const scanRoot = path.join(this.rootDirectory, "src");
            const rootDir = fs.existsSync(scanRoot) ? scanRoot : this.rootDirectory;

            const currentHashes = this.scanProjectFiles(rootDir);
            const previousHashes = this.manifest.lastFileHashes;

            const previousPaths = new Set(Object.keys(previousHashes));
            const currentPaths = Object.keys(currentHashes);

            let added = 0;
            let removed = 0;
            let modified = 0;

            for (const p of currentPaths) {
                if (!previousPaths.has(p)) added++;
                else if (previousHashes[p] !== currentHashes[p]) modified++;
            }
            for (const p of previousPaths) {
                if (!(p in currentHashes)) removed++;
            }

            const isFirstEverScan = previousPaths.size === 0;
            const suffixParts: string[] = [];
            if (added) suffixParts.push(`${this.colors.green}+${added} neu${this.colors.reset}`);
            if (removed) suffixParts.push(`${this.colors.red}-${removed} entfernt${this.colors.reset}`);
            if (modified)
                suffixParts.push(`${this.colors.yellow}${modified} bearbeitet${this.colors.reset}`);
            const suffix = suffixParts.length ? `  (${suffixParts.join(", ")})` : "";

            const lines = [`📁 Sonstige Dateien: ${currentPaths.length}${suffix}`];
            if (isFirstEverScan) {
                lines.unshift("👋 Erste Datei-Erfassung — noch nichts zum Vergleichen vorhanden.");
            }

            const consoleText = lines.join("\n");
            console.log(`${this.colors.cyan}${consoleText}${this.colors.reset}`);
            this.appendRaw(stripAnsi(consoleText));

            this.manifest.lastFileHashes = currentHashes;
            this.saveManifest();
        } catch (err) {
            console.error("Error scanning project files for changes:", err);
        }
    }

    public beforeExit(task: ShutdownTask): void {
        this.shutdownTasks.push(task);
    }

    private finalize(signal: string): void {
        if (this.ended) return;
        this.ended = true;

        try {
            const endedAt = new Date();
            const duration = this.sessionStartedAt
                ? this.formatDurationMs(endedAt.getTime() - this.sessionStartedAt.getTime())
                : null;

            const divider = "═".repeat(DIVIDER_WIDTH);
            const footer = `\n${divider}\n🛑 [${this.namespace.toUpperCase()}] SESSION #${this.sessionNumber} BEENDET (${signal}) — Laufzeit: ${duration ?? "unbekannt"}\n${divider}\n`;

            console.log(`${this.colors.bright}${this.colors.yellow}${footer}${this.colors.reset}`);

            this.appendRawSync(footer);

            this.manifest.lastEndedAt = endedAt.toISOString();

            const entry = this.currentEntry();
            if (entry) {
                entry.endedAt = endedAt.toISOString();
                entry.exitReason = signal;
            }

            this.saveManifest();
        } catch {
        }
    }

    private registerShutdownHooks(): void {
        process.on("SIGINT", () => void this.shutdown("SIGINT"));
        process.on("SIGTERM", () => void this.shutdown("SIGTERM"));
        process.on("SIGHUP", () => void this.shutdown("SIGHUP"));
        
        if (process.platform === "win32") {
            process.on("SIGBREAK", () => void this.shutdown("SIGBREAK"));
        }
        process.on("exit", () => this.finalize("exit"));
    }

    private async shutdown(signal: string): Promise<never | void> {
        if (this.shuttingDown) {
            this.finalize(signal);
            return process.exit(130);
        }
        this.shuttingDown = true;

        try {
            await Promise.race([
                Promise.all(this.shutdownTasks.map((task) => task(signal))),
                new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, this.shutdownTimeoutMs);
                    timer.unref();
                }),
            ]);
        } catch (error) {
            console.error("Error during shutdown tasks:", error);
        }

        this.finalize(signal);
        process.exit(0);
    }

    private appendRaw(text: string): void {
        if (!this.writeStream) return;
        this.writeStream.write(`${text}\n`, (err) => {
            if (err) console.error("Error writing to the session log:", err);
        });
    }

    private appendRawSync(text: string): void {
        if (!this.currentSessionFile) return;
        try {
            fs.appendFileSync(this.currentSessionFile, `${stripAnsi(text)}\n`);
        } catch {
        }
    }

    private writeToFile(formattedMessage: string, ...args: LogArgs): void {
        if (!this.writeStream) return;

        const cleanMessage = stripAnsi(formattedMessage);
        const additionalArgs = args.length > 0 ? `\n${util.format(...args)}` : "";
        const line = `${cleanMessage}${additionalArgs}\n`;

        this.writeStream.write(line, (err) => {
            if (err) console.error("Error writing the log file:", err);
        });

        this.lineCount++;
        this.byteCount += Buffer.byteLength(line, "utf8");

        if (this.lineCount >= this.maxLinesPerPart || this.byteCount >= this.maxBytesPerPart) {
            const reason =
                this.lineCount >= this.maxLinesPerPart ? "Zeilenlimit" : "Größenlimit";
            this.partNumber++;
            this.openSessionFile();
            this.appendRaw(
                `↪️  Fortsetzung von Session #${this.sessionNumber}, Teil ${this.partNumber} (vorheriger Teil erreichte ${reason})`,
            );
        }
    }

    public getTimestamp(): string {
        const now = new Date();
        const date = now.toLocaleDateString("de-DE");
        const time = now.toLocaleTimeString("de-DE", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        return `${date} ${time}`;
    }

    private formatMessage(level: string, message: string, color: AnsiCode): string {
        const timestamp = this.getTimestamp();
        const levelStr = level.padEnd(8);
        return `${this.colors.gray}[${timestamp}]${this.colors.reset} ${color}${levelStr}${this.colors.reset} ${message}`;
    }

    private thresholdFor(level: string): LogLevel {
        const known: Record<string, LogLevel> = {
            ERROR: LogLevel.ERROR,
            WARN: LogLevel.WARN,
            INFO: LogLevel.INFO,
            DEBUG: LogLevel.DEBUG,
        };
        return known[level] ?? LogLevel.INFO;
    }

    public log(level: string, message: string, color: AnsiCode, ...args: LogArgs): void {
        const upperLevel = level.toUpperCase();
        if (this.currentLevel < this.thresholdFor(upperLevel)) return;

        const formatted = this.formatMessage(upperLevel, message, color);
        const consoleMethod =
            upperLevel === "ERROR" ? console.error : upperLevel === "WARN" ? console.warn : console.log;

        consoleMethod(formatted, ...args);
        this.writeToFile(formatted, ...args);
    }

    public error(message: string, ...args: LogArgs): void {
        this.log("error", message, this.colors.red, ...args);
    }

    public warn(message: string, ...args: LogArgs): void {
        this.log("warn", message, this.colors.yellow, ...args);
    }

    public info(message: string, ...args: LogArgs): void {
        this.log("info", message, this.colors.green, ...args);
    }

    public debug(message: string, ...args: LogArgs): void {
        this.log("debug", message, this.colors.blue, ...args);
    }

    public success(message: string, ...args: LogArgs): void {
        this.log("✓", message, `${this.colors.bright}${this.colors.green}`, ...args);
    }

    public server(message: string, ...args: LogArgs): void {
        this.log("server", message, this.colors.cyan, ...args);
    }

    public user(message: string, ...args: LogArgs): void {
        this.log("user", message, this.colors.magenta, ...args);
    }

    public tasks(message: string, ...args: LogArgs): void {
        this.log("tasks", message, `${this.colors.bright}${this.colors.blue}`, ...args);
    }

    public guardian(type: string, message: string, ...args: LogArgs): void {
        const upperType = type.toUpperCase();
        const color =
            upperType === "WARN"
                ? this.colors.yellow
                : upperType === "ERROR"
                  ? this.colors.red
                  : this.colors.cyan;
        this.log("guardian", `${upperType.padEnd(5)} | ${message}`, color, ...args);
    }

    public http(method: string, url: string, status: number, ...args: LogArgs): void {
        const color =
            status >= 200 && status < 300
                ? this.colors.green
                : status >= 400
                  ? this.colors.red
                  : this.colors.blue;
        this.log("http", `${method.padEnd(6)} ${url} → ${status}`, color, ...args);
    }

    public trace(functionName: string, step: string, data?: unknown): void {
        if (this.currentLevel < LogLevel.DEBUG) return;

        const formatted = this.formatMessage(
            "TRACE",
            `[${functionName}] -> ${step}`,
            this.colors.magenta,
        );
        console.log(formatted);
        this.writeToFile(formatted, data !== undefined ? JSON.stringify(data, null, 2) : "");
    }

    public setLevel(level: LogLevel | string): void {
        if (typeof level === "number") {
            this.currentLevel = level;
            return;
        }
        const resolved = LogLevel[level.toUpperCase() as keyof typeof LogLevel];
        if (resolved !== undefined) this.currentLevel = resolved;
    }

    public asciiBanner(color: AnsiCode = this.colors.cyan): void {
        const logo = [
            "███╗   ███╗████████╗██╗   ██╗",
            "████╗ ████║╚══██╔══╝██║   ██║",
            "██╔████╔██║   ██║   ██║   ██║",
            "██║╚██╔╝██║   ██║   ╚██╗ ██╔╝",
            "██║ ╚═╝ ██║   ██║    ╚████╔╝ ",
            "╚═╝     ╚═╝   ╚═╝     ╚═══╝  ",
        ];

        const rows = [
            `⭐️ Version: ${this.version}`,
            `⚡️ Engine: ${this.engine}`,
            `💻 Developer: ${this.developer}`,
            `🌐 Language: ${this.language}`,
        ];
        const innerWidth = Math.max(...rows.map((r) => r.length)) + 2;
        const border = "─".repeat(innerWidth);

        console.log();
        console.log(`${this.colors.bright}${color}${"▓".repeat(50)}${this.colors.reset}`);
        console.log();

        logo.forEach((line, index) => {
            const logoColor = index < 3 ? `${this.colors.bright}${color}` : color;
            console.log(`${logoColor}    ${line}${this.colors.reset}`);
        });

        console.log();
        console.log(`${this.colors.bright}${color}    ┌${border}┐${this.colors.reset}`);
        for (const row of rows) {
            const padding = " ".repeat(innerWidth - row.length - 1);
            console.log(`${color}    │ ${row}${padding}│${this.colors.reset}`);
        }
        console.log(`${this.colors.bright}${color}    └${border}┘${this.colors.reset}`);
        console.log();
        console.log(`${this.colors.bright}${color}${"▓".repeat(50)}${this.colors.reset}`);
        console.log();
    }

    public banner(message: string, color: AnsiCode = this.colors.cyan): void {
        const border = "=".repeat(message.length + 4);
        console.log(`${color}${border}\n  ${message}  \n${border}${this.colors.reset}`);
    }

    public box(message: string, color: AnsiCode = this.colors.blue): void {
        const lines = message.split("\n");
        const maxLength = Math.max(...lines.map((line) => line.length));
        const border = "─".repeat(maxLength + 2);

        console.log(`${color}┌${border}┐`);
        for (const line of lines) {
            console.log(`│ ${line}${" ".repeat(maxLength - line.length)} │`);
        }
        console.log(`└${border}┘${this.colors.reset}`);
    }

    public table(data: unknown, title: string | null = null): void {
        if (title) this.info(`📊 ${title}`);
        console.table(data);
    }

    public getSessionsDirectory(): string {
        return this.sessionsDirectory;
    }

    public getCurrentSessionNumber(): number {
        return this.sessionNumber;
    }

    public getCurrentSessionFile(): string | null {
        return this.currentSessionFile;
    }

    public getSessionHistory(): ISessionEntry[] {
        return [...this.manifest.sessions].sort((a, b) => b.sessionNumber - a.sessionNumber);
    }

    public getSessionsPerPage(): number {
        return this.sessionsPerPage;
    }

    public getSessionStartedAt(): Date | null {
        return this.sessionStartedAt;
    }

    public getGitCommit(): string | null {
        return this.getGitCommitInternal();
    }
}