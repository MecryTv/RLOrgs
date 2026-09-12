import path from "path";
import { unlink } from "node:fs/promises";
import { glob } from "glob";
import { pathToFileURL } from "node:url";
import { Collection } from "discord.js";
import BotClient from "../client/BotClient";
import Runnable from "../structures/Runnable";
import TaskTypes from "../enums/TaskTypes";
import IRunnable from "../interfaces/services/runnables/IRunnable";
import IRunnableService, { ITaskState } from "../interfaces/services/runnables/IRunnableService";
import { ParseDuration } from "../utils/duration";
import logger from "../utils/logger";

const TIME_ZONE = "Europe/Berlin";
const POLL_INTERVAL = 30_000;

const MAX_RETRIES = 3;
const RETRY_WINDOW = 15 * 60_000;
const RETRY_DELAY = RETRY_WINDOW / MAX_RETRIES;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})$/;

const ZONE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
});

interface IZonedParts {
    year: number;
    month: number;
    day: number;
    hours: number;
    minutes: number;
    seconds: number;
}

function ZonedParts(date: Date): IZonedParts {
    const parts = ZONE_FORMATTER.formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);

    return {
        year: value("year"),
        month: value("month"),
        day: value("day"),
        hours: value("hour") % 24,
        minutes: value("minute"),
        seconds: value("second"),
    };
}

function ZoneOffset(date: Date): number {
    const parts = ZonedParts(date);
    const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, parts.seconds);

    return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

function ZonedDate(year: number, month: number, day: number, hours: number, minutes: number): Date {
    const guess = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);

    const firstOffset = ZoneOffset(new Date(guess));
    const candidate = new Date(guess - firstOffset);
    const secondOffset = ZoneOffset(candidate);

    return secondOffset === firstOffset ? candidate : new Date(guess - secondOffset);
}

function ParseTime(value: string | null): { hours: number; minutes: number } | null {
    const match = TIME_PATTERN.exec(value?.trim() ?? "");
    if (!match) return null;

    return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function ParseDate(value: string | null): { day: number; month: number; year: number } | null {
    const match = DATE_PATTERN.exec(value?.trim() ?? "");
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
        return null;
    }

    return { day, month, year };
}

function FormatDate(date: Date | null): string {
    return date ? date.toLocaleString("de-DE", { timeZone: TIME_ZONE }) : "N/A";
}

// Der Zeitplan lebt im Prozess: nach einem Neustart wird jeder Task frisch eingeplant.
// Ein verpasster Termin wird also nicht nachgeholt - dafür braucht es keinen Speicher.
export default class RunnableService implements IRunnableService {
    client: BotClient;
    runnables: Collection<string, Runnable>;

    private tasks: Map<string, ITaskState>;
    private timer: NodeJS.Timeout | null = null;
    private processing = false;

    constructor(client: BotClient) {
        this.client = client;
        this.runnables = new Collection();
        this.tasks = new Map();
    }

    async Initialize(): Promise<void> {
        await this.LoadRunnables();

        const now = new Date();

        for (const runnable of this.runnables.values()) {
            const nextRun = this.CalculateNextRun(runnable, now);

            this.tasks.set(runnable.name, { nextRun, isRunning: false, retryCount: 0, lastRun: null });

            logger.tasks(`🆕 "${runnable.name}" eingeplant (${runnable.type} | Next Run: ${FormatDate(nextRun)})`);
        }

        this.timer = setInterval(() => {
            this.ProcessDueTasks().catch((error) => logger.error("[RunnableService] Poll failed", error));
        }, POLL_INTERVAL);

        this.timer.unref();

        logger.tasks(`🔄 RunnableService gestartet (Zeitzone ${TIME_ZONE}, Poll alle ${POLL_INTERVAL / 1000}s)`);
    }

    Stop(): void {
        if (!this.timer) return;

        clearInterval(this.timer);
        this.timer = null;

        logger.tasks("🛑 RunnableService gestoppt");
    }

    State(name: string): ITaskState | null {
        return this.tasks.get(name) ?? null;
    }

    async ProcessDueTasks(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        try {
            const now = Date.now();

            const due = [...this.tasks.entries()].filter(
                ([, task]) => !task.isRunning && task.nextRun !== null && task.nextRun.getTime() <= now
            );

            if (due.length === 0) return;

            logger.tasks(`🔎 ${due.length} fällige Task(s) gefunden`);

            for (const [name] of due) await this.RunTask(name);
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            logger.error(`[RunnableService] ProcessDueTasks: ${normalized.message}`);
        } finally {
            this.processing = false;
        }
    }

    async RunNow(name: string): Promise<boolean> {
        if (!this.runnables.has(name)) return false;

        await this.RunTask(name);
        return true;
    }

    CalculateNextRun(runnable: IRunnable, from: Date = new Date()): Date | null {
        switch (runnable.type) {
            case TaskTypes.DAILY: {
                const time = ParseTime(runnable.time);
                if (!time) return null;

                const today = ZonedParts(from);
                const next = ZonedDate(today.year, today.month, today.day, time.hours, time.minutes);
                if (next > from) return next;

                const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day) + 86_400_000);

                return ZonedDate(
                    tomorrow.getUTCFullYear(),
                    tomorrow.getUTCMonth() + 1,
                    tomorrow.getUTCDate(),
                    time.hours,
                    time.minutes
                );
            }

            case TaskTypes.ONCE: {
                const time = ParseTime(runnable.time);
                const date = ParseDate(runnable.date);
                if (!time || !date) return null;

                return ZonedDate(date.year, date.month, date.day, time.hours, time.minutes);
            }

