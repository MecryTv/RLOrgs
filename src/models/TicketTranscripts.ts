import { deflateSync, inflateSync } from "node:zlib";
import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { ITranscript, ITranscriptMeta } from "../interfaces/services/tickets/ITranscript";

export interface ITicketTranscriptRow {
    ticket_id: number;
    guild_id: string;
    number: number;
    code: string | null;
    opener_id: string;
    opener_name: string;
    meta: ITranscriptMeta | string;
    data: Buffer;
    closed_at: number;
    created_at: Date;
}

/** Eine Zeile der Liste - ohne den Verlauf selbst. */
export interface ITranscriptEntry {
    ticketId: number;
    guildId: string;
    number: number;
    code: string | null;
    meta: ITranscriptMeta;
}

/**
 * Transcripts geschlossener Tickets. Der Verlauf ist gepackt und wird nie
 * zwischengespeichert: er kann einige hundert KB groß sein und wird selten gelesen.
 */
export default class TicketTranscripts extends Model<ITicketTranscriptRow> {
    readonly Table: TableName = TABLES.ticketTranscripts;
    readonly Key = ["ticket_id"] as const;

    async Save(transcript: ITranscript): Promise<void> {
        await this.Upsert(
            {
                ticket_id: transcript.ticketId,
                guild_id: transcript.guild.id,
                number: transcript.number,
                code: transcript.code ?? null,
                opener_id: transcript.meta.opener.id,
                opener_name: transcript.meta.opener.name.slice(0, 100),
                meta: JSON.stringify(transcript.meta),
                data: deflateSync(Buffer.from(JSON.stringify(transcript), "utf8")),
                closed_at: transcript.meta.closedAt,
            },
            ["opener_name", "meta", "data", "closed_at"]
        );
    }

    async Has(ticketId: number): Promise<boolean> {
        return (await this.Count({ ticket_id: ticketId })) > 0;
    }

    /** Kopf und Zahlen eines Transcripts - für die Rechteprüfung, ohne den Verlauf auszupacken. */
    async Entry(ticketId: number): Promise<ITranscriptEntry | null> {
        const row = await this.db.One<Omit<ITicketTranscriptRow, "data">>(
            `SELECT ticket_id, guild_id, number, code, meta FROM \`${this.Table}\` WHERE ticket_id = ? LIMIT 1`,
            [ticketId]
        );

        return row ? ToEntry(row) : null;
    }

    async Read(ticketId: number): Promise<ITranscript | null> {
        const row = await this.db.One<{ data: Buffer }>(`SELECT data FROM \`${this.Table}\` WHERE ticket_id = ? LIMIT 1`, [
            ticketId,
        ]);

        return row ? (JSON.parse(inflateSync(row.data).toString("utf8")) as ITranscript) : null;
    }

    /**
     * Die Liste im Dashboard, neueste zuerst, seitenweise über before. Gesucht
     * wird nach Nummer (#42), User-ID oder Name des Erstellers.
     */
    async List(
        guildId: string,
        search: string,
        before: number | null,
        limit: number,
        options: { include?: string[]; exclude?: string[] } = {}
    ): Promise<ITranscriptEntry[]> {
        const where = ["guild_id = ?"];
        const values: unknown[] = [guildId];
        const text = search.trim();
        const option = "JSON_UNQUOTE(JSON_EXTRACT(meta, '$.optionId'))";

        // Supporter sehen nur die Themen ihrer Rolle (TranscriptService.Visible).
        if (options.include) {
            if (options.include.length === 0) return [];

            where.push(`${option} IN (${options.include.map(() => "?").join(", ")})`);
            values.push(...options.include);
        }

        if (options.exclude?.length) {
            where.push(`${option} NOT IN (${options.exclude.map(() => "?").join(", ")})`);
            values.push(...options.exclude);
        }

        if (before !== null) {
            where.push("ticket_id < ?");
            values.push(before);
        }

        // Die Ticket-ID mit Kürzel (SUP-42) oder nur die Nummer (#42, 42).
        // Transcripts von vor den Kürzeln passen zu jedem Kürzel.
        const id = /^(?:#|([A-Z0-9]{2,6})-)?(\d{1,7})$/i.exec(text);

        if (id) {
            where.push("number = ?");
            values.push(Number(id[2]));

            if (id[1]) {
                where.push("(code = ? OR code IS NULL)");
                values.push(id[1].toUpperCase());
            }
        } else if (/^\d{17,20}$/.test(text)) {
            where.push("opener_id = ?");
            values.push(text);
        } else if (text) {
            where.push("opener_name LIKE ?");
            values.push(`%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
        }

        const rows = await this.db.Query<Omit<ITicketTranscriptRow, "data">>(
            `SELECT ticket_id, guild_id, number, code, meta FROM \`${this.Table}\` WHERE ${where.join(" AND ")}` +
                ` ORDER BY ticket_id DESC LIMIT ?`,
            [...values, limit]
        );

        return rows.map(ToEntry);
    }
}

function ToEntry(row: Pick<ITicketTranscriptRow, "ticket_id" | "guild_id" | "number" | "code" | "meta">): ITranscriptEntry {
    return {
        ticketId: Number(row.ticket_id),
        guildId: row.guild_id,
        number: Number(row.number),
        code: row.code ?? null,
        meta: Unpack<ITranscriptMeta>(row.meta, {} as ITranscriptMeta),
    };
}
