import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";

/**
 * Der alte Weg zur Serverseite. Seit die Abschnitte im Pfad stehen, heißt sie
 * /guild/<id>/uebersicht - alte Lesezeichen und Links in Discord-Nachrichten
 * sollen trotzdem ankommen.
 */
export default class DashboardGuildLegacy extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/g/:id`,
            description: "Alter Link auf eine Serverseite - leitet weiter",
            prefixed: false,
            requiresAuth: false,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const { id } = request.params as { id?: string };

        if (!id || !SNOWFLAKE.test(id)) return reply.code(404).send({ error: "Not Found" });

        return reply.redirect(`${DASHBOARD_PATH}/guild/${id}/uebersicht`, 302);
    }
}
