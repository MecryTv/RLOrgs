import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { IModCase, IModDetails, IModEvidence, IModFilter, IModNote, ModAction, ModSource } from "../interfaces/services/moderation/IModeration";

export interface IModCaseRow {
    id: number;
    guild_id: string;
    number: number;
    action: ModAction;
    target_id: string | null;
    target_name: string | null;
    moderator_id: string;
    moderator_name: string;
    reason: string | null;
    duration: number | null;
    expires_at: number | string | null;
    active: number;
    source: ModSource;
    related: number | null;
    details: IModDetails | string;
    evidence: IModEvidence[] | string;
    notes: IModNote[] | string;
    log_channel: string | null;
    log_message: string | null;
    created_at: number | string;
}

/** Was ein neuer Fall mitbringt - Nummer, Zeit und leere Listen setzt Create(). */
export type NewModCase = Pick<
    IModCase,
    "guildId" | "action" | "targetId" | "targetName" | "moderatorId" | "moderatorName" | "reason" | "duration" | "expiresAt" | "active" | "source" | "related" | "details"
>;

/** Was sich an einem Fall später noch ändert. */
export type ModCasePatch = Partial<Pick<IModCase, "active" | "details" | "evidence" | "notes" | "logChannel" | "logMessage">>;

function ToCase(row: IModCaseRow): IModCase {
    return {
        id: Number(row.id),
        guildId: row.guild_id,
        number: Number(row.number),
        action: row.action,
        targetId: row.target_id,
        targetName: row.target_name,
        moderatorId: row.moderator_id,
        moderatorName: row.moderator_name,
        reason: row.reason,
        duration: row.duration === null ? null : Number(row.duration),
        expiresAt: row.expires_at === null ? null : Number(row.expires_at),
        active: Boolean(Number(row.active)),
        source: row.source,
        related: row.related === null ? null : Number(row.related),
        details: Unpack<IModDetails>(row.details, {}),
        evidence: Unpack<IModEvidence[]>(row.evidence, []),
        notes: Unpack<IModNote[]>(row.notes, []),
        logChannel: row.log_channel,
        logMessage: row.log_message,
        createdAt: Number(row.created_at),
    };
}

function ToRow(patch: ModCasePatch): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (patch.active !== undefined) row.active = patch.active ? 1 : 0;
    if (patch.details !== undefined) row.details = JSON.stringify(patch.details);
    if (patch.evidence !== undefined) row.evidence = JSON.stringify(patch.evidence);
    if (patch.notes !== undefined) row.notes = JSON.stringify(patch.notes);
    if (patch.logChannel !== undefined) row.log_channel = patch.logChannel;
    if (patch.logMessage !== undefined) row.log_message = patch.logMessage;

    return row;
}

/** Die Fälle der Moderation - je Server fortlaufend nummeriert. */
export default class ModCases extends Model<IModCaseRow> {
    readonly Table: TableName = TABLES.modCases;
    readonly Key = ["id"] as const;

    /** Legt einen Fall mit der nächsten freien Nummer an - wie Tickets.Create. */
    async Create(input: NewModCase): Promise<IModCase> {
        for (let attempt = 1; ; attempt++) {
            try {
                const id = await this.db.Transaction(async (query) => {
                    const rows = (await query(
                        `SELECT COALESCE(MAX(number), 0) + 1 AS next FROM \`${this.Table}\` WHERE guild_id = ? FOR UPDATE`,
                        [input.guildId]
                    )) as { next: number }[];

                    const result = (await query(
                        `INSERT INTO \`${this.Table}\` (guild_id, number, action, target_id, target_name, moderator_id, moderator_name, reason,` +
                            ` duration, expires_at, active, source, related, details, evidence, notes, created_at)` +
                            ` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?)`,
                        [
                            input.guildId,
                            Number(rows[0]?.next ?? 1),
                            input.action,
                            input.targetId,
                            input.targetName?.slice(0, 100) ?? null,
                            input.moderatorId,
                            input.moderatorName.slice(0, 100),
                            input.reason,
                            input.duration,
                            input.expiresAt,
                            input.active ? 1 : 0,
                            input.source,
                            input.related,
                            JSON.stringify(input.details),
                            Date.now(),
                        ]
                    )) as { insertId: number };

                    return Number(result.insertId);
                });

                this.db.Bump(this.Table);

                return (await this.ById(id))!;
            } catch (error) {
                const code = (error as { code?: string }).code;

                if (attempt >= 3 || (code !== "ER_DUP_ENTRY" && code !== "ER_LOCK_DEADLOCK")) throw error;
            }
        }
    }

    async ById(id: number): Promise<IModCase | null> {
        const row = await this.Find(id);

        return row ? ToCase(row) : null;
    }

    /** Fall #12 eines Servers. */
    async Get(guildId: string, number: number): Promise<IModCase | null> {
        const row = await this.db.Cached(this.Table, `number:${guildId}:${number}`, () =>
            this.db.One<IModCaseRow>(`SELECT * FROM \`${this.Table}\` WHERE guild_id = ? AND number = ? LIMIT 1`, [guildId, number])
        );

        return row ? ToCase(row) : null;
    }

