import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SendPage } from "../utils/dashboard";

/**
 * Datenschutz und die WTSI-Erklärung stehen ohne Anmeldung offen.
 *
 * Eine Datenschutzerklärung hinter einem Login wäre keine: wer wissen will, was
 * hier gespeichert wird, soll das lesen können, bevor er sich anmeldet. Beide
 * Seiten holen keine Daten, sie stehen einfach da.
 */
export default class DashboardPrivacy extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/privacy`,
            description: "Datenschutzerklärung - ohne Anmeldung lesbar",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(_request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        return SendPage(this.client, reply, "privacy.html");
    }
}
