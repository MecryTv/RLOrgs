import Model from "../structures/Model";
import { OrNull, TABLES, TableName } from "../constants/Database";

/** Eine Zeile aus guild_settings, so wie MariaDB sie liefert. */
export interface IGuildSettingsRow {
    guild_id: string;
    modules: string[] | string;
    rank_roles: Record<string, string> | string;
    match_channel: string | null;
    queue_channel: string | null;
    created_at: Date;
    updated_at: Date;
}

/** Dieselben Daten, nur ausgepackt. */
export interface IGuildSettings {
    guildId: string;
    modules: string[];
    rankRoles: Record<string, string>;
    matchChannel: string | null;
    queueChannel: string | null;
}

export const DEFAULT_SETTINGS: Omit<IGuildSettings, "guildId"> = {
    modules: [],
    rankRoles: {},
    matchChannel: null,
    queueChannel: null,
};

// MariaDB gibt JSON-Spalten je nach Version als Text oder schon ausgepackt
// zurück. Beides wird hier auf dieselbe Form gebracht.
function Unpack<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined) return fallback;
    if (typeof value !== "string") return value as T;

    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

export default class GuildSettings extends Model<IGuildSettingsRow> {
    readonly Table: TableName = TABLES.settings;
    readonly Key = ["guild_id"] as const;

    /** Immer eine Antwort: fehlt die Zeile, kommen die Standardwerte zurück. */
    async Of(guildId: string): Promise<IGuildSettings> {
        const row = await this.Find(guildId);

        if (!row) return { guildId, ...DEFAULT_SETTINGS };

        return {
            guildId: row.guild_id,
            modules: Unpack<string[]>(row.modules, []),
            rankRoles: Unpack<Record<string, string>>(row.rank_roles, {}),
            matchChannel: row.match_channel,
            queueChannel: row.queue_channel,
        };
    }

    /** Legt an oder ändert - je nachdem, ob es die Zeile schon gibt. */
    async Save(settings: IGuildSettings): Promise<void> {
        await this.Upsert(
            {
                guild_id: settings.guildId,
                modules: JSON.stringify(settings.modules),
                rank_roles: JSON.stringify(settings.rankRoles),
                match_channel: OrNull(settings.matchChannel),
                queue_channel: OrNull(settings.queueChannel),
            },
            ["modules", "rank_roles", "match_channel", "queue_channel"]
        );
    }

    /** Ein Modul an- oder abschalten, ohne den Rest anzufassen. */
    async Toggle(guildId: string, module: string, on: boolean): Promise<string[]> {
        const settings = await this.Of(guildId);
        const modules = new Set(settings.modules);

        if (on) modules.add(module);
        else modules.delete(module);

        const next = [...modules].sort();

        await this.Save({ ...settings, modules: next });

        return next;
    }

    /**
     * Die Modulliste mehrerer Server auf einmal. Das Dashboard baut damit seine
     * Karten, ohne pro Server eine eigene Abfrage zu schicken.
     */
    async ModulesOf(guildIds: string[]): Promise<Map<string, string[]>> {
        const found = new Map<string, string[]>();

        if (guildIds.length === 0) return found;

        const marks = guildIds.map(() => "?").join(", ");

        const rows = await this.db.Cached(this.Table, `modules:${guildIds.join(",")}`, () =>
            this.db.Query<Pick<IGuildSettingsRow, "guild_id" | "modules">>(
                `SELECT guild_id, modules FROM \`${this.Table}\` WHERE guild_id IN (${marks})`,
                guildIds
            )
        );

        for (const row of rows) found.set(row.guild_id, Unpack<string[]>(row.modules, []));

        return found;
    }
}
