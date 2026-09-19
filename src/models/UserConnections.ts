import Model from "../structures/Model";
import { TABLES, TableName } from "../constants/Database";
import { StreamPlatform } from "../interfaces/services/community/ICommunity";

export interface IUserConnectionRow {
    user_id: string;
    platform: StreamPlatform;
    account_id: string;
    name: string;
    updated_at: number | string;
}

export interface IUserConnection {
    userId: string;
    platform: StreamPlatform;
    accountId: string;
    name: string;
}

function ToConnection(row: IUserConnectionRow): IUserConnection {
    return { userId: row.user_id, platform: row.platform, accountId: row.account_id, name: row.name };
}

/**
 * Wer welchen Twitch- oder YouTube-Account mit Discord verknüpft hat - aus dem
 * Dashboard-Login (Scope "connections"). Nur bestätigte Verknüpfungen, und nur
 * von Leuten, die sich selbst angemeldet haben. Siehe docs/Notifiers.md.
 */
export default class UserConnections extends Model<IUserConnectionRow> {
    readonly Table: TableName = TABLES.userConnections;
    readonly Key = ["user_id", "platform", "account_id"] as const;

    /** Ersetzt, was von diesem Nutzer gespeichert ist - entfernte Verknüpfungen verschwinden so von selbst. */
    async Replace(userId: string, entries: Omit<IUserConnection, "userId">[]): Promise<void> {
        await this.db.Transaction(async (query) => {
            await query(`DELETE FROM \`${TABLES.userConnections}\` WHERE user_id = ?`, [userId]);

            for (const entry of entries.slice(0, 25)) {
                await query(
                    `INSERT INTO \`${TABLES.userConnections}\` (user_id, platform, account_id, name, updated_at) VALUES (?, ?, ?, ?, ?)`,
                    [userId, entry.platform, entry.accountId.slice(0, 64), entry.name.slice(0, 100), Date.now()]
                );
            }
        });

        this.Forget();
    }

    async Of(userId: string): Promise<IUserConnection[]> {
        return (await this.Where({ user_id: userId })).map(ToConnection);
    }

    /** Wem gehört dieser Twitch- bzw. YouTube-Account? */
    async ByAccount(platform: StreamPlatform, accountId: string): Promise<IUserConnection | null> {
        const rows = await this.Where({ platform, account_id: accountId });

        return rows[0] ? ToConnection(rows[0]) : null;
    }
}
