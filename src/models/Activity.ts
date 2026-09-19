import Model from "../structures/Model";
import { TABLES, TableName } from "../constants/Database";

export interface IActivityRow {
    guild_id: string;
    hour: number;
    messages: number;
    voice: number;
    joins: number;
    leaves: number;
}

/** Was zwischen zwei Schreibvorgängen zusammenkommt - je Server und Stunde. */
export interface IHourCount {
    guildId: string;
    hour: number;
    messages: number;
    voice: number;
    joins: number;
    leaves: number;
}

export interface IChannelCount {
    guildId: string;
    channelId: string;
    day: number;
    messages: number;
}

export interface IMemberCount {
    guildId: string;
    userId: string;
    day: number;
    messages: number;
    voice: number;
}

/**
 * Die Aktivität der Server: Zählerstände je Stunde, je Kanal und Tag, und je
 * Mitglied und Tag. Geschrieben wird nur addierend - der ActivityService sammelt
 * eine Minute lang und schickt dann alles auf einmal.
 */
export default class Activity extends Model<IActivityRow> {
    readonly Table: TableName = TABLES.activity;
    readonly Key = ["guild_id", "hour"] as const;

    /**
     * Addiert gesammelte Zählerstände auf. Alles in einer Transaktion: scheitert
     * die dritte Tabelle, stehen die ersten beiden sonst doppelt da, sobald der
     * nächste Lauf es erneut versucht.
     */
    async Add(hours: IHourCount[], channels: IChannelCount[], members: IMemberCount[]): Promise<void> {
        // Gebaut wird nur die Zahl der Platzhalter, die Werte gehen als Parameter raus.
        const rows = (count: number, width: number): string =>
            Array.from({ length: count }, () => `(${Array.from({ length: width }, () => "?").join(", ")})`).join(", ");

        await this.db.Transaction(async (query) => {
            if (hours.length > 0) {
                await query(
                    `INSERT INTO \`${TABLES.activity}\` (guild_id, hour, messages, voice, joins, leaves)
                     VALUES ${rows(hours.length, 6)}
                     ON DUPLICATE KEY UPDATE
                         messages = messages + VALUES(messages),
                         voice = voice + VALUES(voice),
                         joins = joins + VALUES(joins),
                         leaves = leaves + VALUES(leaves)`,
                    hours.flatMap((row) => [row.guildId, row.hour, row.messages, row.voice, row.joins, row.leaves])
                );
            }

            if (channels.length > 0) {
                await query(
                    `INSERT INTO \`${TABLES.channelActivity}\` (guild_id, channel_id, day, messages)
                     VALUES ${rows(channels.length, 4)}
                     ON DUPLICATE KEY UPDATE messages = messages + VALUES(messages)`,
                    channels.flatMap((row) => [row.guildId, row.channelId, row.day, row.messages])
                );
            }

            if (members.length > 0) {
                await query(
                    `INSERT INTO \`${TABLES.memberActivity}\` (guild_id, user_id, day, messages, voice)
                     VALUES ${rows(members.length, 5)}
                     ON DUPLICATE KEY UPDATE
                         messages = messages + VALUES(messages),
                         voice = voice + VALUES(voice)`,
                    members.flatMap((row) => [row.guildId, row.userId, row.day, row.messages, row.voice])
                );
            }
        });

        this.db.Bump(TABLES.activity);
        this.db.Bump(TABLES.channelActivity);
        this.db.Bump(TABLES.memberActivity);
    }

    /** Die Stunden eines Servers ab "from". Stille Stunden stehen nicht drin. */
    async Hours(guildId: string, from: number): Promise<IActivityRow[]> {
        return this.db.Cached(TABLES.activity, `hours:${guildId}:${from}`, () =>
            this.db.Query<IActivityRow>(
                `SELECT hour, messages, voice, joins, leaves FROM \`${TABLES.activity}\`
                 WHERE guild_id = ? AND hour >= ? ORDER BY hour ASC`,
                [guildId, from]
            )
        );
    }

    /** Die älteste Stunde, die für diesen Server noch da ist - seit wann gezählt wird. */
    async Since(guildId: string): Promise<number | null> {
        const row = await this.db.Cached(TABLES.activity, `since:${guildId}`, () =>
            this.db.One<{ first: number | null }>(
                `SELECT MIN(hour) AS first FROM \`${TABLES.activity}\` WHERE guild_id = ?`,
                [guildId]
            )
        );

        return row?.first === null || row?.first === undefined ? null : Number(row.first);
    }

    async TopChannels(guildId: string, from: number, limit: number): Promise<{ channel_id: string; messages: number }[]> {
        return this.db.Cached(TABLES.channelActivity, `top:${guildId}:${from}:${limit}`, () =>
            this.db.Query<{ channel_id: string; messages: number }>(
                `SELECT channel_id, SUM(messages) AS messages FROM \`${TABLES.channelActivity}\`
                 WHERE guild_id = ? AND day >= ?
                 GROUP BY channel_id ORDER BY messages DESC LIMIT ?`,
                [guildId, from, limit]
            )
        );
    }

    /** Die aktivsten Mitglieder, nach Nachrichten oder nach Minuten im Sprachkanal. */
    async TopMembers(
        guildId: string,
        from: number,
        by: "messages" | "voice",
        limit: number
    ): Promise<{ user_id: string; total: number }[]> {
        // "by" ist eine der beiden Spalten aus dem Code, nie eine Eingabe.
        return this.db.Cached(TABLES.memberActivity, `top:${guildId}:${from}:${by}:${limit}`, () =>
            this.db.Query<{ user_id: string; total: number }>(
                `SELECT user_id, SUM(\`${by}\`) AS total FROM \`${TABLES.memberActivity}\`
                 WHERE guild_id = ? AND day >= ?
                 GROUP BY user_id HAVING total > 0 ORDER BY total DESC LIMIT ?`,
                [guildId, from, limit]
            )
        );
    }

    /** Nachrichten eines Mitglieds seit einem Tag - für die Bedingungen der Giveaways. */
    async MemberMessages(guildId: string, userId: string, from: number): Promise<number> {
        const row = await this.db.One<{ total: number | null }>(
            `SELECT SUM(messages) AS total FROM \`${TABLES.memberActivity}\` WHERE guild_id = ? AND user_id = ? AND day >= ?`,
            [guildId, userId, from]
        );

        return Number(row?.total ?? 0);
    }

    /** Löscht, was die Aufbewahrung überschritten hat. Zurück kommt die Zahl der Zeilen. */
    async Prune(hourBefore: number, dayBefore: number, memberDayBefore: number): Promise<number> {
        const removed = [
            await this.db.Write(`DELETE FROM \`${TABLES.activity}\` WHERE hour < ?`, [hourBefore]),
            await this.db.Write(`DELETE FROM \`${TABLES.channelActivity}\` WHERE day < ?`, [dayBefore]),
            await this.db.Write(`DELETE FROM \`${TABLES.memberActivity}\` WHERE day < ?`, [memberDayBefore]),
        ];

        this.db.Bump(TABLES.activity);
        this.db.Bump(TABLES.channelActivity);
        this.db.Bump(TABLES.memberActivity);

        return removed.reduce((sum, result) => sum + result.affectedRows, 0);
    }
}
