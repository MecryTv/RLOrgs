import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { TicketContact, TicketPriority, TicketStatus } from "../constants/Tickets";
import { ITicket, ITicketNote } from "../interfaces/services/tickets/ITicket";

export interface ITicketRow {
    id: number;
    guild_id: string;
    number: number;
    code: string | null;
    option_id: string;
    opener_id: string;
    opener_code: string | null;
    contact: TicketContact;
    channel_id: string | null;
    message_id: string | null;
    claimed_by: string | null;
    status: TicketStatus;
    priority: TicketPriority | null;
    slowmode: number;
    members: string[] | string;
    notes: ITicketNote[] | string;
    anonymous: string[] | string;
    messages: number;
    reminder_at: number | null;
    delete_at: number | null;
    created_at: Date;
    closed_at: Date | null;
    closed_by: string | null;
    close_reason: string | null;
}

/** Was sich an einem Ticket ändern lässt, in der Form von ITicket. */
export type TicketPatch = Partial<
    Pick<
        ITicket,
        | "optionId"
        | "channelId"
        | "messageId"
        | "claimedBy"
        | "status"
        | "priority"
        | "slowmode"
        | "members"
        | "notes"
        | "anonymous"
        | "reminderAt"
        | "deleteAt"
        | "closedAt"
        | "closedBy"
        | "closeReason"
    >
>;

const COLUMNS: Record<keyof TicketPatch, keyof ITicketRow> = {
    optionId: "option_id",
    channelId: "channel_id",
    messageId: "message_id",
    claimedBy: "claimed_by",
    status: "status",
    priority: "priority",
    slowmode: "slowmode",
    members: "members",
    notes: "notes",
    anonymous: "anonymous",
    reminderAt: "reminder_at",
    deleteAt: "delete_at",
    closedAt: "closed_at",
    closedBy: "closed_by",
    closeReason: "close_reason",
};

function ToTicket(row: ITicketRow): ITicket {
    return {
        id: row.id,
        guildId: row.guild_id,
        number: row.number,
        code: row.code ?? null,
        optionId: row.option_id,
        openerId: row.opener_id,
        openerCode: row.opener_code ?? null,
        contact: row.contact,
        channelId: row.channel_id,
        messageId: row.message_id,
        claimedBy: row.claimed_by,
        status: row.status,
        priority: row.priority,
        slowmode: Number(row.slowmode),
        members: Unpack<string[]>(row.members, []),
        notes: Unpack<ITicketNote[]>(row.notes, []),
        anonymous: Unpack<string[]>(row.anonymous, []),
        messages: Number(row.messages),
        reminderAt: row.reminder_at === null ? null : Number(row.reminder_at),
        deleteAt: row.delete_at === null ? null : Number(row.delete_at),
        createdAt: new Date(row.created_at),
        closedAt: row.closed_at ? new Date(row.closed_at) : null,
        closedBy: row.closed_by ?? null,
        closeReason: row.close_reason ?? null,
    };
}

export default class Tickets extends Model<ITicketRow> {
    readonly Table: TableName = TABLES.tickets;
    readonly Key = ["id"] as const;

    /**
     * Legt ein Ticket mit der nächsten Nummer des Servers an. FOR UPDATE sperrt
     * die Nummern des Servers bis zum Commit. Beim allerersten Ticket gibt es
     * noch keine Zeile zum Sperren - dann kann ein zweites gleichzeitiges an der
     * UNIQUE-Spalte scheitern oder in einen Deadlock laufen und versucht es neu.
     */
    async Create(
        guildId: string,
        optionId: string,
        code: string | null,
        openerId: string,
        openerCode: string | null,
        contact: TicketContact
    ): Promise<ITicket> {
        for (let attempt = 1; ; attempt++) {
            try {
                const id = await this.db.Transaction(async (query) => {
                    const rows = (await query(
                        `SELECT COALESCE(MAX(number), 0) + 1 AS next FROM \`${this.Table}\` WHERE guild_id = ? FOR UPDATE`,
                        [guildId]
                    )) as { next: number }[];

                    const result = (await query(
                        `INSERT INTO \`${this.Table}\` (guild_id, number, code, option_id, opener_id, opener_code, contact, members, notes, anonymous)` +
                            ` VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]')`,
                        [guildId, Number(rows[0]?.next ?? 1), code, optionId, openerId, openerCode, contact]
                    )) as { insertId: number };

                    return Number(result.insertId);
                });

                this.db.Bump(this.Table);

                return (await this.Get(id))!;
            } catch (error) {
                const code = (error as { code?: string }).code;

                if (attempt >= 3 || (code !== "ER_DUP_ENTRY" && code !== "ER_LOCK_DEADLOCK")) throw error;
            }
        }
    }

