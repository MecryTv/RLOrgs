import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { WantsJSON } from "../utils/admin";
import { SessionOf } from "../utils/dashboard";

const PAGE_SIZE = 25;

/**
 * Die Transcripts eines Servers für die Seite "Transcriptions". GET: neueste
 * zuerst, 25 je Abruf, weiter über ?before=<ticket>, Suche mit ?q= nach Nummer,
 * User-ID oder Name. POST { action: "delete", id }: ein Transcript samt
 * Anhängen löschen. Lesen darf auch die Support-Rolle (nur ihre Themen),
 * löschen nur, wer den Server verwalten darf.
 */
export default class DashboardApiTranscripts extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/transcripts`,
            description: "Listet und löscht die Transcripts geschlossener Tickets eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id?: string };

        if (!id || !SNOWFLAKE.test(id)) return reply.code(404).send({ error: "Not Found" });

        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        let manage: boolean;

        try {
            manage = await service.CanManage(session, id);

            if (!manage && !(await service.CanSupport(session, id))) {
                return reply.code(403).send({ error: "Forbidden", hint: "Nur das Team dieses Servers." });
            }
        } catch (error) {
            if (!(error instanceof SessionExpired)) throw error;

            return reply
                .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
                .code(401)
                .send({ error: "Unauthorized" });
        }

        if (!this.client.databaseService.Ready) {
            return reply.code(503).send({ error: "Keine Datenbank", hint: "Die Transcripts stehen in der Datenbank." });
        }

        if (writing) {
            if (!manage) return reply.code(403).send({ error: "Forbidden", hint: "Löschen darf nur, wer den Server verwalten darf." });

            const body = (request.body ?? {}) as { action?: unknown; id?: unknown };
            const entry = typeof body.id === "number" ? await this.client.ticketTranscripts.Entry(body.id) : null;

            // Nur die eigenen: eine fremde Nummer sieht aus wie eine, die es nicht gibt.
            if (body.action !== "delete" || !entry || entry.guildId !== id) {
                return reply.code(400).send({ error: "Dieses Transcript gibt es hier nicht." });
            }

            await this.client.transcriptService.Delete(entry);

            return reply.header("Cache-Control", "no-store").send({ ok: true });
        }

        const query = request.query as { q?: string; before?: string };
        const before = query.before && /^\d{1,10}$/.test(query.before) ? Number(query.before) : null;
        const search = typeof query.q === "string" ? query.q.slice(0, 100) : "";
        // Supporter: nur die Themen ihrer Rolle. Ohne Mitglied gibt es für sie nichts.
        let visible: { include?: string[]; exclude?: string[] } = {};

        if (!manage) {
            const access = await this.client.liveService.Access(session.userId, id);

            visible = access ? this.client.transcriptService.Visible(access.member, access.config) : { include: [] };
        }

        const rows = await this.client.ticketTranscripts.List(id, search, before, PAGE_SIZE + 1, visible);

        return reply.header("Cache-Control", "no-store").send({
            transcripts: rows.slice(0, PAGE_SIZE).map((row) => ({ id: row.ticketId, number: row.number, ...row.meta })),
            more: rows.length > PAGE_SIZE,
            // Damit die leere Liste sagen kann, warum sie leer ist.
            enabled: (await this.client.ticketSettings.Of(id)).transcripts.enabled,
            canDelete: manage,
        });
    }
}
