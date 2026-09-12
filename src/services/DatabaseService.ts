import { readdir, readFile } from "node:fs/promises";
import path from "path";
import mariadb, { Pool, PoolConnection } from "mariadb";
import { LRUCache } from "lru-cache";
import BotClient from "../client/BotClient";
import IDatabaseService, { ICacheStats, IWriteResult } from "../interfaces/services/database/IDatabaseService";
import {
    CACHE_MAX,
    CACHE_TTL,
    CONNECT_TIMEOUT,
    MIGRATIONS_ROOT,
    MIGRATIONS_TABLE,
    TableName,
} from "../constants/Database";
import logger from "../utils/logger";

// Wird geworfen, wenn jemand ohne Datenbank abfragt. Ein eigener Typ, damit
// Aufrufer den Fall von einem echten SQL-Fehler unterscheiden können - das
// Dashboard etwa zeigt dann seine Platzhalter statt einer Fehlerseite.
export class DatabaseUnavailable extends Error {
    constructor() {
        super("Keine Datenbankverbindung.");
        this.name = "DatabaseUnavailable";
    }
}

export default class DatabaseService implements IDatabaseService {
    client: BotClient;

    private pool: Pool | null = null;
    private ready = false;

    // Der Cache ist eine reine Abkürzung und darf jederzeit leer sein.
    // Der Wert steckt in einer Hülle: lru-cache lässt kein null als Wert zu, und
    // so ist "steht drin, ist aber null" von "steht nicht drin" zu unterscheiden.
    private cache = new LRUCache<string, { value: unknown }>({ max: CACHE_MAX, ttl: CACHE_TTL });
    private versions = new Map<string, number>();
    private hits = 0;
    private misses = 0;

    constructor(client: BotClient) {
        this.client = client;
    }

    get Ready(): boolean {
        return this.ready;
    }

    get IsConfigured(): boolean {
        const { DATABASE_HOST, DATABASE_NAME, DATABASE_USER } = this.client.config;

        return Boolean(DATABASE_HOST && DATABASE_NAME && DATABASE_USER);
    }

    // Meldet false statt zu werfen: eine fehlende Datenbank soll den Bot nicht
    // am Start hindern. Was nicht geht, sagen die Log-Zeilen darunter.
    async Connect(): Promise<boolean> {
        if (this.ready) return true;

        if (!this.IsConfigured) {
            logger.warn(
                "🗄️  Datenbank nicht eingerichtet - DATABASE_HOST, DATABASE_NAME und DATABASE_USER in der .env setzen. Der Bot läuft ohne."
            );

            return false;
        }

        const { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_POOL_LIMIT } = this.client.config;

        try {
            this.pool = mariadb.createPool({
                host: DATABASE_HOST,
                port: DATABASE_PORT,
                database: DATABASE_NAME,
                user: DATABASE_USER,
                password: this.client.config.DATABASE_PASSWORD,
                connectionLimit: DATABASE_POOL_LIMIT,
                connectTimeout: CONNECT_TIMEOUT,
                // Ohne das kommen DECIMAL und BIGINT als BigInt zurück und
                // JSON.stringify wirft darüber.
                insertIdAsNumber: true,
                decimalAsNumber: true,
                bigIntAsNumber: true,
                // "auto" fragt die Zeitzone des Servers ab und rechnet damit um.
                // Nachgemessen: mit "Z", "local" oder ganz ohne die Option kamen
                // Zeitstempel exakt zwei Stunden in der Vergangenheit zurück - der
                // Treiber liest die Ziffern dann als Ortszeit, obwohl der Container
                // in UTC läuft. CheckDatabase misst das mit.
                timezone: "auto",
            });

            const probe = await this.pool.getConnection();
            probe.release();

            await this.Migrate();

            this.ready = true;

            logger.info(`🗄️  Datenbank verbunden: ${DATABASE_USER}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}`);

            return true;
        } catch (error) {
            await this.Close();

            logger.error(
                `🗄️  Datenbank nicht erreichbar (${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}) - der Bot läuft ohne. ${String(error)}`
            );

            return false;
        }
    }

    async Close(): Promise<void> {
        this.ready = false;

        const pool = this.pool;
        this.pool = null;

        this.cache.clear();

        if (!pool) return;

        try {
            await pool.end();
        } catch {
            // Beim Herunterfahren ist ein hängender Pool kein Grund für einen Fehler.
        }
    }

