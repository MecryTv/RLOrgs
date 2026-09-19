import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { TicketError } from "../services/TicketService";
import { LiveGate, LiveTicket } from "../utils/live";

/** So viel darf eine Datei aus dem Dashboard wiegen - wie ein Galerie-Upload, unter Discords 10 MB. */
export const MAX_LIVE_FILE = 8 * 1024 * 1024;

/** Ein Dateiname, der nirgends etwas anstellt: keine Pfade, keine Steuerzeichen. */
function SafeFileName(value: unknown): string {
    const name = typeof value === "string" ? value.replace(/[^\p{L}\p{N}._ ()-]/gu, "_").replace(/^\.+/, "").slice(-100) : "";

    return name || "datei";
}

/**
 * Eine Datei aus Live Tickets: kommt roh als Body (application/octet-stream),
 * der Name steht in der Adresse - wie beim Galerie-Upload. Der Bot schickt sie
 * sofort als eigene Nachricht, mit Namen und Bild des Teammitglieds.
 */
export default class DashboardApiLiveFile extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "POST",
            path: `${DASHBOARD_PATH}/api/guild/:id/live/:ticket/file`,
            description: "Schickt eine Datei aus Live Tickets ins Ticket",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 30, timeWindow: "1 minute" },
            bodyLimit: MAX_LIVE_FILE,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        // Nur roh: ein Formular von einer fremden Seite kann diesen Typ nicht schicken.
        if (!request.headers["content-type"]?.startsWith("application/octet-stream")) {
            return reply.code(415).send({ error: "Nur application/octet-stream" });
        }

        const access = await LiveGate(this.client, request, reply);

        if (!access) return reply;

        const ticket = await LiveTicket(this.client, access, request, reply);

        if (!ticket) return reply;

        const body = request.body;

        if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: "Die Datei ist leer." });

        const { name } = request.query as { name?: string };

        try {
            const context = await this.client.ticketService.Context(ticket.id);

            await this.client.ticketService.SendAsMember(context, access.member, "", [{ attachment: body, name: SafeFileName(name) }]);
        } catch (error) {
            if (error instanceof TicketError) return reply.code(400).send({ error: error.message });

            throw error;
        }

        return reply.header("Cache-Control", "no-store").send({ ok: true });
    }
}