            case TaskTypes.INTERVAL: {
                const duration = ParseDuration(runnable.expression);
                if (!duration) return null;

                return new Date(from.getTime() + duration);
            }

            default:
                return null;
        }
    }

    private ValidateSchedule(runnable: Runnable): string | null {
        switch (runnable.type) {
            case TaskTypes.DAILY:
                return ParseTime(runnable.time) ? null : `time muss "HH:MM" sein (ist: "${runnable.time}")`;

            case TaskTypes.ONCE:
                if (!ParseTime(runnable.time)) return `time muss "HH:MM" sein (ist: "${runnable.time}")`;
                return ParseDate(runnable.date) ? null : `date muss "DD.MM.YYYY" sein (ist: "${runnable.date}")`;

            case TaskTypes.INTERVAL:
                return ParseDuration(runnable.expression)
                    ? null
                    : `expression muss z.B. "30s", "5m", "2h" sein (ist: "${runnable.expression}")`;

            default:
                return `unbekannter Task-Typ "${runnable.type}"`;
        }
    }

    private async LoadRunnables(): Promise<void> {
        const files = await glob("**/*.{ts,js}", {
            cwd: path.join(__dirname, "../runnables"),
            absolute: true,
        });

        for (const file of files) {
            try {
                const imported = await import(pathToFileURL(file).href);
                const RunnableClass = imported.default?.default ?? imported.default;

                if (typeof RunnableClass !== "function") {
                    logger.error(`[RunnableService] Runnable at ${file} has no default export.`);
                    continue;
                }

                const runnable: Runnable = new RunnableClass(this.client);

                if (!runnable.name) {
                    logger.error(`[RunnableService] Runnable at ${file} is missing a name.`);
                    continue;
                }

                if (this.runnables.has(runnable.name)) {
                    logger.error(`[RunnableService] Duplicate runnable name "${runnable.name}" in ${file}.`);
                    continue;
                }

                const invalid = this.ValidateSchedule(runnable);
                if (invalid) {
                    logger.error(`[RunnableService] Runnable "${runnable.name}" hat einen ungültigen Zeitplan: ${invalid}`);
                    continue;
                }

                if (!runnable.enabled) {
                    logger.tasks(`⏸️  "${runnable.name}" ist deaktiviert und wird nicht eingeplant`);
                    continue;
                }

                if (await this.RetireIfExpired(file, runnable)) continue;

                this.runnables.set(runnable.name, runnable);
            } catch (error) {
                const normalized = error instanceof Error ? error : new Error(String(error));
                logger.error(`[RunnableService] Error while loading ${file}: ${normalized.message}`);
            }
        }

        logger.tasks(`📅 ${this.runnables.size} Runnables geladen`);
    }

    private async RetireIfExpired(file: string, runnable: Runnable): Promise<boolean> {
        if (runnable.type !== TaskTypes.ONCE) return false;

        const scheduled = this.CalculateNextRun(runnable);
        if (!scheduled || scheduled > new Date()) return false;

        logger.tasks(`🧾 "${runnable.name}" ist abgelaufen (Termin war ${FormatDate(scheduled)})`);
        logger.tasks(`   ↳ ${runnable.description}`);

        try {
            await unlink(file);
            logger.tasks(`🗑️  Runnable-Datei entfernt: ${path.basename(file)}`);
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            logger.error(`[RunnableService] Konnte "${path.basename(file)}" nicht löschen: ${normalized.message}`);
        }

        return true;
    }

    private async RunTask(name: string): Promise<void> {
        const runnable = this.runnables.get(name);
        const task = this.tasks.get(name);
        if (!runnable || !task || task.isRunning) return;

        task.isRunning = true;

        const startedAt = Date.now();
        const isOnce = runnable.type === TaskTypes.ONCE;

        try {
            logger.tasks(`🚀 Start Task: ${name} (${runnable.type})`);
            await runnable.Execute();

            task.nextRun = isOnce ? null : this.CalculateNextRun(runnable);
            task.lastRun = new Date();
            task.retryCount = 0;

            logger.tasks(
                `✅ Task "${name}" fertig in ${Date.now() - startedAt}ms | Next Run: ${FormatDate(task.nextRun)}`
            );
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            await this.HandleFailure(name, runnable, isOnce, task, normalized);
        } finally {
            task.isRunning = false;
        }
    }

    private async HandleFailure(
        name: string,
        runnable: Runnable,
        isOnce: boolean,
        task: ITaskState,
        error: Error
    ): Promise<void> {
        task.lastRun = new Date();
        task.retryCount += 1;

        if (task.retryCount <= MAX_RETRIES) {
            task.nextRun = new Date(Date.now() + RETRY_DELAY);

            logger.warn(
                `⚠️  Task "${name}" fehlgeschlagen (Versuch ${task.retryCount}/${MAX_RETRIES}): ${error.message} | Retry um ${FormatDate(task.nextRun)}`
            );

            return;
        }

        task.retryCount = 0;
        task.nextRun = isOnce ? null : this.CalculateNextRun(runnable);

        logger.error(
            `❌ Task "${name}" nach ${MAX_RETRIES} Retries in ${RETRY_WINDOW / 60_000} Minuten abgebrochen: ${error.message} | Next Run: ${FormatDate(task.nextRun)}`
        );

        await this.client.guardian.HandleRunnable(
            `Task "${name}" nach ${MAX_RETRIES} Retries abgebrochen: ${error.message}`,
            { taskName: name, stack: error.stack }
        );
    }
}
