import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";

/**
 * Die WTSI-Erklärung hat keine eigene Seite mehr: sie steht als Kapitel in der
 * Dokumentation, zusammen mit Rängen, Gruppen und dem Rest. Zwei Seiten, die
 * dasselbe erklären, laufen sonst auseinander.
 *
 * Der alte Pfad bleibt trotzdem stehen und leitet weiter - er ist in geteilten
 * Links und in den Docs unterwegs, und ein 404 dort wäre für den Leser nur
 * ärgerlich.
 */
export default class DashboardWTSI extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/wtsi`,
            description: "Alter Pfad der WTSI-Erklärung - leitet auf das Kapitel in der Dokumentation",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(_request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        return reply.redirect(`${DASHBOARD_PATH}/docu#wtsi`, 301);
    }
}
