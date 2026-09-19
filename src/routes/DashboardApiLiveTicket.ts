import path from "path";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { IsImageSource } from "../builder/MessageDoc";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { ResolveImagePath } from "../constants/Gallery";
import { PRIORITIES, TicketPriority } from "../constants/Tickets";
import { TicketError } from "../services/TicketService";
import { WantsJSON } from "../utils/admin";
import { LiveGate, LiveTicket } from "../utils/live";

interface IBody {
    action?: unknown;
    content?: unknown;
    gallery?: unknown;
    priority?: unknown;
    reason?: unknown;
}

const MAX_GALLERY = 10;

/**
 * Ein Ticket in Live Tickets. GET: die letzten Nachrichten, mit ?before=<id>
 * weiter zurück. POST: schreiben (Text, Bilder aus der Galerie), übernehmen,
 * zurückgeben, Priorität, schließen - dieselben Wege wie im Ticket selbst.
 */
export default class DashboardApiLiveTicket extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/live/:ticket`,
            description: "Verlauf und Aktionen eines Tickets in Live Tickets",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 120, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const access = await LiveGate(this.client, request, reply);

        if (!access) return reply;

        const ticket = await LiveTicket(this.client, access, request, reply);

        if (!ticket) return reply;

        if (!writing) {
            const { before } = request.query as { before?: string };
            const history = await this.client.liveService.History(access, ticket, before && /^\d{17,20}$/.test(before) ? before : undefined);

            return reply.header("Cache-Control", "no-store").send(history);
        }

        const body = (request.body ?? {}) as IBody;
        const service = this.client.ticketService;

        try {
            const context = await service.Context(ticket.id);

            if (body.action === "send") {
                const content = typeof body.content === "string" ? body.content : "";
                const files = this.Gallery(access.guild.id, body.gallery);

                await service.SendAsMember(context, access.member, content, files);
            } else if (body.action === "claim") {
                await service.Claim(context, access.member);
            } else if (body.action === "unclaim") {
                await service.Unclaim(context, access.member);
            } else if (body.action === "priority") {
                if (!access.config.actions.includes("priority")) throw new TicketError("Die Priorität ist auf diesem Server nicht zugeschaltet.");
                if (!PRIORITIES.includes(body.priority as TicketPriority)) throw new TicketError("Diese Stufe gibt es nicht.");

                await service.SetPriority(context, access.member, body.priority as TicketPriority);
            } else if (body.action === "close") {
                const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "";

                await service.Close(context, access.member, reason ? `${reason} (Dashboard)` : "Im Dashboard geschlossen");
            } else {
                throw new TicketError("Unbekannte Aktion.");
            }
        } catch (error) {
            if (error instanceof TicketError) return reply.code(400).send({ error: error.message });

            throw error;
        }

        return reply.header("Cache-Control", "no-store").send({ ok: true });
    }

    /** Bilder aus der Galerie als Anhänge - nur eigene Alben und Vorlagen, wie im Nachrichten-Editor. */
    private Gallery(guildId: string, input: unknown): { attachment: string; name: string }[] {
        if (!Array.isArray(input)) return [];

        return input
            .filter((id): id is string => typeof id === "string" && !id.startsWith("https://") && !id.startsWith("{") && IsImageSource(id, guildId))
            .slice(0, MAX_GALLERY)
            .map((id) => ResolveImagePath(id))
            .filter((file): file is string => file !== null)
            .map((file) => ({ attachment: file, name: path.basename(file) }));
    }
}
