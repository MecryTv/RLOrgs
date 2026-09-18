import Model from "../structures/Model";
import { OrNull, TABLES, TableName } from "../constants/Database";
import { MAX_REASON } from "../constants/Tickets";

export interface ITicketBlacklistRow {
    guild_id: string;
    user_id: string;
    reason: string | null;
    created_by: string;
    created_at: Date;
}

/** Wer auf einem Server keine Tickets mehr öffnen darf. */
export default class TicketBlacklist extends Model<ITicketBlacklistRow> {
    readonly Table: TableName = TABLES.ticketBlacklist;
    readonly Key = ["guild_id", "user_id"] as const;

    async Has(guildId: string, userId: string): Promise<boolean> {
        return (await this.Find(guildId, userId)) !== null;
    }

    async Of(guildId: string): Promise<ITicketBlacklistRow[]> {
        return this.Where({ guild_id: guildId }, "created_at DESC");
    }

    async Add(guildId: string, userId: string, reason: string | null, by: string): Promise<void> {
        await this.Upsert(
            { guild_id: guildId, user_id: userId, reason: OrNull(reason?.slice(0, MAX_REASON)), created_by: by },
            ["reason", "created_by"]
        );
    }

    async Remove(guildId: string, userId: string): Promise<boolean> {
        return (await this.Delete(guildId, userId)).affectedRows > 0;
    }
}
