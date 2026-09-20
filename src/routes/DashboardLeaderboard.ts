import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SendPage } from "../utils/dashboard";

/**
 * Die öffentliche Rangliste eines Servers - ohne Anmeldung.
 *
 * Die Seite selbst steht immer; ob es etwas zu sehen gibt, entscheidet die
 * Route darunter (api/public/levels/:id). So muss diese Seite nichts über
 * Server und Einstellungen wissen. Siehe docs/Levels.md.
 */
export default class DashboardLeaderboard extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/rangliste/:id`,
            description: "Öffentliche Rangliste eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(_request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        return SendPage(this.client, reply, "rangliste.html");
    }
}
