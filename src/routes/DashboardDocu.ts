import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SendPage } from "../utils/dashboard";

/**
 * Die Dokumentation: Ränge, WTSI, Gruppen, Verknüpfung, Einstellungen.
 *
 * Ohne Anmeldung lesbar, aus demselben Grund wie der Datenschutz: Wer eine Zahl
 * in einem geteilten Screenshot sieht, soll nachlesen können, was sie bedeutet,
 * ohne sich erst anzumelden. Die Seite holt keine Daten, sie steht einfach da.
 */
export default class DashboardDocu extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/docu`,
            description: "Dokumentation - Ränge, WTSI, Gruppen und Einstellungen erklärt",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(_request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        return SendPage(this.client, reply, "docu.html");
    }
}
