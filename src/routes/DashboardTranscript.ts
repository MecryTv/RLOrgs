import path from "path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { INLINE_TYPES, STORED_FILE } from "../constants/Transcripts";
import { SessionOf, Unconfigured } from "../utils/dashboard";

// Die Seite zeigt fremden Text: kein Skript, keine Formulare, nicht einbettbar.
const PAGE_POLICY =
    "default-src 'none'; img-src 'self' https: data:; media-src 'self' https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

function Missing(reply: FastifyReply, code: number, text: string): FastifyReply {
    return reply
        .code(code)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
        .header("Cache-Control", "no-store")
        .send(
            `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Transcript</title>` +
                `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#313338;color:#dbdee1;font:16px/1.5 system-ui,sans-serif">` +
                `<p style="max-width:420px;padding:24px;text-align:center">${text}</p></body></html>`
        );
}

/**
 * Ein Transcript ansehen: /transcript/<ticket> ist die Seite, ?download=1 die
 * Datei zum Mitnehmen, /transcript/<ticket>/<anhang> ein gesicherter Anhang.
 * Wer nicht angemeldet ist, geht erst über den Login und landet wieder hier.
 */
export default class DashboardTranscript extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/transcript/:id/:file?`,
            description: "Zeigt ein Ticket-Transcript und liefert seine gesicherten Anhänge",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 240, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        if (!this.client.dashboardService.IsConfigured) return Unconfigured(reply);

        const { id, file } = request.params as { id?: string; file?: string };

        if (!id || !/^\d{1,10}$/.test(id)) return reply.code(404).send({ error: "Not Found" });
        if (file !== undefined && !STORED_FILE.test(file)) return reply.code(404).send({ error: "Not Found" });

        const session = SessionOf(this.client, request);

        if (!session) {
            if (file !== undefined) return reply.code(401).send({ error: "Unauthorized" });

            return reply.redirect(`${DASHBOARD_PATH}/login?return=${encodeURIComponent(`${DASHBOARD_PATH}/transcript/${id}`)}`, 302);
        }

        if (!this.client.databaseService.Ready) return Missing(reply, 503, "Der Bot erreicht gerade seine Datenbank nicht.");

        const service = this.client.transcriptService;
        const entry = await this.client.ticketTranscripts.Entry(Number(id));

        // Gibt es nicht und darfst du nicht sehen sieht gleich aus - sonst
        // ließe sich abzählen, welche Tickets es gibt.
        if (!entry || !(await service.CanRead(session.userId, entry))) {
            return file !== undefined
                ? reply.code(404).send({ error: "Not Found" })
                : Missing(reply, 404, "Dieses Transcript gibt es nicht – oder du darfst es nicht sehen.");
        }

        if (file !== undefined) {
            const target = service.FilePath(entry, file);
            const info = target ? await stat(target).catch(() => null) : null;

            if (!target || !info?.isFile()) return reply.code(404).send({ error: "Not Found" });

            const type = INLINE_TYPES[path.extname(file)];

            return reply
                .header("Content-Type", type ?? "application/octet-stream")
                .header("Content-Length", info.size)
                .header("Content-Disposition", type ? "inline" : `attachment; filename="${file}"`)
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "private, max-age=3600")
                .send(createReadStream(target));
        }

        const download = (request.query as { download?: string }).download === "1";

        if (download) {
            const transcript = await this.client.ticketTranscripts.Read(entry.ticketId);
            const html = transcript ? await service.File(transcript, null) : null;

            if (!html) return Missing(reply, 404, "Dieses Transcript gibt es nicht mehr.");

            return reply
                .header("Content-Type", "text/html; charset=utf-8")
                .header("Content-Disposition", `attachment; filename="ticket-${String(entry.number).padStart(4, "0")}.html"`)
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "no-store")
                .send(html);
        }

        const page = await service.Page(entry);

        if (!page) return Missing(reply, 404, "Dieses Transcript gibt es nicht mehr.");

        return reply
            .header("Content-Type", "text/html; charset=utf-8")
            .header("Content-Security-Policy", PAGE_POLICY)
            .header("X-Content-Type-Options", "nosniff")
            .header("X-Robots-Tag", "noindex, nofollow")
            .header("Referrer-Policy", "no-referrer")
            .header("Cache-Control", "no-store")
            .send(page);
    }
}
