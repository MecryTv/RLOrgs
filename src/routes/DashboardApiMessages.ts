import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import {
    DefaultMessageDoc,
    DefaultResponseDoc,
    MATCH_LABELS,
    MAX_BUTTONS,
    MAX_MESSAGES,
    MAX_RESPONSES,
    NextRun,
    WEEKDAYS,
} from "../constants/Messages";
import { ICustomMessage } from "../interfaces/services/messages/IMessages";
import { MessageError, MESSAGES_MODULE } from "../services/MessageService";
import { WantsJSON } from "../utils/admin";
import logger from "../utils/logger";
import { GuildResources, IManageAccess, ManageGate } from "../utils/managegate";

interface IBody {
    action?: unknown;
    id?: unknown;
    message?: unknown;
    response?: unknown;
    withMessage?: unknown;
}

/**
 * Custom Message im Dashboard: die Nachrichten mit Knöpfen und Terminen, dazu
 * die Stichwörter des Autoresponders. Siehe docs/Messages.md.
 */
export default class DashboardApiMessages extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/messages`,
            description: "Eigene Nachrichten und Stichwörter eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const access = await ManageGate(this.client, request, reply, MESSAGES_MODULE);

        if (!access) return reply;

        reply.header("Cache-Control", "no-store");

        try {
            if (!writing) return reply.send(await this.Read(access));

            return reply.send(await this.Write(access, (request.body ?? {}) as IBody));
        } catch (error) {
            if (error instanceof MessageError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }

    private Out(message: ICustomMessage, access: IManageAccess) {
        return {
            ...message,
            url: message.channelId && message.messageId ? `https://discord.com/channels/${access.guild.id}/${message.channelId}/${message.messageId}` : null,
            channelName: message.channelId ? (access.guild.channels.cache.get(message.channelId)?.name ?? null) : null,
        };
    }

    private async Read(access: IManageAccess) {
        const { guild } = access;
        const messages = await this.client.customMessages.OfGuild(guild.id);
        const responses = await this.client.autoResponses.OfGuild(guild.id);

        return {
            messages: messages.map((message) => this.Out(message, access)),
            responses,
            limits: { messages: MAX_MESSAGES, responses: MAX_RESPONSES, buttons: MAX_BUTTONS },
            defaults: { message: DefaultMessageDoc(), response: DefaultResponseDoc() },
            weekdays: WEEKDAYS,
            matches: MATCH_LABELS,
            guild: { name: guild.name, ...GuildResources(guild) },
        };
    }

    private async Write(access: IManageAccess, body: IBody): Promise<unknown> {
        const { guild, member } = access;
        const service = this.client.messageService;
        const id = Number(body.id);

        switch (body.action) {
            case "create":
                return { ok: true, message: this.Out(await service.Create(guild, body.message, member.id), access) };

            case "save": {
                const saved = await service.Save(guild, id, body.message);

                logger.user(`✉️ Nachricht "${saved.name}" auf ${guild.id} gespeichert (von ${member.id})`);

                return { ok: true, message: this.Out(saved, access) };
            }

            case "send":
                return { ok: true, message: this.Out(await service.Send(guild, id), access) };

            case "update": {
                const message = await this.client.customMessages.Get(id);

                if (!message || message.guildId !== guild.id) throw new MessageError("Diese Nachricht gibt es nicht mehr.");

                await service.Update(guild, message);

                return { ok: true };
            }

            case "delete":
                await service.Delete(guild, id, body.withMessage === true);

                return { ok: true };

            case "response-add": {
                const response = await service.AddResponse(guild, body.response, member.id);

                return { ok: true, response };
            }

            case "response-save":
                return { ok: true, response: await service.SaveResponse(guild, id, body.response) };

            case "response-delete":
                await service.RemoveResponse(guild, id);

                return { ok: true };

            case "preview": {
                // Zeigt, wann es das nächste Mal rausginge - ohne etwas zu speichern.
                const schedule = service.CleanSchedule(body.message as unknown);

                return { ok: true, next: NextRun(schedule) };
            }

            default:
                throw new MessageError("Unbekannte Aktion.");
        }
    }
}

