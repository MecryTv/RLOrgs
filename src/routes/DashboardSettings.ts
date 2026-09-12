import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { SendPage, SessionOf, Unconfigured } from "../utils/dashboard";

/**
 * Die Einstellungen als eigene Seite statt als Dialog.
 *
 * Anders als beim Tracking gibt es hier nichts Fremdes zu sehen: die Seite zeigt
 * das eigene Konto, die eigenen Verknüpfungen und Schalter, die ohnehin nur im
 * eigenen Browser gelten. Eine fremde ID wird deshalb nicht abgewiesen, sondern
 * auf die eigene umgebogen - ein 403 wäre eine Sackgasse für einen Aufruf, der
 * meist nur ein alter Link oder ein Tippfehler ist.
 */
export default class DashboardSettings extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/user/:userId/settings`,
            description: "Einstellungen: Profil, Töne, Verknüpfungen, Sicherheit",
            prefixed: false,
            requiresAuth: false,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        if (!this.client.dashboardService.IsConfigured) return Unconfigured(reply);

        const { userId } = request.params as { userId?: string };

        if (!userId || !SNOWFLAKE.test(userId)) return reply.code(404).send({ error: "Not Found" });

        const session = SessionOf(this.client, request);

        // Nach dem Login soll der Browser wieder hier landen.
        if (!session) {
            const back = encodeURIComponent(`${DASHBOARD_PATH}/user/${userId}/settings`);

            return reply.redirect(`${DASHBOARD_PATH}/login?return=${back}`, 302);
        }

        if (session.userId !== userId) {
            return reply.redirect(`${DASHBOARD_PATH}/user/${session.userId}/settings`, 302);
        }

        return SendPage(this.client, reply, "settings.html");
    }
}
