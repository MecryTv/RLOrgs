import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SendPage, SessionOf, Unconfigured } from "../utils/dashboard";

export default class DashboardAdmin extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/admins`,
            description: "Admin-Dashboard für Administratoren und Developer",
            prefixed: false,
            requiresAuth: false,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        if (!this.client.dashboardService.IsConfigured) return Unconfigured(reply);

        // Ohne Sitzung erst anmelden - und danach wieder hierher zurück.
        if (!SessionOf(this.client, request)) {
            return reply.redirect(`${DASHBOARD_PATH}/login?return=${encodeURIComponent(`${DASHBOARD_PATH}/admins`)}`, 302);
        }

        // Die Seite selbst kommt für jeden Angemeldeten - was darauf steht, holt
        // sie über /dashboard/api/admin, und das prüft die Gruppe. Wer nicht darf,
        // sieht eine Absage statt einer leeren Seite.
        return SendPage(this.client, reply, "admins.html");
    }
}
