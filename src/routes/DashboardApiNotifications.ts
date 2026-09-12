import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { WantsJSON } from "../utils/admin";
import { SessionOf } from "../utils/dashboard";

/**
 * Postfach eines Nutzers.
 *
 * GET liest, POST markiert als gelesen oder räumt auf - beides über dieselbe
 * Adresse, damit es nicht drei Routen für eine Sache gibt.
 */
export default class DashboardApiNotifications extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/notifications`,
            description: "Benachrichtigungen lesen, als gelesen markieren oder löschen",
            prefixed: false,
            requiresAuth: false,
            // Die Seite fragt im Hintergrund regelmäßig nach.
            rateLimit: { max: 120, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        const model = this.client.notifications;

        // Ohne Datenbank gibt es keine Benachrichtigungen - das ist eine leere
        // Liste und kein Fehler, sonst blinkt die Oberfläche rot.
        if (!this.client.databaseService.Ready) {
            return reply.header("Cache-Control", "no-store").send({ available: false, unread: 0, notes: [] });
        }

        if (request.method === "POST") {
            if (!WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

            const { action } = (request.body ?? {}) as { action?: unknown };

            if (action === "read") {
                return reply.send({ ok: true, changed: await model.MarkRead(session.userId) });
            }

            if (action === "clear") {
                return reply.send({ ok: true, removed: await model.Clear(session.userId) });
            }

            return reply.code(400).send({ error: "Unbekannte Aktion" });
        }

        const notes = await model.Of(session.userId);

        return reply.header("Cache-Control", "no-store").send({
            available: true,
            unread: await model.Unread(session.userId),
            notes: notes.map((note) => ({
                id: note.id,
                kind: note.kind,
                title: note.title,
                body: note.body,
                link: note.link,
                read: note.read_at !== null,
                at: new Date(note.created_at).toISOString(),
            })),
        });
    }
}
