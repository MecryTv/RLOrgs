import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { IsModule, IsPermanent } from "../constants/Modules";
import { WantsJSON } from "../utils/admin";
import { SessionOf } from "../utils/dashboard";
import logger from "../utils/logger";

interface IBody {
    module?: unknown;
    on?: unknown;
}

export default class DashboardApiModules extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "POST",
            path: `${DASHBOARD_PATH}/api/guild/:id/modules`,
            description: "Schaltet ein Modul auf einem Server an oder aus",
            prefixed: false,
            requiresAuth: false,
            // Enger als beim Lesen, hier wird geschrieben - aber weit genug, um
            // mehrere Schalter hintereinander umzulegen.
            rateLimit: { max: 30, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        if (!WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const { id } = request.params as { id?: string };

        if (!id || !SNOWFLAKE.test(id)) return reply.code(404).send({ error: "Not Found" });

        // Nur Module, die es gibt - sonst landete in guild_settings, was jemand
        // in die Anfrage schreibt.
        const { module: moduleId, on } = (request.body ?? {}) as IBody;

        if (!IsModule(moduleId) || typeof on !== "boolean") {
            return reply.code(400).send({ error: "Unbekanntes Modul oder kein An/Aus" });
        }

        // Vor der Datenbank: die Antwort haengt nicht daran, ob eine erreichbar
        // ist - das Modul laesst sich so oder so nicht ausschalten.
        if (!on && IsPermanent(moduleId)) {
            return reply.code(400).send({
                error: "Dieses Modul lässt sich nicht ausschalten.",
                hint: "Die Galerie gehört fest zum Bot.",
            });
        }

        if (!this.client.databaseService.Ready) {
            return reply.code(503).send({ error: "Keine Datenbank", hint: "Module stehen in der Datenbank." });
        }

        try {
            const modules = await service.SetModule(session, id, moduleId, on);

            // Gilt für fremde wie für unbekannte Server - ob es den Server gibt,
            // verrät die Antwort nicht.
            if (!modules) {
                return reply.code(403).send({ error: "Forbidden", hint: "Nur wer den Server verwalten darf." });
            }

            logger.user(`🧩 Modul ${moduleId} ${on ? "an" : "aus"} auf ${id} (von ${session.userId})`);

            return reply.header("Cache-Control", "no-store").send({ ok: true, modules });
        } catch (error) {
            if (!(error instanceof SessionExpired)) throw error;

            return reply
                .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
                .code(401)
                .send({ error: "Unauthorized" });
        }
    }
}
