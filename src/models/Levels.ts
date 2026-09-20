import Model from "../structures/Model";
import { TABLES, TableName } from "../constants/Database";
import { ILevelEntry, ILevelRank } from "../interfaces/services/levels/ILevels";

export interface ILevelRow {
    guild_id: string;
    user_id: string;
    xp: number | string;
    level: number;
    messages: number;
    voice_minutes: number;
    last_message: number | string;
    updated_at: number | string;
}

function ToEntry(row: ILevelRow): ILevelEntry {
    return {
        guildId: row.guild_id,
        userId: row.user_id,
        xp: Number(row.xp),
        level: Number(row.level),
        messages: Number(row.messages),
        voiceMinutes: Number(row.voice_minutes),
        lastMessage: Number(row.last_message),
    };
}

/** Punkte und Level je Mitglied und Server. */
export default class Levels extends Model<ILevelRow> {
    readonly Table: TableName = TABLES.levels;
    readonly Key = ["guild_id", "user_id"] as const;

    async Of(guildId: string, userId: string): Promise<ILevelEntry | null> {
        const row = await this.Find(guildId, userId);

        return row ? ToEntry(row) : null;
    }

    /**
     * Legt Punkte drauf und schreibt den neuen Stand - in einer Anweisung,
     * damit zwei Nachrichten in derselben Sekunde nicht eine davon verlieren.
     */
    async Add(guildId: string, userId: string, xp: number, extra: { messages?: number; voiceMinutes?: number; stamp?: number }): Promise<void> {
        const now = Date.now();

        await this.db.Write(
            `INSERT INTO \`${this.Table}\` (guild_id, user_id, xp, level, messages, voice_minutes, last_message, updated_at)
             VALUES (?, ?, ?, 0, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE xp = xp + VALUES(xp), messages = messages + VALUES(messages),
                 voice_minutes = voice_minutes + VALUES(voice_minutes),
                 last_message = GREATEST(last_message, VALUES(last_message)), updated_at = VALUES(updated_at)`,
            [guildId, userId, Math.max(0, Math.round(xp)), extra.messages ?? 0, extra.voiceMinutes ?? 0, extra.stamp ?? 0, now]
        );

        this.db.Bump(this.Table);
    }

    /** Setzt Punkte und Level hart - für das Dashboard. */
    async Set(guildId: string, userId: string, xp: number, level: number): Promise<void> {
        await this.Upsert(
            { guild_id: guildId, user_id: userId, xp: Math.max(0, Math.round(xp)), level, messages: 0, voice_minutes: 0, last_message: 0, updated_at: Date.now() },
            ["xp", "level", "updated_at"]
        );
    }

    async SetLevel(guildId: string, userId: string, level: number): Promise<void> {
        await this.Update([guildId, userId], { level, updated_at: Date.now() } as Partial<ILevelRow>);
    }

    async Remove(guildId: string, userId: string): Promise<void> {
        await this.Delete(guildId, userId);
    }

    async Clear(guildId: string): Promise<void> {
        await this.db.Write(`DELETE FROM \`${this.Table}\` WHERE guild_id = ?`, [guildId]);
        this.db.Bump(this.Table);
    }

    /** Die Rangliste, beste zuerst. */
    async Top(guildId: string, limit = 25, offset = 0): Promise<ILevelRank[]> {
        const rows = await this.db.Query<ILevelRow>(
            `SELECT * FROM \`${this.Table}\` WHERE guild_id = ? ORDER BY xp DESC, user_id ASC LIMIT ? OFFSET ?`,
            [guildId, Math.min(100, Math.max(1, limit)), Math.max(0, offset)]
        );

        return rows.map((row, index) => ({ ...ToEntry(row), rank: offset + index + 1 }));
    }

    /** Der wievielte ist jemand? "rank" ist in MariaDB reserviert, daher "place". */
    async Rank(guildId: string, userId: string): Promise<number> {
        const row = await this.db.One<{ place: number }>(
            `SELECT COUNT(*) + 1 AS place FROM \`${this.Table}\`
             WHERE guild_id = ? AND xp > (SELECT xp FROM \`${this.Table}\` WHERE guild_id = ? AND user_id = ?)`,
            [guildId, guildId, userId]
        );

        return Number(row?.place ?? 0);
    }

    async Total(guildId: string): Promise<number> {
        const row = await this.db.One<{ total: number }>(`SELECT COUNT(*) AS total FROM \`${this.Table}\` WHERE guild_id = ?`, [guildId]);

        return Number(row?.total ?? 0);
    }

    /** Alle, die mindestens dieses Level haben - für das Nachtragen der Rollen. */
    async AtLeast(guildId: string, level: number): Promise<ILevelEntry[]> {
        const rows = await this.db.Query<ILevelRow>(`SELECT * FROM \`${this.Table}\` WHERE guild_id = ? AND level >= ?`, [guildId, level]);

        return rows.map(ToEntry);
    }
}
