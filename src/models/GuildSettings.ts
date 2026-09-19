import Model from "../structures/Model";
import { OrNull, TABLES, TableName, Unpack } from "../constants/Database";
import { ModuleId, PERMANENT_MODULES } from "../constants/Modules";
import { ITicketModerators } from "../interfaces/services/tickets/ITicket";

/** Eine Zeile aus guild_settings, so wie MariaDB sie liefert. */
export interface IGuildSettingsRow {
    guild_id: string;
    modules: string[] | string;
    rank_roles: Record<string, string> | string;
    match_channel: string | null;
    queue_channel: string | null;
    moderators: ITicketModerators | string | null;
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
    /** Moderatoren für den ganzen Server - Tickets und Moderation. */
    moderators: ITicketModerators;
}

export const DEFAULT_SETTINGS: Omit<IGuildSettings, "guildId"> = {
    modules: [],
    rankRoles: {},
    matchChannel: null,
    queueChannel: null,
    moderators: { users: [], roles: [] },
};

// Feste Module stehen in jeder Liste, egal was in der Spalte steht: so muss
// keine aufrufende Stelle wissen, dass es sie gibt.
function WithPermanent(modules: string[]): string[] {
    const all = new Set(modules);

    for (const id of PERMANENT_MODULES) all.add(id);

    return [...all].sort();
}

export default class GuildSettings extends Model<IGuildSettingsRow> {
    readonly Table: TableName = TABLES.settings;
    readonly Key = ["guild_id"] as const;

    /** Immer eine Antwort: fehlt die Zeile, kommen die Standardwerte zurück. */
    async Of(guildId: string): Promise<IGuildSettings> {
        const row = await this.Find(guildId);

        if (!row) return { guildId, ...DEFAULT_SETTINGS, modules: WithPermanent([]), moderators: { users: [], roles: [] } };

        return {
            guildId: row.guild_id,
            modules: WithPermanent(Unpack<string[]>(row.modules, [])),
            rankRoles: Unpack<Record<string, string>>(row.rank_roles, {}),
            matchChannel: row.match_channel,
            queueChannel: row.queue_channel,
            moderators: { users: [], roles: [], ...Unpack<Partial<ITicketModerators>>(row.moderators, {}) },
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
                moderators: JSON.stringify(settings.moderators),
            },
            ["modules", "rank_roles", "match_channel", "queue_channel", "moderators"]
        );
    }

    /** Nur die Moderatoren - ohne den Rest der Zeile anzufassen. */
    async SaveModerators(guildId: string, moderators: ITicketModerators): Promise<void> {
        await this.Upsert({ guild_id: guildId, modules: "[]", rank_roles: "{}", moderators: JSON.stringify(moderators) }, ["moderators"]);
    }

    /** Ein Modul an- oder abschalten, ohne den Rest anzufassen. */
    async Toggle(guildId: string, module: string, on: boolean): Promise<string[]> {
        const settings = await this.Of(guildId);
        const modules = new Set(settings.modules);

        // Ein festes Modul bliebe ohnehin in jeder Liste - hier stehen zu
        // bleiben haelt auch die Spalte ehrlich.
        if (on) modules.add(module);
        else if (!PERMANENT_MODULES.has(module as ModuleId)) modules.delete(module);

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

        for (const row of rows) found.set(row.guild_id, WithPermanent(Unpack<string[]>(row.modules, [])));

        // Auch ohne eigene Zeile bekommt jeder angefragte Server die festen
        // Module - sonst zeigt die Serverliste (die hier durchgeht) etwas
        // anderes als die Detailseite (die über Of() geht) für denselben Server.
        for (const guildId of guildIds) {
            if (!found.has(guildId)) found.set(guildId, WithPermanent([]));
        }

        return found;
    }
}
