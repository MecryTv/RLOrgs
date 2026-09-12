import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { LRUCache } from "lru-cache";
import { AttachmentBuilder } from "discord.js";
import BotClient from "../client/BotClient";
import { ISessionEntry } from "../interfaces/logger/ISessionManifest";
import IDevLogsService, {
    ILogFile,
    ILogPage,
    ILogStats,
    ISearchMatch,
    ISearchResult,
} from "../interfaces/services/devlogs/IDevLogsService";
import { Clamp, MAX_SEARCH_RESULTS, PAGE_SIZE, PagesFor, ResolveLogPath } from "../constants/DevLogs";
import logger from "../utils/logger";

export default class DevLogsService implements IDevLogsService {
    client: BotClient;

    // Ein Scan liest die ganze Datei - ohne Cache liefe er bei jedem Seitenklick erneut.
    private stats = new LRUCache<string, ILogStats>({ max: 50, ttl: 5 * 60_000 });

    constructor(client: BotClient) {
        this.client = client;
    }

    Sessions(): ISessionEntry[] {
        return logger.getSessionHistory();
    }

    ListPageOf(session: number): number {
        const index = this.Sessions().findIndex((entry) => entry.sessionNumber === session);

        return index === -1 ? 0 : Math.floor(index / logger.getSessionsPerPage());
    }

    async Resolve(session: number, part: number | null = null): Promise<ILogFile | null> {
        const entry = this.Sessions().find((candidate) => candidate.sessionNumber === session);
        if (!entry?.files.length) return null;

        const index = Clamp(part ?? entry.files.length - 1, entry.files.length - 1);
        const file = entry.files[index];
        const full = ResolveLogPath(logger.getSessionsDirectory(), file);
        if (!full) return null;

        const info = await stat(full).catch(() => null);
        if (!info?.isFile()) return null;

        return { entry, file, path: full, part: index, parts: entry.files.length, size: info.size };
    }

    async Stats(file: ILogFile): Promise<ILogStats> {
        const key = `${file.path}:${file.size}`;
        const cached = this.stats.get(key);
        if (cached) return cached;

        const text = await readFile(file.path, "utf8");

        const result: ILogStats = { lines: 0, errors: 0, warnings: 0, errorPages: [] };
        let offset = 0;

        for (const line of text.split("\n")) {
            result.lines++;

            if (line.includes("ERROR")) {
                result.errors++;

                // Die Seiten sind byteweise geschnitten - der Offset sagt, wo die Zeile landet.
                const page = Math.floor(offset / PAGE_SIZE);
                if (result.errorPages[result.errorPages.length - 1] !== page) result.errorPages.push(page);
            }

            if (line.includes("WARN")) result.warnings++;

            offset += Buffer.byteLength(line, "utf8") + 1;
        }

        this.stats.set(key, result);

        return result;
    }

    async Page(file: ILogFile, page: number): Promise<ILogPage> {
        const pages = PagesFor(file.size);
        const clamped = Clamp(page, pages - 1);
        const start = clamped * PAGE_SIZE;
        const length = Math.min(PAGE_SIZE, file.size - start);

        if (length <= 0) return { text: "", page: clamped, pages };

        const handle = await open(file.path, "r");

        try {
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, start);

            return { text: buffer.toString("utf8"), page: clamped, pages };
        } finally {
            await handle.close();
        }
    }

    async Search(file: ILogFile, term: string): Promise<ISearchResult> {
        const needle = term.toLowerCase();
        const matches: ISearchMatch[] = [];
        let total = 0;
        let line = 0;

        const reader = createInterface({
            input: createReadStream(file.path, { encoding: "utf8" }),
            crlfDelay: Infinity,
        });

        try {
            for await (const text of reader) {
                line++;
                if (!text.toLowerCase().includes(needle)) continue;

                total++;
                if (matches.length < MAX_SEARCH_RESULTS) matches.push({ line, text });
            }
        } finally {
            reader.close();
        }

        return { matches, total };
    }

    Attachment(file: ILogFile): AttachmentBuilder {
        return new AttachmentBuilder(file.path, { name: file.file });
    }
}
