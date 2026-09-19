import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { DefaultMessage, MAX_NOTIFIERS, STREAM_KINDS } from "../constants/Streams";
import { IStreamNotifier, StreamKind, StreamPlatform } from "../interfaces/services/community/ICommunity";
import { StreamError, TWITCH_MODULE, YOUTUBE_MODULE } from "../services/StreamService";
import { WantsJSON } from "../utils/admin";
import logger from "../utils/logger";
import { CreateLogThread, LogTargetError, LogTargets } from "../utils/logtarget";
import { GuildResources, IManageAccess, ManageGate } from "../utils/managegate";

interface IBody {
    action?: unknown;
    input?: unknown;
    id?: unknown;
    config?: unknown;
    kind?: unknown;
    settings?: unknown;
    forumId?: unknown;
}

/**
 * Twitch und YouTube Notifier im Dashboard - eine Adresse je Plattform.
 * GET: alle Einträge mit Stand, dazu Kanäle, Rollen, Emojis und was der Bot
 * kann (Twitch-App da? API-Schlüssel da? Presence Intent an?). POST: add,
 * save, remove, test, settings (Live-Rolle), logthread.
 */
export default class DashboardApiStreams extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/streams/:platform`,
            description: "Twitch und YouTube Notifier eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const { platform } = request.params as { platform?: string };

        if (platform !== "twitch" && platform !== "youtube") return reply.code(404).send({ error: "Not Found" });

        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const access = await ManageGate(this.client, request, reply, platform === "twitch" ? TWITCH_MODULE : YOUTUBE_MODULE);

        if (!access) return reply;

        reply.header("Cache-Control", "no-store");

        try {
            if (!writing) return reply.send(await this.Read(access, platform));

            return reply.send(await this.Write(access, platform, (request.body ?? {}) as IBody));
        } catch (error) {
            if (error instanceof StreamError || error instanceof LogTargetError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }

    private Out(notifier: IStreamNotifier) {
        const service = this.client.streamService;

        return {
            id: notifier.id,
            accountId: notifier.accountId,
            name: notifier.accountName,
            login: notifier.accountLogin,
            avatar: notifier.avatar,
            enabled: notifier.enabled,
            config: notifier.config,
            // Was gilt, wenn noch keine eigene Nachricht steht - der Editor zeigt es an.
            messages: Object.fromEntries(STREAM_KINDS[notifier.platform].map((kind) => [kind, service.MessageOf(notifier, kind)])),
            defaults: Object.fromEntries(STREAM_KINDS[notifier.platform].map((kind) => [kind, DefaultMessage(notifier.platform, kind)])),
            live: notifier.state.live ? { title: notifier.state.live.title, game: notifier.state.live.game, viewers: notifier.state.live.viewers, startedAt: notifier.state.live.startedAt } : null,
            last: notifier.state.last ?? null,
            status: service.Status(notifier),
            problem: notifier.state.problem ?? null,
            url: notifier.platform === "twitch" ? `https://twitch.tv/${notifier.accountLogin ?? ""}` : `https://www.youtube.com/channel/${notifier.accountId}`,
        };
    }

    private async Read(access: IManageAccess, platform: StreamPlatform) {
        const { guild } = access;
        const notifiers = await this.client.streamNotifiers.OfGuild(guild.id, platform);
        const config = this.client.config;

        return {
            notifiers: notifiers.map((notifier) => this.Out(notifier)),
            max: MAX_NOTIFIERS,
            // Was fehlt, sagt die Seite oben - statt dass still nichts ankommt.
            ready: {
                twitch: this.client.streamService.twitch.Ready,
                youtubeLive: Boolean(config.YOUTUBE_API_KEY),
                presence: config.GUILD_PRESENCE_INTENT,
            },
            settings: platform === "twitch" ? await this.client.streamService.TwitchSettings(guild.id) : null,
            guild: { name: guild.name, icon: guild.iconURL({ extension: "png", size: 128 }), ...GuildResources(guild) },
            targets: await LogTargets(guild, notifiers.map((notifier) => notifier.config.channelId)),
        };
    }

    private async Write(access: IManageAccess, platform: StreamPlatform, body: IBody): Promise<unknown> {
        const { guild, member } = access;
        const service = this.client.streamService;
        const id = Number(body.id);

        switch (body.action) {
            case "add":
                return { ok: true, notifier: this.Out(await service.Add(guild, platform, body.input, member.id)) };

            case "save": {
                const saved = await service.Save(guild, id, body.config);

                logger.user(`📡 ${platform} ${saved.accountName} auf ${guild.id} gespeichert (von ${member.id})`);

                return { ok: true, notifier: this.Out(saved) };
            }

            case "remove":
                await service.Remove(guild, id);

                return { ok: true };

            case "test": {
                const kind = STREAM_KINDS[platform].includes(body.kind as StreamKind) ? (body.kind as StreamKind) : STREAM_KINDS[platform][0];

                await service.Test(guild, id, kind);

                return { ok: true };
            }

            case "settings":
                if (platform !== "twitch") throw new StreamError("Das gibt es nur bei Twitch.");

                return { ok: true, settings: await service.SaveTwitchSettings(guild, body.settings) };

            case "logthread":
                return {
                    ok: true,
                    thread: await CreateLogThread(guild, body.forumId, platform === "twitch" ? "Live auf Twitch" : "Neu auf YouTube", "📡 Hier meldet RL Nexus neue Streams und Videos."),
                };

            default:
                throw new StreamError("Unbekannte Aktion.");
        }
    }
}
