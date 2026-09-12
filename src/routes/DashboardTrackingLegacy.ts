import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";

/**
 * Der alte Pfad der Rang-Übersicht: /dashboard/<userId>/tracking.
 *
 * Er muss weiterleben, weil er in der Datenbank steht. Jede Meldung im Postfach
 * trägt ihren Link mit sich - "Epic-Konto verknüpft" von vor der Umstellung
 * zeigt auf die alte Adresse, und diese Zeilen bleiben stehen. Ein 404 wäre
 * eine Sackgasse, in die der Bot selbst geschickt hat.
 *
 * 301 statt 302: die Adresse ist dauerhaft umgezogen, und der Browser darf sich
 * das merken.
 */
export default class DashboardTrackingLegacy extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/:userId/tracking`,
            description: "Alter Tracking-Pfad - leitet auf /dashboard/user/<userId>/tracking",
            prefixed: false,
            requiresAuth: false,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const { userId } = request.params as { userId?: string };

        if (!userId || !SNOWFLAKE.test(userId)) return reply.code(404).send({ error: "Not Found" });

        return reply.redirect(`${DASHBOARD_PATH}/user/${userId}/tracking`, 301);
    }
}
