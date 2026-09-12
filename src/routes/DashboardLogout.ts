import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SessionOf } from "../utils/dashboard";

export default class DashboardLogout extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/logout`,
            description: "Beendet die Dashboard-Sitzung und löscht das Cookie",
            prefixed: false,
            requiresAuth: false,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;
        const session = SessionOf(this.client, request);

        // Serverseitig zuerst: ein gelöschtes Cookie allein würde die Sitzung
        // im Speicher weiterleben lassen.
        if (session) service.Destroy(session);

        return reply
            .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
            .redirect(`${DASHBOARD_PATH}/login`, 302);
    }
}
