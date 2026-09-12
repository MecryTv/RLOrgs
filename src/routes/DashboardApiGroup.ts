import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_HOME, DASHBOARD_PATH } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { IsStoredGroup } from "../models/DashboardGroups";
import { StaffOnly, WantsJSON } from "../utils/admin";
import logger from "../utils/logger";

interface IBody {
    userId?: unknown;
    group?: unknown;
    note?: unknown;
}

export default class DashboardApiGroup extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "POST",
            path: `${DASHBOARD_PATH}/api/admin/group`,
            description: "Vergibt oder entzieht eine Dashboard-Gruppe",
            prefixed: false,
            requiresAuth: false,
            // Deutlich enger als beim Lesen: hier wird geschrieben.
            rateLimit: { max: 20, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const session = await StaffOnly(this.client, request, reply);

        if (!session) return reply;

        if (!WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        if (!this.client.databaseService.Ready) {
            return reply.code(503).send({ error: "Keine Datenbank", hint: "Gruppen stehen in der Datenbank." });
        }

        const { userId, group, note } = (request.body ?? {}) as IBody;

        if (typeof userId !== "string" || !SNOWFLAKE.test(userId)) {
            return reply.code(400).send({ error: "userId ist keine Discord-ID" });
        }

        // Kein Text ist ein Entzug - alles andere muss eine bekannte Gruppe sein.
        // "developer" steht bewusst nicht zur Wahl: die Liste lebt in der .env.
        if (group !== null && group !== undefined && !IsStoredGroup(group)) {
            return reply.code(400).send({ error: "Unbekannte Gruppe" });
        }

        // Sonst könnte sich ein Administrator selbst herabstufen und sich damit
        // aus dem Admin-Dashboard aussperren.
        if (userId === session.userId) {
            return reply.code(409).send({ error: "Die eigene Gruppe lässt sich hier nicht ändern" });
        }

        const label = typeof note === "string" ? note.slice(0, 190) : undefined;

        if (IsStoredGroup(group)) {
            await this.client.groups.Grant(userId, group, session.userId, label);

            // Wer eine Gruppe bekommt, soll es auch mitbekommen.
            await this.client.notifications.Push(
                userId,
                "group",
                "Deine Gruppe hat sich geändert",
                `Du bist jetzt ${group}.${label ? ` Notiz: ${label}` : ""}`,
                DASHBOARD_HOME
            );

            logger.user(`👑 Dashboard-Gruppe: ${userId} → ${group} (von ${session.userId})`);

            return reply.send({ ok: true, userId, group });
        }

        const removed = await this.client.groups.Revoke(userId);

        if (removed) {
            await this.client.notifications.Push(
                userId,
                "group",
                "Deine Gruppe wurde entzogen",
                "Du bist wieder in der Testphase.",
                DASHBOARD_HOME
            );
        }

        logger.user(`👑 Dashboard-Gruppe entzogen: ${userId} (von ${session.userId})`);

        return reply.send({ ok: true, userId, group: null, removed });
    }
}