    async Get(id: number): Promise<ITicket | null> {
        const row = await this.Find(id);

        return row ? ToTicket(row) : null;
    }

    async ByChannel(channelId: string): Promise<ITicket | null> {
        const [row] = await this.Where({ channel_id: channelId });

        return row ? ToTicket(row) : null;
    }

    /** Die nicht geschlossenen Tickets eines Users auf einem Server. */
    async OpenOf(guildId: string, userId: string): Promise<ITicket[]> {
        const rows = await this.db.Cached(this.Table, `open:${guildId}:${userId}`, () =>
            this.db.Query<ITicketRow>(
                `SELECT * FROM \`${this.Table}\` WHERE opener_id = ? AND guild_id = ? AND status <> 'closed' ORDER BY id`,
                [userId, guildId]
            )
        );

        return rows.map(ToTicket);
    }

    /** Die nicht geschlossenen Tickets eines Servers, neueste zuerst - für Live Tickets. */
    async OpenOfGuild(guildId: string): Promise<ITicket[]> {
        const rows = await this.db.Query<ITicketRow>(
            `SELECT * FROM \`${this.Table}\` WHERE guild_id = ? AND status <> 'closed' ORDER BY id DESC LIMIT 200`,
            [guildId]
        );

        return rows.map(ToTicket);
    }

    /** Wie viele Tickets die User auf einem Server schon hatten - offen und geschlossen. */
    async CountsByOpener(guildId: string, openerIds: string[]): Promise<Map<string, number>> {
        const unique = [...new Set(openerIds)];

        if (unique.length === 0) return new Map();

        const rows = await this.db.Query<{ opener_id: string; total: number }>(
            `SELECT opener_id, COUNT(*) AS total FROM \`${this.Table}\` WHERE guild_id = ? AND opener_id IN (${unique.map(() => "?").join(", ")})` +
                ` GROUP BY opener_id`,
            [guildId, ...unique]
        );

        return new Map(rows.map((row) => [row.opener_id, Number(row.total)]));
    }

    /** Das offene ModMail-Ticket eines Users - server-übergreifend höchstens eins. */
    async OpenModMail(userId: string): Promise<ITicket | null> {
        const row = await this.db.Cached(this.Table, `modmail:${userId}`, () =>
            this.db.One<ITicketRow>(
                `SELECT * FROM \`${this.Table}\` WHERE opener_id = ? AND contact = 'modmail' AND status <> 'closed' ORDER BY id DESC LIMIT 1`,
                [userId]
            )
        );

        return row ? ToTicket(row) : null;
    }

    /** Alle Kanäle offener Tickets - der Bot merkt sie sich beim Start. */
    async OpenChannels(): Promise<string[]> {
        const rows = await this.db.Query<{ channel_id: string }>(
            `SELECT channel_id FROM \`${this.Table}\` WHERE status <> 'closed' AND channel_id IS NOT NULL`
        );

        return rows.map((row) => row.channel_id);
    }

    async Patch(id: number, patch: TicketPatch): Promise<void> {
        const row: Partial<Record<keyof ITicketRow, unknown>> = {};

        for (const [key, value] of Object.entries(patch) as [keyof TicketPatch, unknown][]) {
            row[COLUMNS[key]] = Array.isArray(value) ? JSON.stringify(value) : value;
        }

        await this.Update([id], row as Partial<ITicketRow>);
    }

    /**
     * Eine Nachricht mehr. ponytail: ohne Bump - sonst verwürfe jede Nachricht
     * in einem Ticket den Cache der ganzen Tabelle. Die Zahl darf dafür bis zu
     * einer Minute nachhinken; sie steht nur in der Zusammenfassung.
     */
    async CountMessage(id: number): Promise<void> {
        await this.db.Write(`UPDATE \`${this.Table}\` SET messages = messages + 1 WHERE id = ?`, [id]);
    }

    async DueReminders(now: number): Promise<ITicket[]> {
        const rows = await this.db.Query<ITicketRow>(
            `SELECT * FROM \`${this.Table}\` WHERE reminder_at IS NOT NULL AND reminder_at <= ? AND status <> 'closed'`,
            [now]
        );

        return rows.map(ToTicket);
    }

    async DueDeletions(now: number): Promise<ITicket[]> {
        const rows = await this.db.Query<ITicketRow>(
            `SELECT * FROM \`${this.Table}\` WHERE delete_at IS NOT NULL AND delete_at <= ? AND status = 'closed'`,
            [now]
        );

        return rows.map(ToTicket);
    }
}
