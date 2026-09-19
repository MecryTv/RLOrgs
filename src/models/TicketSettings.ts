import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { AssignCodes, DefaultConfig, LEGACY_MODMAIL_PANEL } from "../constants/Tickets";
import { ITicketConfig } from "../interfaces/services/tickets/ITicket";

export interface ITicketSettingsRow {
    guild_id: string;
    config: Partial<ITicketConfig> | string;
    created_at: Date;
    updated_at: Date;
}

/**
 * Die Einstellungen des Ticket-Systems je Server - eine JSON-Zeile. Dashboard
 * und Discord-Assistent schreiben beide hierher.
 */
export default class TicketSettings extends Model<ITicketSettingsRow> {
    readonly Table: TableName = TABLES.ticketSettings;
    readonly Key = ["guild_id"] as const;

    /**
     * Immer eine vollständige Antwort: Felder, die eine ältere Zeile noch nicht
     * kennt, kommen aus den Standardwerten. Eine Kopie, weil der Cache dasselbe
     * Objekt sonst an jeden Aufrufer reichen würde.
     */
    async Of(guildId: string): Promise<ITicketConfig> {
        const row = await this.Find(guildId);
        const stored = structuredClone(Unpack<Partial<ITicketConfig>>(row?.config, {}));
        const base = DefaultConfig();
        const messages = { ...base.messages, ...stored.messages };
        const [first] = messages.modmailPanel.blocks;

        // Der alte Standardtext versprach Themen unter dem Panel - siehe LEGACY_MODMAIL_PANEL.
        if (messages.modmailPanel.blocks.length === 1 && first.type === "text" && first.body === LEGACY_MODMAIL_PANEL) {
            messages.modmailPanel = base.messages.modmailPanel;
        }

        return {
            ...base,
            ...stored,
            // Ältere Themen haben noch kein Kürzel - dann kommt es aus dem Namen.
            options: AssignCodes(stored.options ?? base.options),
            messages,
            tags: { ...base.tags, ...stored.tags },
            panel: { ...base.panel, ...stored.panel },
            transcripts: { ...base.transcripts, ...stored.transcripts },
            // Moderatoren gelten für den ganzen Server und stehen in guild_settings.
            moderators: (await this.client.settings.Of(guildId)).moderators,
        };
    }

    async Save(guildId: string, config: ITicketConfig): Promise<void> {
        // Die Moderatoren gehören dem Server (GuildSettings.SaveModerators), nicht den Tickets.
        const stored: Partial<ITicketConfig> = { ...config };

        delete stored.moderators;

        await this.Upsert({ guild_id: guildId, config: JSON.stringify(stored) }, ["config"]);
    }

    /** Die Server, auf denen ModMail an ist - für eine DM ohne offenes Ticket. */
    async ModMailGuilds(): Promise<string[]> {
        const rows = await this.db.Cached(this.Table, "modmail", () =>
            this.db.Query<{ guild_id: string }>(
                `SELECT guild_id FROM \`${this.Table}\` WHERE JSON_UNQUOTE(JSON_EXTRACT(config, '$.contact')) = 'modmail'`
            )
        );

        return rows.map((row) => row.guild_id);
    }
}
