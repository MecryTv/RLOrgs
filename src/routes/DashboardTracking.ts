import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { SendPage, SessionOf, Unconfigured } from "../utils/dashboard";

export default class DashboardTracking extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/user/:userId/tracking`,
            description: "Rang-Übersicht eines Spielers",
            prefixed: false,
            requiresAuth: false,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        if (!this.client.dashboardService.IsConfigured) return Unconfigured(reply);

        const { userId } = request.params as { userId?: string };

        if (!userId || !SNOWFLAKE.test(userId)) return reply.code(404).send({ error: "Not Found" });

        // Nach dem Login soll der Browser wieder hier landen.
        if (!SessionOf(this.client, request)) {
            const back = encodeURIComponent(`${DASHBOARD_PATH}/user/${userId}/tracking`);

            return reply.redirect(`${DASHBOARD_PATH}/login?return=${back}`, 302);
        }

        // Wer die Seite sehen darf, entscheidet die API dahinter - die Seite
        // selbst ist nur das Gerüst.
        return SendPage(this.client, reply, "tracking.html");
    }
}
