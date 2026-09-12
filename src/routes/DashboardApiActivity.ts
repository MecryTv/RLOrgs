import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { SessionOf } from "../utils/dashboard";

export default class DashboardApiActivity extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/guild/:id/activity`,
            description: "Aktivität eines Servers für die Übersicht",
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

        try {
            const activity = await service.Activity(session, id);

            // Wie beim Rest der Serverseite: ob es den Server gibt, verrät die Antwort nicht.
            if (!activity) return reply.code(404).send({ error: "Not Found" });

            if (activity === "offline") {
                return reply
                    .code(503)
                    .send({ error: "Keine Datenbank", hint: "Die Aktivität wird in der Datenbank gezählt." });
            }

            return reply.header("Cache-Control", "no-store").send(activity);
        } catch (error) {
            if (!(error instanceof SessionExpired)) throw error;

            return reply
                .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
                .code(401)
                .send({ error: "Unauthorized" });
        }
    }
}
