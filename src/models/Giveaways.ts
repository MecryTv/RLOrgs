import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { DefaultGiveawaySettings, DefaultRequirements } from "../constants/Giveaways";
import { IGiveaway, IGiveawayBonus, IGiveawayRequirements, IGiveawaySettings } from "../interfaces/services/community/ICommunity";

export interface IGiveawayRow {
    id: number;
    guild_id: string;
    number: number;
    channel_id: string;
    message_id: string | null;
    prize: string;
    description: string | null;
    image: string | null;
    winners: number;
    host_id: string;
    status: IGiveaway["status"];
    starts_at: number | string;
    ends_at: number | string;
    ended_at: number | string | null;
    requirements: IGiveawayRequirements | string;
    bonus: IGiveawayBonus[] | string;
    settings: IGiveawaySettings | string;
    results: IGiveaway["results"] | string;
    created_at: number | string;
}

export type NewGiveaway = Pick<
    IGiveaway,
    "guildId" | "channelId" | "prize" | "description" | "image" | "winners" | "hostId" | "status" | "startsAt" | "endsAt" | "requirements" | "bonus" | "settings"
>;

function ToGiveaway(row: IGiveawayRow): IGiveaway {
    return {
        id: Number(row.id),
        guildId: row.guild_id,
        number: Number(row.number),
        channelId: row.channel_id,
        messageId: row.message_id,
        prize: row.prize,
        description: row.description,
        image: row.image,
        winners: Number(row.winners),
        hostId: row.host_id,
        status: row.status,
        startsAt: Number(row.starts_at),
        endsAt: Number(row.ends_at),
        endedAt: row.ended_at === null ? null : Number(row.ended_at),
        requirements: { ...DefaultRequirements(), ...Unpack<Partial<IGiveawayRequirements>>(row.requirements, {}) },
        bonus: Unpack<IGiveawayBonus[]>(row.bonus, []),
        settings: { ...DefaultGiveawaySettings(), ...Unpack<Partial<IGiveawaySettings>>(row.settings, {}) },
        results: { winners: Unpack<IGiveaway["results"]>(row.results, { winners: [] }).winners ?? [] },
        createdAt: Number(row.created_at),
    };
}

/** Giveaways und wer mitmacht. */
export default class Giveaways extends Model<IGiveawayRow> {
    readonly Table: TableName = TABLES.giveaways;
    readonly Key = ["id"] as const;

