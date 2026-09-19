import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { DefaultPollSettings } from "../constants/Polls";
import { IPoll, IPollOption, IPollSettings, PollKind } from "../interfaces/services/community/ICommunity";

export interface IPollRow {
    id: number;
    guild_id: string;
    number: number;
    kind: PollKind;
    channel_id: string;
    message_id: string | null;
    question: string;
    description: string | null;
    options: IPollOption[] | string;
    settings: IPollSettings | string;
    status: "open" | "ended";
    results: Record<string, number> | string | null;
    created_by: string;
    created_at: number | string;
    ends_at: number | string | null;
    ended_at: number | string | null;
}

function ToPoll(row: IPollRow): IPoll {
    return {
        id: Number(row.id),
        guildId: row.guild_id,
        number: Number(row.number),
        kind: row.kind,
        channelId: row.channel_id,
        messageId: row.message_id,
        question: row.question,
        description: row.description,
        options: Unpack<IPollOption[]>(row.options, []),
        settings: { ...DefaultPollSettings(), ...Unpack<Partial<IPollSettings>>(row.settings, {}) },
        status: row.status,
        results: row.results === null ? null : Unpack<Record<string, number> | null>(row.results, null),
        createdBy: row.created_by,
        createdAt: Number(row.created_at),
        endsAt: row.ends_at === null ? null : Number(row.ends_at),
        endedAt: row.ended_at === null ? null : Number(row.ended_at),
    };
}

/** Umfragen und ihre Stimmen. */
export default class Polls extends Model<IPollRow> {
    readonly Table: TableName = TABLES.polls;
    readonly Key = ["id"] as const;

    async Create(input: Pick<IPoll, "guildId" | "kind" | "channelId" | "question" | "description" | "options" | "settings" | "createdBy" | "endsAt">): Promise<IPoll> {
        for (let attempt = 1; ; attempt++) {
            try {
                const id = await this.db.Transaction(async (query) => {
                    const rows = (await query(`SELECT COALESCE(MAX(number), 0) + 1 AS next FROM \`${this.Table}\` WHERE guild_id = ? FOR UPDATE`, [input.guildId])) as {
                        next: number;
                    }[];
                    const result = (await query(
                        `INSERT INTO \`${this.Table}\` (guild_id, number, kind, channel_id, question, description, options, settings, created_by, created_at, ends_at)` +
                            ` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            input.guildId,
                            Number(rows[0]?.next ?? 1),
                            input.kind,
                            input.channelId,
                            input.question,
                            input.description,
                            JSON.stringify(input.options),
                            JSON.stringify(input.settings),
                            input.createdBy,
                            Date.now(),
                            input.endsAt,
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

    async Get(id: number): Promise<IPoll | null> {
        const row = await this.Find(id);

        return row ? ToPoll(row) : null;
    }

    async ByNumber(guildId: string, number: number): Promise<IPoll | null> {
        const [row] = await this.Where({ guild_id: guildId, number });

        return row ? ToPoll(row) : null;
    }

    async OfGuild(guildId: string, limit = 100): Promise<IPoll[]> {
        const rows = await this.db.Query<IPollRow>(`SELECT * FROM \`${this.Table}\` WHERE guild_id = ? ORDER BY number DESC LIMIT ?`, [guildId, limit]);

        return rows.map(ToPoll);
    }

    async Due(now: number): Promise<IPoll[]> {
        const rows = await this.db.Query<IPollRow>(
            `SELECT * FROM \`${this.Table}\` WHERE status = 'open' AND ends_at IS NOT NULL AND ends_at <= ? ORDER BY ends_at ASC LIMIT 50`,
            [now]
        );

        return rows.map(ToPoll);
    }

    async SetMessage(id: number, messageId: string): Promise<void> {
        await this.Update([id], { message_id: messageId });
    }

    async Finish(id: number, results: Record<string, number> | null): Promise<void> {
        await this.Update([id], { status: "ended", ended_at: Date.now(), results: results ? JSON.stringify(results) : null } as Partial<IPollRow>);
    }

    async Remove(id: number): Promise<void> {
        await this.db.Write(`DELETE FROM \`${TABLES.pollVotes}\` WHERE poll_id = ?`, [id]);
        this.db.Bump(TABLES.pollVotes);
        await this.Delete(id);
    }

    /* ----------------------------------------------------------
       Stimmen
       ---------------------------------------------------------- */
    async VotesOf(pollId: string | number, userId: string): Promise<string[]> {
        const rows = await this.db.Query<{ option_id: string }>(`SELECT option_id FROM \`${TABLES.pollVotes}\` WHERE poll_id = ? AND user_id = ?`, [pollId, userId]);

        return rows.map((row) => row.option_id);
    }

    /** Setzt die Stimmen eines Users auf genau diese Antworten - in einem Rutsch. */
    async SetVotes(pollId: number, userId: string, optionIds: string[]): Promise<void> {
        await this.db.Transaction(async (query) => {
            await query(`DELETE FROM \`${TABLES.pollVotes}\` WHERE poll_id = ? AND user_id = ?`, [pollId, userId]);

            for (const optionId of optionIds) {
                await query(`INSERT INTO \`${TABLES.pollVotes}\` (poll_id, user_id, option_id, created_at) VALUES (?, ?, ?, ?)`, [pollId, userId, optionId, Date.now()]);
            }
        });

        this.db.Bump(TABLES.pollVotes);
    }

    /** Stimmen je Antwort und wie viele Leute abgestimmt haben. */
    async Tally(pollId: number): Promise<{ counts: Record<string, number>; voters: number }> {
        const rows = await this.db.Query<{ option_id: string; total: number }>(
            `SELECT option_id, COUNT(*) AS total FROM \`${TABLES.pollVotes}\` WHERE poll_id = ? GROUP BY option_id`,
            [pollId]
        );
        const voters = await this.db.One<{ total: number }>(`SELECT COUNT(DISTINCT user_id) AS total FROM \`${TABLES.pollVotes}\` WHERE poll_id = ?`, [pollId]);

        return { counts: Object.fromEntries(rows.map((row) => [row.option_id, Number(row.total)])), voters: Number(voters?.total ?? 0) };
    }

    /** Wer was gewählt hat - nur für Umfragen, die nicht anonym sind. */
    async Voters(pollId: number): Promise<{ option_id: string; user_id: string }[]> {
        return this.db.Query(`SELECT option_id, user_id FROM \`${TABLES.pollVotes}\` WHERE poll_id = ? ORDER BY created_at ASC LIMIT 5000`, [pollId]);
    }
}
