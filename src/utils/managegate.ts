import { Guild, GuildMember } from "discord.js";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { SessionOf } from "./dashboard";

export interface IManageAccess {
    guild: Guild;
    member: GuildMember;
}

/**
 * Der gemeinsame Anfang der Routen von Notifiern, Umfragen und Giveaways:
 * Sitzung, Server, "Server verwalten", Datenbank, Modul an, Mitglied. null
 * heißt: die Antwort ist schon raus.
 */
export async function ManageGate(client: BotClient, request: FastifyRequest, reply: FastifyReply, module: string): Promise<IManageAccess | null> {
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
        if (!(await service.CanManage(session, id))) {
            reply.code(403).send({ error: "Forbidden", hint: "Nur wer den Server verwalten darf." });

            return null;
        }
    } catch (error) {
        if (!(error instanceof SessionExpired)) throw error;

        reply.header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure)).code(401).send({ error: "Unauthorized" });

        return null;
    }

    if (!client.databaseService.Ready) {
        reply.code(503).send({ error: "Keine Datenbank", hint: "Die Einstellungen stehen in der Datenbank." });

        return null;
    }

    const guild = client.guilds.cache.get(id);

    if (!guild) {
        reply.code(404).send({ error: "Der Bot ist auf diesem Server nicht (mehr) dabei." });

        return null;
    }

    if (!(await client.settings.Of(id)).modules.includes(module)) {
        reply.code(409).send({ error: "Das Modul ist auf diesem Server aus." });

        return null;
    }

    const member = guild.members.cache.get(session.userId) ?? (await guild.members.fetch(session.userId).catch(() => null));

    if (!member) {
        reply.code(403).send({ error: "Forbidden", hint: "Du bist auf diesem Server kein Mitglied." });

        return null;
    }

    return { guild, member };
}

/** Was jedes Auswahlfeld braucht: Rollen (ohne @everyone und verwaltete) und Server-Emojis. */
export function GuildResources(guild: Guild) {
    return {
        roles: [...guild.roles.cache.values()]
            .filter((role) => role.id !== guild.id && !role.managed)
            .sort((a, b) => b.position - a.position)
            .slice(0, 200)
            .map((role) => ({ id: role.id, name: role.name, color: role.hexColor })),
        emojis: [...guild.emojis.cache.values()]
            .slice(0, 200)
            .map((emoji) => ({ id: emoji.id, name: emoji.name ?? "", animated: Boolean(emoji.animated), url: emoji.imageURL({ size: 64 }) })),
    };
}
