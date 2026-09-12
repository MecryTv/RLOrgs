import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { CooldownOf } from "./DashboardApiAccount";
import { SessionOf } from "../utils/dashboard";
import { EpicConfigured } from "../utils/epic";

/**
 * Was der Einstellungs-Dialog unter "Konten verknüpfen" braucht.
 *
 * Es gibt genau ein Konto: Epic. Steam, Xbox, PlayStation und Switch standen
 * hier einmal als eigene Zeilen - das ist wieder weg, weil es nichts trug:
 * für PlayStation und Nintendo gibt es keinen öffentlichen Login, und die
 * Ränge sind auf allen Plattformen dieselben. Siehe Migration 007.
 */
export default class DashboardApiAccounts extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/accounts`,
            description: "Das verknüpfte Epic-Konto und seine Sperrfrist",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        const epicLogin = EpicConfigured(this.client);

        if (!this.client.databaseService.Ready) {
            return reply.send({
                ready: false,
                epicLogin,
                account: null,
                cooldown: null,
                hint: "Verknüpfungen stehen in der Datenbank - ohne sie gibt es keine.",
            });
        }

        const row = await this.client.accounts.On(session.userId, "epic");

        return reply.header("Cache-Control", "private, no-store").send({
            ready: true,
            epicLogin,
            account: row
                ? {
                      name: row.display_name,
                      accountId: row.account_id,
                      verified: row.verified === 1,
                      linkedAt: new Date(row.linked_at).toISOString(),
                  }
                : null,
            cooldown: await this.client.accounts.Cooldown(session.userId, "epic", CooldownOf(this.client)),
        });
    }
}