    /** Neueste zuerst, seitenweise über before (Fallnummer). */
    async List(guildId: string, filter: IModFilter, before: number | null, limit: number): Promise<IModCase[]> {
        const where = ["guild_id = ?"];
        const values: unknown[] = [guildId];
        const text = (filter.query ?? "").trim();

        if (filter.action) {
            where.push("action = ?");
            values.push(filter.action);
        }

        if (filter.active) where.push("active = 1");

        if (filter.targetId) {
            where.push("target_id = ?");
            values.push(filter.targetId);
        }

        if (before !== null) {
            where.push("number < ?");
            values.push(before);
        }

        const number = /^#?(\d{1,7})$/.exec(text);

        if (number) {
            where.push("number = ?");
            values.push(Number(number[1]));
        } else if (/^\d{17,20}$/.test(text)) {
            where.push("(target_id = ? OR moderator_id = ?)");
            values.push(text, text);
        } else if (text) {
            const like = `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

            where.push("(target_name LIKE ? OR moderator_name LIKE ? OR reason LIKE ?)");
            values.push(like, like, like);
        }

        const rows = await this.db.Query<IModCaseRow>(
            `SELECT * FROM \`${this.Table}\` WHERE ${where.join(" AND ")} ORDER BY number DESC LIMIT ?`,
            [...values, limit]
        );

        return rows.map(ToCase);
    }

    /** Die noch geltenden Fälle eines Users - neueste zuerst. */
    async ActiveOf(guildId: string, targetId: string, action: ModAction): Promise<IModCase[]> {
        const rows = await this.db.Query<IModCaseRow>(
            `SELECT * FROM \`${this.Table}\` WHERE guild_id = ? AND target_id = ? AND action = ? AND active = 1 ORDER BY number DESC`,
            [guildId, targetId, action]
        );

        return rows.map(ToCase);
    }

    /** Wie oft ein User schon dran war - je Aktion, für den Kopf seines Verlaufs. */
    async CountsOf(guildId: string, targetId: string): Promise<Partial<Record<ModAction, number>>> {
        const rows = await this.db.Query<{ action: ModAction; total: number }>(
            `SELECT action, COUNT(*) AS total FROM \`${this.Table}\` WHERE guild_id = ? AND target_id = ? GROUP BY action`,
            [guildId, targetId]
        );

        return Object.fromEntries(rows.map((row) => [row.action, Number(row.total)]));
    }

    /** Die Fälle, die sich auf diesen beziehen - etwa der Kick, den ein Warn ausgelöst hat. */
    async RelatedTo(guildId: string, number: number): Promise<IModCase[]> {
        const rows = await this.db.Query<IModCaseRow>(
            `SELECT * FROM \`${this.Table}\` WHERE guild_id = ? AND related = ? ORDER BY number ASC LIMIT 20`,
            [guildId, number]
        );

        return rows.map(ToCase);
    }

    /** Befristete Banns und Timeouts, deren Zeit um ist. */
    async Due(now: number): Promise<IModCase[]> {
        const rows = await this.db.Query<IModCaseRow>(
            `SELECT * FROM \`${this.Table}\` WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ? AND action IN ('ban', 'timeout')` +
                ` ORDER BY expires_at ASC LIMIT 50`,
            [now]
        );

        return rows.map(ToCase);
    }

    /** Die Zahlen oben im Dashboard: was gerade gilt und was in 30 Tagen passiert ist. */
    async Stats(guildId: string, now = Date.now()): Promise<{ bans: number; timeouts: number; warns: number; month: number; total: number }> {
        const row = await this.db.One<Record<string, number | string | null>>(
            `SELECT` +
                ` SUM(action = 'ban' AND active = 1) AS bans,` +
                ` SUM(action = 'timeout' AND active = 1 AND (expires_at IS NULL OR expires_at > ?)) AS timeouts,` +
                ` SUM(action = 'warn' AND active = 1) AS warns,` +
                ` SUM(created_at >= ?) AS month,` +
                ` COUNT(*) AS total` +
                ` FROM \`${this.Table}\` WHERE guild_id = ?`,
            [now, now - 30 * 86_400_000, guildId]
        );

        return {
            bans: Number(row?.bans ?? 0),
            timeouts: Number(row?.timeouts ?? 0),
            warns: Number(row?.warns ?? 0),
            month: Number(row?.month ?? 0),
            total: Number(row?.total ?? 0),
        };
    }

    /**
     * Ändert einen Fall unter Sperre: lesen, ändern, schreiben - zwei Notizen zur
     * selben Zeit überschreiben sich so nicht. change bekommt den frischen Stand.
     */
    async Mutate(id: number, change: (current: IModCase) => ModCasePatch | null): Promise<IModCase | null> {
        const changed = await this.db.Transaction(async (query) => {
            const rows = (await query(`SELECT * FROM \`${this.Table}\` WHERE id = ? FOR UPDATE`, [id])) as IModCaseRow[];

            if (!rows[0]) return false;

            const row = ToRow(change(ToCase(rows[0])) ?? {});
            const columns = Object.keys(row);

            if (columns.length === 0) return false;

            await query(`UPDATE \`${this.Table}\` SET ${columns.map((column) => `\`${column}\` = ?`).join(", ")} WHERE id = ?`, [
                ...Object.values(row),
                id,
            ]);

            return true;
        });

        if (changed) this.db.Bump(this.Table);

        return this.ById(id);
    }
}
