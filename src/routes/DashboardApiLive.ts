import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { LIVE_CSS } from "../builder/TranscriptHtml";
import { DASHBOARD_PATH } from "../constants/Dashboard";
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

        return reply.header("Cache-Control", "no-store").send({
            me: { id: access.member.id, manage: access.manage },
            // Die Priorität steht nur im Menü, wenn der Server sie zugeschaltet hat - hier genauso.
            priority: access.config.actions.includes("priority"),
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
