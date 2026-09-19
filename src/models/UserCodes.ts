import { randomInt } from "node:crypto";
import Model from "../structures/Model";
import { TABLES, TableName } from "../constants/Database";

export interface IUserCodeRow {
    user_id: string;
    code: string;
    created_at: Date;
}

// Crockford-Base32: ohne I, L, O und U - nichts, was man beim Abtippen verwechselt.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function RandomCode(length: number): string {
    return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** Wie die ID überall steht: U-7K3F. Ohne ID null. */
export function UserRef(code: string | null | undefined): string | null {
    return code ? `U-${code}` : null;
}

/**
 * Eine feste, kurze ID je User - dieselbe in all seinen Tickets, auf jedem
 * Server. Vergeben wird sie beim ersten Ticket und ändert sich nie.
 */
export default class UserCodes extends Model<IUserCodeRow> {
    readonly Table: TableName = TABLES.userCodes;
    readonly Key = ["user_id"] as const;

    /** Die ID eines Users - beim ersten Mal wird sie vergeben. */
    async Of(userId: string): Promise<string> {
        const known = await this.Find(userId);

        if (known) return known.code;

        // Vier Zeichen reichen für gut eine Million User. Ist eine schon vergeben,
        // wird neu gewürfelt; nach sechs Versuchen mit fünf Zeichen.
        for (let attempt = 0; attempt < 8; attempt++) {
            const code = RandomCode(attempt < 6 ? 4 : 5);

            try {
                await this.db.Write(`INSERT INTO \`${this.Table}\` (user_id, code) VALUES (?, ?)`, [userId, code]);
                this.db.Bump(this.Table);

                return code;
            } catch (error) {
                if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;

                // Zwei gleichzeitige Tickets desselben Users: das andere war schneller.
                this.db.Bump(this.Table);

                const raced = await this.Find(userId);

                if (raced) return raced.code;
            }
        }

        throw new Error("Keine freie User-ID gefunden.");
    }

    /** Die IDs mehrerer User auf einmal. Wer noch keine hat, fehlt - angelegt wird hier nichts. */
    async Many(userIds: string[]): Promise<Map<string, string>> {
        const unique = [...new Set(userIds)];

        if (unique.length === 0) return new Map();

        const rows = await this.db.Query<Pick<IUserCodeRow, "user_id" | "code">>(
            `SELECT user_id, code FROM \`${this.Table}\` WHERE user_id IN (${unique.map(() => "?").join(", ")})`,
            unique
        );

        return new Map(rows.map((row) => [row.user_id, row.code]));
    }

    /** Der User zu einer ID, mit oder ohne "U-". */
    async UserOf(code: string): Promise<string | null> {
        const clean = code.trim().toUpperCase().replace(/^U-/, "");

        if (!/^[0-9A-Z]{4,6}$/.test(clean)) return null;

        const [row] = await this.Where({ code: clean });

        return row?.user_id ?? null;
    }
}
