import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { SendPage, SessionOf, Unconfigured } from "../utils/dashboard";

// Wie ein Abschnitt heißen darf: "uebersicht", "module" oder die ID eines
// Moduls. Welcher es ist, entscheidet das Frontend - hier wird nur geprüft,
// dass es überhaupt einer sein kann.
const SECTION = /^[a-z][a-z0-9-]{0,31}$/;

export default class DashboardGuild extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/guild/:id/:section?`,
            description: "Serverseite: Übersicht, Module und die Module selbst",
            prefixed: false,
            requiresAuth: false,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        if (!this.client.dashboardService.IsConfigured) return Unconfigured(reply);

        const { id, section } = request.params as { id?: string; section?: string };

        if (!id || !SNOWFLAKE.test(id)) return reply.code(404).send({ error: "Not Found" });
        if (section !== undefined && !SECTION.test(section)) return reply.code(404).send({ error: "Not Found" });

        // Nach dem Login soll der Browser wieder hier landen, im selben Abschnitt.
        if (!SessionOf(this.client, request)) {
            const back = encodeURIComponent(`${DASHBOARD_PATH}/guild/${id}/${section ?? "uebersicht"}`);

            return reply.redirect(`${DASHBOARD_PATH}/login?return=${back}`, 302);
        }

        return SendPage(this.client, reply, "guild.html");
    }
}
