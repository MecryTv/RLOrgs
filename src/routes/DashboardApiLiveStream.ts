import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { LiveGate } from "../utils/live";

/**
 * Der Stream von Live Tickets: Server-Sent Events, die der Browser mit
 * EventSource liest und bei Abbruch selbst neu verbindet. Ereignisse:
 * ticket (neu, geändert, geschlossen), message, edit, remove.
 */
export default class DashboardApiLiveStream extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/guild/:id/live/stream`,
            description: "Live-Stream der Tickets eines Servers (Server-Sent Events)",
            prefixed: false,
            requiresAuth: false,
            // Jeder Neuaufbau zählt - EventSource versucht es nach einem Abbruch von selbst.
            rateLimit: { max: 30, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const access = await LiveGate(this.client, request, reply);

        if (!access) return reply;

        const raw = reply.raw;
        const stop = this.client.liveService.Subscribe(
            access.guild.id,
            access.member.id,
            (event, data) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            () => raw.write(": ping\n\n")
        );

        if (!stop) return reply.code(429).send({ error: "Zu viele offene Live-Fenster.", hint: "Schließ ein anderes Fenster mit Live Tickets." });

        // Ab hier gehört die Verbindung dem Stream, nicht mehr Fastify.
        reply.hijack();
        raw.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
            // Sonst puffert ein nginx davor die Ereignisse, bis die Verbindung endet.
            "X-Accel-Buffering": "no",
        });
        raw.write("retry: 5000\n\nevent: ready\ndata: {}\n\n");
        request.raw.on("close", stop);

        // Hat der Browser schon während der Prüfung aufgegeben, kommt kein "close" mehr.
        if (request.raw.socket.destroyed) stop();

        return reply;
    }
}
