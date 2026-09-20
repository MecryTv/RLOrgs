import { ChannelType, MessageFlags } from "discord.js";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { MAX_HUBS, MAX_PRESETS, VOICE_ACTIONS, VOICE_REGIONS } from "../constants/Voice";
import { IVoiceHub } from "../interfaces/services/voice/IVoice";
import { VoiceError, VOICE_MODULE } from "../services/VoiceService";
import { VoicePanel } from "../builder/VoiceView";
import { WantsJSON } from "../utils/admin";
import logger from "../utils/logger";
import { GuildResources, IManageAccess, ManageGate } from "../utils/managegate";

interface IBody {
    action?: unknown;
    id?: unknown;
    channelId?: unknown;
    config?: unknown;
    settings?: unknown;
}

/**
 * Temp Voice im Dashboard: die Hubs mit ihren Vorgaben, wohin das Panel geht
 * und welche Kanäle gerade offen sind.
 */
export default class DashboardApiVoice extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/voice`,
            description: "Temp-Voice-Hubs eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const access = await ManageGate(this.client, request, reply, VOICE_MODULE);

        if (!access) return reply;

        reply.header("Cache-Control", "no-store");

        try {
            if (!writing) return reply.send(await this.Read(access));

            return reply.send(await this.Write(access, (request.body ?? {}) as IBody));
        } catch (error) {
            if (error instanceof VoiceError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }

    private Out(hub: IVoiceHub, guild: IManageAccess["guild"]) {
        const channel = guild.channels.cache.get(hub.channelId);

        return {
            id: hub.id,
            channelId: hub.channelId,
            channelName: channel?.name ?? null,
            config: hub.config,
        };
    }

    private async Read(access: IManageAccess) {
        const { guild } = access;
        const hubs = await this.client.voiceHubs.OfGuild(guild.id);
        const open = await this.client.tempVoices.OfGuild(guild.id);
        const resources = GuildResources(guild);

        return {
            hubs: hubs.map((hub) => this.Out(hub, guild)),
            max: MAX_HUBS,
            maxPresets: MAX_PRESETS,
            settings: await this.client.voiceService.Settings(guild.id),
            actions: VOICE_ACTIONS,
            regions: VOICE_REGIONS,
            open: open.map((temp) => {
                const channel = guild.channels.cache.get(temp.channelId);
                const owner = guild.members.cache.get(temp.ownerId);

                return {
                    channelId: temp.channelId,
                    name: channel?.name ?? "(weg)",
                    owner: owner?.displayName ?? temp.ownerId,
                    members: channel?.isVoiceBased() ? channel.members.size : 0,
                    privacy: temp.settings.privacy,
                    createdAt: temp.createdAt,
                };
            }),
            guild: {
                name: guild.name,
                ...resources,
                voice: guild.channels.cache
                    .filter((channel) => channel.type === ChannelType.GuildVoice)
                    .map((channel) => ({ id: channel.id, name: channel.name }))
                    .slice(0, 200),
            },
        };
    }

    private async Write(access: IManageAccess, body: IBody): Promise<unknown> {
        const { guild, member } = access;
        const service = this.client.voiceService;
        const id = Number(body.id);

        switch (body.action) {
            case "add":
                return { ok: true, hub: this.Out(await service.AddHub(guild, body.channelId, member.id), guild) };

            case "save": {
                const hub = await service.SaveHub(guild, id, body.config);

                logger.user(`🔊 Voice-Hub ${hub.channelId} auf ${guild.id} gespeichert (von ${member.id})`);

                return { ok: true, hub: this.Out(hub, guild) };
            }

            case "remove":
                await service.RemoveHub(guild, id);

                return { ok: true };

            case "settings":
                return { ok: true, settings: await service.SaveSettings(guild, body.settings) };

            case "panel": {
                const settings = await service.Settings(guild.id);
                const channel = settings.panelChannelId ? guild.channels.cache.get(settings.panelChannelId) : null;

                if (!channel?.isTextBased()) throw new VoiceError("Wähle zuerst einen Textkanal für das Panel.");

                const hubs = await this.client.voiceHubs.OfGuild(guild.id);

                if (!hubs.length) throw new VoiceError("Leg zuerst einen Hub an – sonst steuert das Panel nichts.");

                const sent = await channel
                    .send({ ...VoicePanel(hubs[0].config, false), flags: MessageFlags.IsComponentsV2 })
                    .catch(() => null);

                if (!sent) throw new VoiceError("Die Nachricht ging nicht raus – darf der Bot in den Kanal schreiben?");

                await this.client.moduleSettings.Save(guild.id, VOICE_MODULE, { ...settings, panelMessageId: sent.id });

                return { ok: true, url: `https://discord.com/channels/${guild.id}/${channel.id}/${sent.id}` };
            }

            default:
                throw new VoiceError("Unbekannte Aktion.");
        }
    }
}
