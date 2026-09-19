import { Guild } from "discord.js";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { WantsJSON } from "../utils/admin";
import { PersonOf, SearchMembers, SessionOf } from "../utils/dashboard";
import logger from "../utils/logger";

interface IBody {
    action?: unknown;
    moderators?: unknown;
    query?: unknown;
}

/**
 * Die Moderatoren eines Servers: einzelne User und Rollen. Sie gelten für den
 * ganzen Server - Tickets und Moderation (siehe docs/Moderation.md). GET liest,
 * POST speichert oder sucht Mitglieder. Nur wer den Server verwalten darf.
 */
export default class DashboardApiModerators extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/moderators`,
            description: "Liest und speichert die Moderatoren eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id?: string };

        if (!id || !SNOWFLAKE.test(id)) return reply.code(404).send({ error: "Not Found" });

        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        try {
            if (!(await service.CanManage(session, id))) {
                return reply.code(403).send({ error: "Forbidden", hint: "Nur wer den Server verwalten darf." });
            }
        } catch (error) {
            if (!(error instanceof SessionExpired)) throw error;

            return reply.header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure)).code(401).send({ error: "Unauthorized" });
        }

        if (!this.client.databaseService.Ready) {
            return reply.code(503).send({ error: "Keine Datenbank", hint: "Die Moderatoren stehen in der Datenbank." });
        }

        const guild = this.client.guilds.cache.get(id);

        if (!guild) return reply.code(404).send({ error: "Der Bot ist auf diesem Server nicht (mehr) dabei." });

        reply.header("Cache-Control", "no-store");

        if (!writing) return reply.send(await this.Read(guild));

        const body = (request.body ?? {}) as IBody;

        if (body.action === "members") {
            const query = typeof body.query === "string" ? body.query.trim().slice(0, 100) : "";

            return reply.send({ members: (await SearchMembers(guild, query)).map(PersonOf) });
        }

        if (body.action !== "save") return reply.code(400).send({ error: "Unbekannte Aktion." });

        const before = (await this.client.settings.Of(guild.id)).moderators;
        const after = this.client.ticketService.CleanModerators(guild, body.moderators);

        await this.client.settings.SaveModerators(guild.id, after);

        // Offene Ticket-Kanäle ziehen nach: neue Moderatoren sehen sie, entfernte nicht mehr.
        void this.client.ticketService.SyncModerators(guild, before, after);

        logger.user(`🛡️ Moderatoren auf ${guild.id} gespeichert (${after.users.length} User, ${after.roles.length} Rollen, von ${session.userId})`);

        return reply.send({ ok: true, ...(await this.Read(guild)) });
    }

    /** Die Moderatoren mit Namen und Bild, dazu die Rollen des Servers zur Auswahl. */
    private async Read(guild: Guild) {
        const { moderators } = await this.client.settings.Of(guild.id);

        const users = await Promise.all(
            moderators.users.map(async (userId) => {
                const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));

                // Wer den Server verlassen hat, steht mit Hinweis da - bis ihn jemand entfernt.
                return member
                    ? { ...PersonOf(member), gone: false }
                    : { id: userId, name: this.client.users.cache.get(userId)?.displayName ?? userId, avatar: null, gone: true };
            })
        );

        return {
            moderators: { users, roles: moderators.roles },
            roles: [...guild.roles.cache.values()]
                .filter((role) => role.id !== guild.id && !role.managed)
                .sort((a, b) => b.position - a.position)
                .slice(0, 200)
                .map((role) => ({ id: role.id, name: role.name, color: role.hexColor })),
        };
    }
}
