import path from "path";
import { FSWatcher, watch } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { Collection, StringSelectMenuOptionBuilder } from "discord.js";
import BotClient from "../client/BotClient";
import IConfigEntry from "../interfaces/services/config/IConfigEntry";
import IConfigOption from "../interfaces/services/config/IConfigOption";
import IConfigPage from "../interfaces/services/config/IConfigPage";
import IConfigService, { ConfigChangeHandler } from "../interfaces/services/config/IConfigService";
import { CONFIG_SCHEMAS, ValidateEntry } from "../constants/ConfigSchemas";
import { SNOWFLAKE, MAX_DESCRIPTION, MAX_LABEL, MAX_SELECT_OPTIONS, MAX_VALUE } from "../constants/Discord";
import logger from "../utils/logger";

const EXTENSION = ".json";
const DEV_SUFFIX = ".dev.json";
const LEGACY_PAGINATION = "panigation";
const MAX_REPORTED_ERRORS = 5;
const WATCH_DEBOUNCE = 250;

export const CONFIG_ROOT = path.join(process.cwd(), "src", "config");

function IsPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function Merge(base: unknown, overlay: unknown): unknown {
    if (!IsPlainObject(base) || !IsPlainObject(overlay)) return overlay;

    const result: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(overlay)) {
        result[key] = key in base ? Merge(base[key], value) : value;
    }

    return result;
}

function MergeEntries(base: unknown, overlay: unknown): unknown {
    if (!Array.isArray(base) || !Array.isArray(overlay)) return overlay;

    return base.map((entry, index) => (index < overlay.length ? Merge(entry, overlay[index]) : entry));
}

function Freeze<T>(value: T): T {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;

    for (const item of Object.values(value as Record<string, unknown>)) Freeze(item);

    return Object.freeze(value);
}

function ToSelectOption(option: IConfigOption): StringSelectMenuOptionBuilder {
    const builder = new StringSelectMenuOptionBuilder()
        .setLabel(option.name.slice(0, MAX_LABEL))
        .setValue(option.value.slice(0, MAX_VALUE));

    if (option.description) builder.setDescription(option.description.slice(0, MAX_DESCRIPTION));
    if (option.emoji) builder.setEmoji(SNOWFLAKE.test(option.emoji) ? { id: option.emoji } : option.emoji);

    return builder;
}

export default class ConfigService implements IConfigService {
    client: BotClient;

    private configs: Collection<string, IConfigEntry[]>;
    private handlers: Set<ConfigChangeHandler>;
    private pending: Map<string, NodeJS.Timeout>;
    private watcher: FSWatcher | null = null;
    private root: string;
    private loaded = false;

    constructor(client: BotClient, root: string = CONFIG_ROOT) {
        this.client = client;
        this.configs = new Collection();
        this.handlers = new Set();
        this.pending = new Map();
        this.root = root;
    }

    get Root(): string {
        return this.root;
    }

    get Size(): number {
        return this.configs.size;
    }

    get Keys(): string[] {
        return [...this.configs.keys()];
    }

    get IsLoaded(): boolean {
        return this.loaded;
    }

    get IsWatching(): boolean {
        return this.watcher !== null;
    }

    async Initialize(): Promise<void> {
        const count = await this.Run(undefined, false);

        this.loaded = true;

        logger.info(`⚙️  ${count} Konfiguration(en) geladen${count > 0 ? ` (${this.Keys.join(", ")})` : ""}`);
    }

    async Reload(name?: string): Promise<number> {
        return this.Run(name, true);
    }

    Watch(): boolean {
        if (this.watcher) return false;

        try {
            this.watcher = watch(this.root, (_event, file) => this.Schedule(file));
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));

            this.Report(`Überwachung konnte nicht starten: ${normalized.message}`, "ConfigService Watch");