    async Create(input: NewGiveaway): Promise<IGiveaway> {
        for (let attempt = 1; ; attempt++) {
            try {
                const id = await this.db.Transaction(async (query) => {
                    const rows = (await query(`SELECT COALESCE(MAX(number), 0) + 1 AS next FROM \`${this.Table}\` WHERE guild_id = ? FOR UPDATE`, [input.guildId])) as {
                        next: number;
                    }[];
                    const result = (await query(
                        `INSERT INTO \`${this.Table}\` (guild_id, number, channel_id, prize, description, image, winners, host_id, status, starts_at, ends_at,` +
                            ` requirements, bonus, settings, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            input.guildId,
                            Number(rows[0]?.next ?? 1),
                            input.channelId,
                            input.prize,
                            input.description,
                            input.image,
                            input.winners,
                            input.hostId,
                            input.status,
                            input.startsAt,
                            input.endsAt,
                            JSON.stringify(input.requirements),
                            JSON.stringify(input.bonus),
                            JSON.stringify(input.settings),
                            JSON.stringify({ winners: [] }),
                            Date.now(),
                        ]
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

    async Get(id: number): Promise<IGiveaway | null> {
        const row = await this.Find(id);

        return row ? ToGiveaway(row) : null;
    }

    async ByNumber(guildId: string, number: number): Promise<IGiveaway | null> {
        const [row] = await this.Where({ guild_id: guildId, number });

        return row ? ToGiveaway(row) : null;
    }

    async OfGuild(guildId: string, limit = 100): Promise<IGiveaway[]> {
        const rows = await this.db.Query<IGiveawayRow>(`SELECT * FROM \`${this.Table}\` WHERE guild_id = ? ORDER BY number DESC LIMIT ?`, [guildId, limit]);

        return rows.map(ToGiveaway);
    }

    /** Zu starten, zu beenden oder mit offener Gewinner-Frist - für den minütlichen Lauf. */
    async Pending(before: number): Promise<IGiveaway[]> {
        const rows = await this.db.Query<IGiveawayRow>(
            `SELECT * FROM \`${this.Table}\` WHERE (status = 'scheduled' AND starts_at <= ?) OR (status = 'running' AND ends_at <= ?)` +
                ` OR (status = 'ended' AND results LIKE '%"status":"pending"%') ORDER BY id ASC LIMIT 100`,
            [before, before]
        );

        return rows.map(ToGiveaway);
    }

    async Patch(
        id: number,
        patch: Partial<Pick<IGiveaway, "status" | "messageId" | "endedAt" | "results" | "startsAt" | "endsAt">>
    ): Promise<IGiveaway | null> {
        const row: Record<string, unknown> = {};

        if (patch.status !== undefined) row.status = patch.status;
        if (patch.messageId !== undefined) row.message_id = patch.messageId;
        if (patch.endedAt !== undefined) row.ended_at = patch.endedAt;
        if (patch.results !== undefined) row.results = JSON.stringify(patch.results);
        if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
        if (patch.endsAt !== undefined) row.ends_at = patch.endsAt;

        await this.Update([id], row as Partial<IGiveawayRow>);

        return this.Get(id);
    }

    async Remove(id: number): Promise<void> {
        await this.db.Write(`DELETE FROM \`${TABLES.giveawayEntries}\` WHERE giveaway_id = ?`, [id]);
        this.db.Bump(TABLES.giveawayEntries);
        await this.Delete(id);
    }

    /* ----------------------------------------------------------
       Teilnahmen
       ---------------------------------------------------------- */
    async Entry(giveawayId: number, userId: string): Promise<{ tickets: number } | null> {
        return this.db.One<{ tickets: number }>(`SELECT tickets FROM \`${TABLES.giveawayEntries}\` WHERE giveaway_id = ? AND user_id = ?`, [giveawayId, userId]);
    }

    async Join(giveawayId: number, userId: string, tickets: number): Promise<void> {
        await this.db.Write(
            `INSERT INTO \`${TABLES.giveawayEntries}\` (giveaway_id, user_id, tickets, created_at) VALUES (?, ?, ?, ?)` +
                ` ON DUPLICATE KEY UPDATE tickets = VALUES(tickets)`,
            [giveawayId, userId, tickets, Date.now()]
        );
        this.db.Bump(TABLES.giveawayEntries);
    }

    async Leave(giveawayId: number, userId: string): Promise<void> {
        await this.db.Write(`DELETE FROM \`${TABLES.giveawayEntries}\` WHERE giveaway_id = ? AND user_id = ?`, [giveawayId, userId]);
        this.db.Bump(TABLES.giveawayEntries);
    }

    async EntryCount(giveawayId: number): Promise<number> {
        const row = await this.db.One<{ total: number }>(`SELECT COUNT(*) AS total FROM \`${TABLES.giveawayEntries}\` WHERE giveaway_id = ?`, [giveawayId]);

        return Number(row?.total ?? 0);
    }

    async Counts(ids: number[]): Promise<Map<number, number>> {
        if (ids.length === 0) return new Map();

        const rows = await this.db.Query<{ giveaway_id: number; total: number }>(
            `SELECT giveaway_id, COUNT(*) AS total FROM \`${TABLES.giveawayEntries}\` WHERE giveaway_id IN (${ids.map(() => "?").join(", ")}) GROUP BY giveaway_id`,
            ids
        );

        return new Map(rows.map((row) => [Number(row.giveaway_id), Number(row.total)]));
    }

    /** Alle Lose - für die Auslosung. */
    async Entries(giveawayId: number): Promise<{ user_id: string; tickets: number; created_at: number }[]> {
        const rows = await this.db.Query<{ user_id: string; tickets: number; created_at: number }>(
            `SELECT user_id, tickets, created_at FROM \`${TABLES.giveawayEntries}\` WHERE giveaway_id = ? ORDER BY created_at ASC`,
            [giveawayId]
        );

        return rows.map((row) => ({ user_id: row.user_id, tickets: Number(row.tickets), created_at: Number(row.created_at) }));
    }
}

