import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { ActionEntries } from "../builder/TicketPanel";
import { LIVE_CSS } from "../builder/TranscriptHtml";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { CORE_ACTIONS, SLOWMODE_STEPS } from "../constants/Tickets";
import { SlowmodeLabel } from "../services/TicketService";
import { LiveGate } from "../utils/live";

/**
 * Live Tickets: die offenen Tickets, die dieser User sehen darf, und das
 * Aussehen des Chats. Neues kommt danach über den Stream (DashboardApiLiveStream).
 */
export default class DashboardApiLive extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/guild/:id/live`,
            description: "Offene Tickets für Live Tickets",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const access = await LiveGate(this.client, request, reply);

        if (!access) return reply;

        const enabled = new Set<string>([...CORE_ACTIONS, ...access.config.actions]);

        return reply.header("Cache-Control", "no-store").send({
            me: { id: access.member.id, manage: access.manage },
            // Dieselben Aktionen wie im Menü unter dem Ticket - nur, was der Server eingeschaltet hat.
            actions: ActionEntries(this.client)
                .filter((entry) => enabled.has(entry.value))
                .map((entry) => ({ value: entry.value, name: entry.name, emoji: entry.emoji || null, description: entry.description })),
            options: access.config.options.map((option) => ({ id: option.id, name: option.name, emoji: option.emoji })),
            slowmodes: SLOWMODE_STEPS.map((seconds) => ({ value: seconds, label: SlowmodeLabel(seconds) })),
            tickets: await this.client.liveService.Tickets(access),
            // Für die Emoji-Auswahl im Chat: die Emojis des Servers als Bild.
            emojis: [...access.guild.emojis.cache.values()].slice(0, 200).map((emoji) => ({
                id: emoji.id,
                name: emoji.name ?? "",
                animated: Boolean(emoji.animated),
                url: emoji.imageURL({ size: 64 }),
            })),
            css: LIVE_CSS,
        });
    }
}
