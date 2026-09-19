import { Guild, GuildMember } from "discord.js";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { SessionOf } from "./dashboard";

export interface IModAccess {
    guild: Guild;
    member: GuildMember;
    /** "Server verwalten": Einstellungen, fremde Notizen und Beweise entfernen. */
    manage: boolean;
}

/**
 * Der gemeinsame Anfang der Moderations-Routen: Sitzung, Server, darf
 * moderieren, Datenbank, Modul an, Mitglied. null heißt: die Antwort ist raus.
 */
export async function ModGate(client: BotClient, request: FastifyRequest, reply: FastifyReply): Promise<IModAccess | null> {
    const service = client.dashboardService;
    const session = SessionOf(client, request);

    if (!session) {
        reply.code(401).send({ error: "Unauthorized" });

        return null;
    }

    const { id } = request.params as { id?: string };

    if (!id || !SNOWFLAKE.test(id)) {
        reply.code(404).send({ error: "Not Found" });

        return null;
    }

    try {
        if (!(await service.CanModerate(session, id))) {
            reply.code(403).send({ error: "Forbidden", hint: "Die Moderation gibt es für die Moderatoren dieses Servers." });

            return null;
        }
    } catch (error) {
        if (!(error instanceof SessionExpired)) throw error;

        reply.header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure)).code(401).send({ error: "Unauthorized" });

        return null;
    }

    if (!client.databaseService.Ready) {
        reply.code(503).send({ error: "Keine Datenbank", hint: "Die Fälle stehen in der Datenbank." });

        return null;
    }

    const guild = client.guilds.cache.get(id);

    if (!guild) {
        reply.code(404).send({ error: "Der Bot ist auf diesem Server nicht (mehr) dabei." });

        return null;
    }

    if (!(await client.settings.Of(id)).modules.includes("moderation")) {
        reply.code(409).send({ error: "Das Modul Moderation ist auf diesem Server aus." });

        return null;
    }

    const member = guild.members.cache.get(session.userId) ?? (await guild.members.fetch(session.userId).catch(() => null));

    if (!member) {
        reply.code(403).send({ error: "Forbidden", hint: "Du bist auf diesem Server kein Mitglied." });

        return null;
    }

    return { guild, member, manage: client.moderationService.CanManage(member) };
}