            return false;
        }

        this.watcher.on("error", (error) => {
            this.Report(`Überwachung abgebrochen: ${error.message}`, "ConfigService Watch");
            this.Unwatch();
        });

        this.watcher.unref();

        logger.info(`⚙️  Konfigurationen werden überwacht (${this.root})`);

        return true;
    }

    Unwatch(): void {
        for (const timer of this.pending.values()) clearTimeout(timer);
        this.pending.clear();

        if (!this.watcher) return;

        this.watcher.close();
        this.watcher = null;

        logger.info("⚙️  Überwachung der Konfigurationen beendet");
    }

    OnChange(handler: ConfigChangeHandler): () => void {
        this.handlers.add(handler);

        return () => {
            this.handlers.delete(handler);
        };
    }

    Has(key: string): boolean {
        return this.configs.has(key);
    }

    Get<T extends IConfigEntry = IConfigEntry>(key: string): T[] | null {
        const entries = this.configs.get(key);

        if (!entries) {
            this.Report(`Die Konfiguration mit dem Schlüssel "${key}" wurde nicht gefunden`, "ConfigService Get");
            return null;
        }

        return entries as T[];
    }

    GetOne<T extends IConfigEntry = IConfigEntry>(key: string): T | null {
        return this.Get<T>(key)?.[0] ?? null;
    }

    Require<T extends IConfigEntry = IConfigEntry>(key: string): T {
        const entry = this.configs.get(key)?.[0];

        if (!entry) throw new Error(`Die Konfiguration "${key}" fehlt oder ist leer.`);

        return entry as T;
    }

    Options(key: string, field: string): IConfigOption[] {
        const value = this.GetOne(key)?.[field];

        if (value === undefined) return [];

        if (!Array.isArray(value)) {
            this.Report(`"${field}" in ${key}${EXTENSION} ist keine Options-Liste`, "ConfigService Options");
            return [];
        }

        return value as IConfigOption[];
    }

    Option(key: string, field: string, value: string): IConfigOption | null {
        return this.Options(key, field).find((option) => option.value === value) ?? null;
    }

    Page(key: string, field: string, page = 1, size = MAX_SELECT_OPTIONS): IConfigPage {
        const options = this.Options(key, field);
        const paginated = this.configs.get(key)?.[0]?.pagination === true;

        const perPage = paginated ? Math.max(1, Math.min(Math.trunc(size), MAX_SELECT_OPTIONS)) : options.length || 1;
        const pages = Math.max(1, Math.ceil(options.length / perPage));
        const current = Math.min(Math.max(1, Math.trunc(page)), pages);
        const start = (current - 1) * perPage;

        return {
            options: options.slice(start, start + perPage),
            page: current,
            pages,
            total: options.length,
            hasPrevious: current > 1,
            hasNext: current < pages,
        };
    }

    SelectOptions(key: string, field: string, page?: number): StringSelectMenuOptionBuilder[] {
        const options = page === undefined ? this.Options(key, field) : this.Page(key, field, page).options;

        return options.slice(0, MAX_SELECT_OPTIONS).map(ToSelectOption);
    }

    Value<T>(key: string, route: string, fallback: T): T {
        let current: unknown = this.configs.get(key)?.[0];

        for (const segment of route.split(".")) {
            if (typeof current !== "object" || current === null) return fallback;

            current = (current as Record<string, unknown>)[segment];
        }

        return (current as T | undefined) ?? fallback;
    }

    private get IsDeveloper(): boolean {
        return this.client?.developerMode === true;
    }

    private async Run(name: string | undefined, emit: boolean): Promise<number> {
        const files = await readdir(this.root).catch(() => null);

        if (!files) {
            this.Report(`Das Konfigurationsverzeichnis (${this.root}) existiert nicht`, "ConfigService Init");
            return 0;
        }

        const names = files
            .filter((file) => file.endsWith(EXTENSION) && !file.endsWith(DEV_SUFFIX))
            .map((file) => path.basename(file, EXTENSION))
            .filter((entry) => !name || entry === name);

        if (name) this.configs.delete(name);
        else this.configs.clear();

        let loaded = 0;

        for (const entry of names) {
            if (!(await this.Load(entry))) continue;

            loaded++;

            if (emit) this.Emit(entry);
        }

        if (name && loaded > 0) logger.info(`⚙️  Konfiguration "${name}" neu geladen`);

        return loaded;
    }

    private async Load(name: string): Promise<boolean> {
        const base = await this.Read(`${name}${EXTENSION}`, false);

        if (base === undefined) return false;

        let parsed: unknown = base;

        if (this.IsDeveloper) {
            const overlay = await this.Read(`${name}${DEV_SUFFIX}`, true);

            if (overlay !== undefined) {
                parsed = MergeEntries(base, overlay);
                logger.info(`⚙️  ${name}${DEV_SUFFIX} wurde über ${name}${EXTENSION} gelegt`);
            }
        }

        const entries = this.Normalize(parsed, name);

        if (!entries) return false;

        const errors = entries.flatMap((entry, index) =>
            ValidateEntry(entry, CONFIG_SCHEMAS[name], `${name}[${index}]`)
        );

        if (errors.length > 0) {
            const shown = errors.slice(0, MAX_REPORTED_ERRORS).join("; ");
            const rest = errors.length > MAX_REPORTED_ERRORS ? ` (+${errors.length - MAX_REPORTED_ERRORS} weitere)` : "";

            this.Report(`${name}${EXTENSION} ist ungültig: ${shown}${rest}`, "ConfigService Validation");

            return false;
        }

        this.configs.set(name, Freeze(entries));

        return true;
    }

    private async Read(file: string, optional: boolean): Promise<unknown | undefined> {
        const content = await readFile(path.join(this.root, file), "utf-8").catch(() => null);

        if (content === null) {
            if (!optional) this.Report(`${file} konnte nicht gelesen werden`, "ConfigService Load");
            return undefined;
        }

        try {
            return JSON.parse(content);
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));

            this.Report(`${file} enthält kein gültiges JSON: ${normalized.message}`, "ConfigService Load");

            return undefined;
        }
    }

    private Normalize(parsed: unknown, name: string): IConfigEntry[] | null {
        if (!Array.isArray(parsed)) {
            this.Report(`Die Konfiguration in ${name}${EXTENSION} ist kein Array`, "ConfigService Validation");
            return null;
        }

        return parsed.map((item) => {
            if (!IsPlainObject(item)) return item as IConfigEntry;

            const entry = { ...item };

            if (!("pagination" in entry) && LEGACY_PAGINATION in entry) {
                entry.pagination = entry[LEGACY_PAGINATION];
                delete entry[LEGACY_PAGINATION];

                logger.warn(
                    `⚙️  ${name}${EXTENSION}: "${LEGACY_PAGINATION}" ist ein Tippfehler und wird als "pagination" gelesen`
                );
            }

            return entry as IConfigEntry;
        });
    }

    private Schedule(file: string | null): void {
        if (!file || !file.endsWith(EXTENSION)) return;

        const name = path.basename(file, EXTENSION).replace(/\.dev$/, "");

        clearTimeout(this.pending.get(name));

        const timer = setTimeout(() => {
            this.pending.delete(name);
            this.Reload(name).catch(() => {});
        }, WATCH_DEBOUNCE);

        timer.unref();

        this.pending.set(name, timer);
    }

    private Emit(name: string): void {
        for (const handler of this.handlers) {
            try {
                handler(name);
            } catch (error) {
                const normalized = error instanceof Error ? error : new Error(String(error));

                logger.error(`[ConfigService] Change-Handler für "${name}" fehlgeschlagen: ${normalized.message}`);
            }
        }
    }

    private Report(message: string, type: string, stack?: string): void {
        logger.error(`[ConfigService] ${message}`);

        this.client?.guardian?.HandleGeneric(message, type, stack ?? null).catch(() => {});
    }
}