    /* ----------------------------------------------------------
       Migrationen
       ---------------------------------------------------------- */
    // Eigene Verbindung mit multipleStatements: eine Migrationsdatei enthält
    // mehrere Anweisungen. Der Pool im Betrieb bleibt bewusst ohne diese Option,
    // damit dort niemals zwei Anweisungen in einem Aufruf landen können.
    private async Migrate(): Promise<void> {
        const { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD } = this.client.config;

        const connection = await mariadb.createConnection({
            host: DATABASE_HOST,
            port: DATABASE_PORT,
            database: DATABASE_NAME,
            user: DATABASE_USER,
            password: DATABASE_PASSWORD,
            connectTimeout: CONNECT_TIMEOUT,
            multipleStatements: true,
        });

        try {
            await connection.query(
                `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
                    name       VARCHAR(128) NOT NULL,
                    applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (name)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci`
            );

            const applied = new Set<string>(
                ((await connection.query(`SELECT name FROM ${MIGRATIONS_TABLE}`)) as { name: string }[]).map(
                    (row) => row.name
                )
            );

            const files = (await readdir(MIGRATIONS_ROOT))
                .filter((file) => file.endsWith(".sql"))
                .sort((a, b) => a.localeCompare(b));

            for (const file of files) {
                if (applied.has(file)) continue;

                const sql = await readFile(path.join(MIGRATIONS_ROOT, file), "utf8");

                // DDL committet in MariaDB sofort - ein Fehler mitten in der Datei
                // lässt sich nicht zurückrollen. Deshalb wird erst nach dem
                // vollständigen Durchlauf vermerkt, dass die Datei durch ist.
                await connection.query(sql);
                await connection.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`, [file]);

                logger.info(`🗄️  Migration ausgeführt: ${file}`);
            }
        } finally {
            await connection.end().catch(() => undefined);
        }
    }

    /* ----------------------------------------------------------
       Abfragen
       ---------------------------------------------------------- */
    private Pool(): Pool {
        if (!this.pool || !this.ready) throw new DatabaseUnavailable();

        return this.pool;
    }

    async Query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        const rows = await this.Pool().query(sql, params);

        // Der Treiber hängt an jedem Ergebnis noch "meta" - das gehört nicht in
        // die Zeilen, die weitergereicht werden.
        return Array.isArray(rows) ? (rows as T[]) : [];
    }

    async One<T>(sql: string, params: unknown[] = []): Promise<T | null> {
        const rows = await this.Query<T>(sql, params);

        return rows[0] ?? null;
    }

    async Write(sql: string, params: unknown[] = []): Promise<IWriteResult> {
        const result = (await this.Pool().query(sql, params)) as { affectedRows?: number; insertId?: number };

        return { affectedRows: result.affectedRows ?? 0, insertId: Number(result.insertId ?? 0) };
    }

    async Transaction<T>(
        work: (query: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<T>
    ): Promise<T> {
        const connection: PoolConnection = await this.Pool().getConnection();

        try {
            await connection.beginTransaction();

            const result = await work((sql, params = []) => connection.query(sql, params));

            await connection.commit();

            return result;
        } catch (error) {
            await connection.rollback().catch(() => undefined);

            throw error;
        } finally {
            connection.release();
        }
    }

    /* ----------------------------------------------------------
       Cache
       Jeder Schlüssel trägt die Version seiner Tabelle. Ein Schreibvorgang
       zählt die Version hoch - damit sind alle alten Einträge auf einen
       Schlag unerreichbar, ohne dass jemand sie einzeln suchen müsste.
       ---------------------------------------------------------- */
    async Cached<T>(table: TableName, key: string, load: () => Promise<T>, ttl: number = CACHE_TTL): Promise<T> {
        const full = `${table}:${this.versions.get(table) ?? 0}:${key}`;
        const hit = this.cache.get(full);

        if (hit) {
            this.hits++;

            return hit.value as T;
        }

        this.misses++;

        const value = await load();

        this.cache.set(full, { value }, { ttl });

        return value;
    }

    // ponytail: eine Version je Tabelle. Ein Schreibvorgang wirft damit auch
    // Einträge anderer Server weg. Feiner wird es erst nötig, wenn viel
    // geschrieben wird - dann die Version pro Server führen.
    Bump(table: TableName): void {
        this.versions.set(table, (this.versions.get(table) ?? 0) + 1);
    }

    Stats(): ICacheStats {
        return { hits: this.hits, misses: this.misses, size: this.cache.size };
    }
}
