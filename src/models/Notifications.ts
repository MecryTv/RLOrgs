import Model from "../structures/Model";
import { OrNull, TABLES, TableName } from "../constants/Database";

export const NOTE_KINDS = ["info", "success", "warn", "group", "account"] as const;

export type NoteKind = (typeof NOTE_KINDS)[number];

export interface INotificationRow {
    id: number;
    user_id: string;
    kind: NoteKind;
    title: string;
    body: string;
    link: string | null;
    read_at: Date | null;
    created_at: Date;
}

// Länge der Spalten - länger abgeschnitten statt die Abfrage scheitern lassen.
const MAX_TITLE = 120;
const MAX_BODY = 500;
const MAX_LINK = 190;

/**
 * Benachrichtigungen eines Nutzers.
 *
 * Geschrieben wird hier aus dem Bot heraus - überall dort, wo etwas passiert,
 * das jemanden betrifft. Gelesen wird über /dashboard/api/notifications.
 */
export default class Notifications extends Model<INotificationRow> {
    readonly Table: TableName = TABLES.notifications;
    readonly Key = ["id"] as const;

    /** Die neuesten zuerst. */
    async Of(userId: string, limit = 30): Promise<INotificationRow[]> {
        return this.db.Cached(this.Table, `user:${userId}:${limit}`, () =>
            this.db.Query<INotificationRow>(
                `SELECT * FROM \`${this.Table}\` WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
                [userId, limit]
            )
        );
    }

    async Unread(userId: string): Promise<number> {
        const row = await this.db.Cached(this.Table, `unread:${userId}`, () =>
            this.db.One<{ total: number }>(
                `SELECT COUNT(*) AS total FROM \`${this.Table}\` WHERE user_id = ? AND read_at IS NULL`,
                [userId]
            )
        );

        return Number(row?.total ?? 0);
    }

    /**
     * Legt eine Benachrichtigung an.
     *
     * Wirft bewusst nicht weiter: eine Benachrichtigung ist Beiwerk, sie darf
     * die eigentliche Aktion nicht scheitern lassen. Ohne Datenbank passiert
     * schlicht nichts.
     */
    async Push(
        userId: string,
        kind: NoteKind,
        title: string,
        body: string,
        link?: string
    ): Promise<number | null> {
        if (!this.Ready) return null;

        try {
            const result = await this.Insert({
                user_id: userId,
                kind,
                title: title.slice(0, MAX_TITLE),
                body: body.slice(0, MAX_BODY),
                link: OrNull(link?.slice(0, MAX_LINK)),
            });

            return result.insertId;
        } catch {
            return null;
        }
    }

    /** Alles Ungelesene eines Nutzers auf gelesen setzen. Gibt die Anzahl zurück. */
    async MarkRead(userId: string): Promise<number> {
        const result = await this.db.Write(
            `UPDATE \`${this.Table}\` SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL`,
            [userId]
        );

        this.db.Bump(this.Table);

        return result.affectedRows;
    }

    /** Räumt das Postfach eines Nutzers. */
    async Clear(userId: string): Promise<number> {
        const result = await this.db.Write(`DELETE FROM \`${this.Table}\` WHERE user_id = ?`, [userId]);

        this.db.Bump(this.Table);

        return result.affectedRows;
    }
}
