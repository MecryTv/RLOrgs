import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import { SessionExpired } from "../services/DashboardService";
import { ILiveAccess } from "../services/LiveService";
import { ClearCookie, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { ITicket } from "../interfaces/services/tickets/ITicket";
import { SessionOf } from "./dashboard";

/**
 * Der gemeinsame Anfang aller Routen von Live Tickets: Sitzung, Server, darf
 * Support machen, Datenbank, Mitglied. null heißt, die Antwort ist schon raus.
 */
export async function LiveGate(client: BotClient, request: FastifyRequest, reply: FastifyReply): Promise<ILiveAccess | null> {
    const service = client.dashboardService;
    const session = SessionOf(client, request);

    if (!session) {
        reply.code(401).send({ error: "Unauthorized" });

        return null;
    }

    const { id } = request.params as { id?: string };

    if (!id || !SNOWFLAKE.test(id)) {
        reply.code(404).send({ error: "Not Found" });

        return null;
    }

    try {
        if (!(await service.CanSupport(session, id))) {
            reply.code(403).send({ error: "Forbidden", hint: "Live Tickets gibt es für das Team dieses Servers." });

            return null;
        }
    } catch (error) {
        if (!(error instanceof SessionExpired)) throw error;

        reply.header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure)).code(401).send({ error: "Unauthorized" });

        return null;
    }

    if (!client.databaseService.Ready) {
        reply.code(503).send({ error: "Keine Datenbank", hint: "Die Tickets stehen in der Datenbank." });

        return null;
    }

    const access = await client.liveService.Access(session.userId, id);

    if (!access) {
        reply.code(404).send({ error: "Der Bot ist auf diesem Server nicht (mehr) dabei." });

        return null;
    }

    return access;
}

/** Das Ticket aus der Adresse - nur ein offenes, nur eins dieses Servers, nur wenn man es sehen darf. */
export async function LiveTicket(
    client: BotClient,
    access: ILiveAccess,
    request: FastifyRequest,
    reply: FastifyReply
): Promise<ITicket | null> {
    const { ticket: raw } = request.params as { ticket?: string };
    const ticket = raw && /^\d{1,10}$/.test(raw) ? await client.tickets.Get(Number(raw)) : null;

    // Ein fremdes Ticket sieht aus wie eins, das es nicht gibt.
    if (!ticket || ticket.status === "closed" || !client.liveService.CanSee(access, ticket)) {
        reply.code(404).send({ error: "Dieses Ticket ist nicht (mehr) offen." });

        return null;
    }

    return ticket;
}
