import BotClient from "../client/BotClient";
import DatabaseService from "../services/DatabaseService";
import { TableName } from "../constants/Database";
import { IWriteResult } from "../interfaces/services/database/IDatabaseService";

/**
 * Basis für alle Tabellen-Models.
 *
 * Lesen läuft über den Cache, Schreiben zählt die Version der Tabelle hoch und
 * macht die alten Einträge damit unerreichbar. Spalten- und Tabellennamen kommen
 * ausschließlich aus dem Model selbst, Werte ausschließlich als Parameter -
 * zusammengebautes SQL mit Nutzereingaben gibt es hier nirgends.
 */
export default abstract class Model<TRow extends object> {
    protected client: BotClient;

    /** Tabelle, auf der dieses Model arbeitet. */
    abstract readonly Table: TableName;
    /** Spalten des Primärschlüssels. Zusammengesetzte Schlüssel sind erlaubt. */
    abstract readonly Key: readonly string[];

    constructor(client: BotClient) {
        this.client = client;
    }

    protected get db(): DatabaseService {
        return this.client.databaseService;
    }

    /** Ohne Datenbank hat es keinen Zweck, es überhaupt zu versuchen. */
    get Ready(): boolean {
        return this.db.Ready;
    }

    /* ----------------------------------------------------------
       Lesen
       ---------------------------------------------------------- */
    /** Eine Zeile am Primärschlüssel. Die Werte kommen in der Reihenfolge von Key. */
    async Find(...id: (string | number)[]): Promise<TRow | null> {
        const where = this.Key.map((column) => `\`${column}\` = ?`).join(" AND ");

        return this.db.Cached(this.Table, `find:${id.join(":")}`, () =>
            this.db.One<TRow>(`SELECT * FROM \`${this.Table}\` WHERE ${where} LIMIT 1`, id)
        );
    }

    /**
     * Alle Zeilen zu einer Bedingung. Die Spaltennamen stammen aus dem Aufrufer
     * im Code, nie aus einer Eingabe - die Werte gehen als Parameter raus.
     */
    async Where(match: Partial<Record<keyof TRow & string, unknown>>, order?: string): Promise<TRow[]> {
        const columns = Object.keys(match);
        const values = Object.values(match);

        const where = columns.length > 0 ? `WHERE ${columns.map((c) => `\`${c}\` = ?`).join(" AND ")}` : "";
        const sort = order ? ` ORDER BY ${order}` : "";
        const key = `where:${columns.join(",")}:${values.join("|")}:${order ?? ""}`;

        return this.db.Cached(this.Table, key, () =>
            this.db.Query<TRow>(`SELECT * FROM \`${this.Table}\` ${where}${sort}`, values)
        );
    }

    async Count(match: Partial<Record<keyof TRow & string, unknown>> = {}): Promise<number> {
        const columns = Object.keys(match);
        const values = Object.values(match);
        const where = columns.length > 0 ? `WHERE ${columns.map((c) => `\`${c}\` = ?`).join(" AND ")}` : "";

        const row = await this.db.Cached(this.Table, `count:${columns.join(",")}:${values.join("|")}`, () =>
            this.db.One<{ total: number }>(`SELECT COUNT(*) AS total FROM \`${this.Table}\` ${where}`, values)
        );

        return Number(row?.total ?? 0);
    }

    /* ----------------------------------------------------------
       Schreiben
       ---------------------------------------------------------- */
    async Insert(row: Partial<TRow>): Promise<IWriteResult> {
        const columns = Object.keys(row);
        const values = Object.values(row);

        const result = await this.db.Write(
            `INSERT INTO \`${this.Table}\` (${columns.map((c) => `\`${c}\``).join(", ")})` +
                ` VALUES (${columns.map(() => "?").join(", ")})`,
            values
        );

        this.db.Bump(this.Table);

        return result;
    }

    /**
     * Einfügen oder aktualisieren. Genau das, was gebraucht wird, wenn eine
     * Einstellung zum ersten Mal gesetzt wird und beim zweiten Mal nur noch
     * geändert - ohne vorher nachzusehen, ob es die Zeile schon gibt.
     */
    async Upsert(row: Partial<TRow>, update: (keyof TRow & string)[]): Promise<IWriteResult> {
        const columns = Object.keys(row);
        const values = Object.values(row);
        const set = update.map((column) => `\`${column}\` = VALUES(\`${column}\`)`).join(", ");

        const result = await this.db.Write(
            `INSERT INTO \`${this.Table}\` (${columns.map((c) => `\`${c}\``).join(", ")})` +
                ` VALUES (${columns.map(() => "?").join(", ")})` +
                (set ? ` ON DUPLICATE KEY UPDATE ${set}` : ""),
            values
        );

        this.db.Bump(this.Table);

        return result;
    }

    async Update(id: (string | number)[], patch: Partial<TRow>): Promise<IWriteResult> {
        const columns = Object.keys(patch);

        if (columns.length === 0) return { affectedRows: 0, insertId: 0 };

        const where = this.Key.map((column) => `\`${column}\` = ?`).join(" AND ");

        const result = await this.db.Write(
            `UPDATE \`${this.Table}\` SET ${columns.map((c) => `\`${c}\` = ?`).join(", ")} WHERE ${where}`,
            [...Object.values(patch), ...id]
        );

        this.db.Bump(this.Table);

        return result;
    }

    async Delete(...id: (string | number)[]): Promise<IWriteResult> {
        const where = this.Key.map((column) => `\`${column}\` = ?`).join(" AND ");
        const result = await this.db.Write(`DELETE FROM \`${this.Table}\` WHERE ${where}`, id);

        this.db.Bump(this.Table);

        return result;
    }

    /** Wirft den Cache dieser Tabelle weg. Nötig nach Schreibvorgängen an der Datenbank vorbei. */
    Forget(): void {
        this.db.Bump(this.Table);
    }
}
