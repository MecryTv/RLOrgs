import BotClient from "../../../client/BotClient";
import { TableName } from "../../../constants/Database";

export interface ICacheStats {
    hits: number;
    misses: number;
    size: number;
}

/** Was ein Schreibvorgang zurückmeldet - dieselben Felder wie bei MariaDB. */
export interface IWriteResult {
    affectedRows: number;
    insertId: number;
}

export default interface IDatabaseService {
    client: BotClient;

    /** true, sobald der Pool steht und die Migrationen durch sind. */
    readonly Ready: boolean;
    /** Host, Name und Nutzer sind gesetzt - ohne das wird gar nicht erst verbunden. */
    readonly IsConfigured: boolean;

    /** Verbindet und migriert. Wirft nicht, sondern meldet false - der Bot läuft ohne Datenbank weiter. */
    Connect(): Promise<boolean>;
    Close(): Promise<void>;

    Query<T>(sql: string, params?: unknown[]): Promise<T[]>;
    One<T>(sql: string, params?: unknown[]): Promise<T | null>;
    Write(sql: string, params?: unknown[]): Promise<IWriteResult>;
    /** Alles oder nichts. Bei einem Fehler wird zurückgerollt und weitergeworfen. */
    Transaction<T>(work: (query: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T>;

    /** Liest aus dem Cache oder lädt nach. Der Schlüssel trägt die Version der Tabelle. */
    Cached<T>(table: TableName, key: string, load: () => Promise<T>, ttl?: number): Promise<T>;
    /** Zählt die Version einer Tabelle hoch und macht damit alle alten Einträge unerreichbar. */
    Bump(table: TableName): void;
    Stats(): ICacheStats;
}
