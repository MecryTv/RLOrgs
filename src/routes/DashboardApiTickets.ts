import { ChannelType, Guild } from "discord.js";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { TicketError } from "../services/TicketService";
import { ActionEntries } from "../builder/TicketPanel";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { CORE_ACTIONS } from "../constants/Tickets";
import { WantsJSON } from "../utils/admin";
import { PersonOf, SearchMembers, SessionOf } from "../utils/dashboard";
import logger from "../utils/logger";

interface IBody {
    action?: unknown;
    config?: unknown;
    channelId?: unknown;
    userId?: unknown;
    query?: unknown;
}

/** Was die Seite zum Einstellen braucht: Rollen, Kanäle, Kategorien, Emojis. */
function Resources(guild: Guild) {
    const channels = [...guild.channels.cache.values()];

    return {
        name: guild.name,
        icon: guild.iconURL({ extension: "png", size: 128 }),
        members: guild.memberCount,
        roles: [...guild.roles.cache.values()]
            .filter((role) => role.id !== guild.id && !role.managed)
            .sort((a, b) => b.position - a.position)
            .slice(0, 200)
            .map((role) => ({ id: role.id, name: role.name, color: role.hexColor })),
        categories: channels
            .filter((channel) => channel.type === ChannelType.GuildCategory)
            .map((channel) => ({ id: channel.id, name: channel.name })),
        channels: channels
            .filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
            .map((channel) => ({ id: channel.id, name: channel.name })),
        forums: channels
            .filter((channel) => channel.type === ChannelType.GuildForum)
            .map((channel) => ({ id: channel.id, name: channel.name })),
        emojis: [...guild.emojis.cache.values()]
            .slice(0, 200)
            .map((emoji) => ({ id: emoji.id, name: emoji.name ?? "", animated: Boolean(emoji.animated), url: emoji.imageURL({ size: 64 }) })),
    };
}

/**
 * Die Ticket-Einstellungen eines Servers. GET liest alles, was die Seite
 * braucht, POST speichert, schickt das Panel oder hebt eine Sperre auf - eine
 * Adresse, damit die Rechteprüfung einmal dasteht.
 */
export default class DashboardApiTickets extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/tickets`,
            description: "Liest und speichert die Ticket-Einstellungen eines Servers",
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

            return reply
                .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
                .code(401)
                .send({ error: "Unauthorized" });
        }

        if (!this.client.databaseService.Ready) {
            return reply.code(503).send({ error: "Keine Datenbank", hint: "Die Einstellungen stehen in der Datenbank." });
        }

        const guild = this.client.guilds.cache.get(id);

        if (!guild) return reply.code(404).send({ error: "Der Bot ist auf diesem Server nicht (mehr) dabei." });

        try {
            if (!writing) return reply.header("Cache-Control", "no-store").send(await this.Read(guild));

            const body = (request.body ?? {}) as IBody;

            return reply.header("Cache-Control", "no-store").send(await this.Write(guild, body, session.userId));
        } catch (error) {
            // Was der Dienst ablehnt, ist eine Angabe des Nutzers - alles andere
            // geht als 500 ins Log (RouteManager.Dispatch).
            if (error instanceof TicketError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }

    private async Read(guild: Guild): Promise<unknown> {
        const config = await this.client.ticketSettings.Of(guild.id);
        const blacklist = await this.client.ticketBlacklist.Of(guild.id);

        // Die eingetragenen Moderatoren mit Namen und Bild. Wer den Server verlassen hat, steht mit ID da.
        const moderators = await Promise.all(
            config.moderators.users.map(async (id) => {
                const member = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));

                return member ? { ...PersonOf(member), gone: false } : { id, name: this.client.users.cache.get(id)?.displayName ?? id, avatar: null, gone: true };
            })
        );

        return {
            config,
            moderators,
            // Wo das Panel wirklich steht - null, wenn die Nachricht weg ist.
            panel: await this.client.ticketService.PanelStatus(guild, config),
            guild: Resources(guild),
            actions: ActionEntries(this.client).map((entry) => ({
                value: entry.value,
                name: entry.name,
                description: entry.description,
                emoji: entry.emoji,
                core: (CORE_ACTIONS as readonly string[]).includes(entry.value),
            })),
            blacklist: blacklist.map((row) => ({
                userId: row.user_id,
                name: this.client.users.cache.get(row.user_id)?.displayName ?? null,
                reason: row.reason,
                by: row.created_by,
                at: new Date(row.created_at).toISOString(),
            })),
        };
    }

    private async Write(guild: Guild, body: IBody, userId: string): Promise<unknown> {
        if (body.action === "save") {
            const config = await this.client.ticketService.Save(guild, body.config);

            logger.user(`🎫 Ticket-Einstellungen auf ${guild.id} gespeichert (von ${userId})`);

            return { ok: true, config };
        }

        if (body.action === "panel") {
            if (typeof body.channelId !== "string" || !SNOWFLAKE.test(body.channelId)) {
                throw new TicketError("Wähle zuerst einen Kanal für das Panel.");
            }

            const { url, state } = await this.client.ticketService.SendPanel(guild, body.channelId);

            logger.user(`🎫 Ticket-Panel auf ${guild.id}: ${state} (von ${userId})`);

            return { ok: true, url, state };
        }

        if (body.action === "unpanel") {
            const removed = await this.client.ticketService.RemovePanel(guild);

            logger.user(`🎫 Ticket-Panel auf ${guild.id} entfernt (von ${userId})`);

            return { ok: true, removed };
        }

        if (body.action === "members") {
            const query = typeof body.query === "string" ? body.query.trim().slice(0, 100) : "";

            return { ok: true, members: (await SearchMembers(guild, query)).map(PersonOf) };
        }

        if (body.action === "unblock") {
            if (typeof body.userId !== "string" || !SNOWFLAKE.test(body.userId)) throw new TicketError("Diese ID passt nicht.");

            return { ok: true, removed: await this.client.ticketBlacklist.Remove(guild.id, body.userId) };
        }

        throw new TicketError("Unbekannte Aktion.");
    }
}
