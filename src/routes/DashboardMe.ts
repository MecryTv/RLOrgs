import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SessionOf } from "../utils/dashboard";

export default class DashboardMe extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/me`,
            description: "Nutzer und Serverliste für das Dashboard",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        try {
            const payload = await service.Payload(session);

            return reply.header("Cache-Control", "no-store").send(payload);
        } catch (error) {
            // Discord hat den Token zurückgezogen. Das Cookie muss weg, sonst
            // schickt der Browser es bis zum Ablauf weiter - der 401 bringt ihn
            // dann von selbst zum Login.
            if (!(error instanceof SessionExpired)) throw error;

            return reply
                .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
                .code(401)
                .send({ error: "Unauthorized" });
        }
    }
}
