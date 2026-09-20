import path from "path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { UPLOAD_TYPES } from "../constants/Gallery";
import { MAX_BACKGROUND_BYTES } from "../constants/Welcome";
import { WelcomeError, WELCOME_MODULE } from "../services/WelcomeService";
import { ManageGate } from "../utils/managegate";

const TYPES: Record<string, string> = { ".webp": "image/webp", ".gif": "image/gif", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/**
 * Das Hintergrundbild einer Begrüßungskarte. POST: das Bild roh als Body
 * (image/*), wie beim Galerie-Upload - der Bot verkleinert es auf 1920px und
 * legt es als WebP ab. GET: dasselbe Bild zurück, nur für den, der den Server
 * verwaltet. Je Server und Richtung gibt es genau eines.
 */
export default class DashboardApiWelcomeBackground extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/welcome/background/:which`,
            description: "Hintergrundbild der Begrüßungskarte",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
            bodyLimit: MAX_BACKGROUND_BYTES,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const type = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();

        // Nur roh als Bild: ein Formular von einer fremden Seite kann diesen Typ nicht schicken.
        if (request.method === "POST" && !UPLOAD_TYPES.includes(type)) return reply.code(415).send({ error: "Nur PNG, JPG, GIF oder WebP." });

        const access = await ManageGate(this.client, request, reply, WELCOME_MODULE);

        if (!access) return reply;

        const raw = (request.params as { which?: string }).which;
        const which = raw === "leave" ? "leave" : "join";
        const service = this.client.welcomeService;

        if (request.method === "GET") {
            const config = await service.Settings(access.guild.id);
            const target = service.BackgroundPath(access.guild.id, which, config[which].card.background);
            const info = target ? await stat(target).catch(() => null) : null;

            if (!target || !info?.isFile()) return reply.code(404).send({ error: "Not Found" });

            return reply
                .header("Content-Type", TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream")
                .header("Content-Length", info.size)
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "private, no-store")
                .send(createReadStream(target));
        }

        const body = request.body;

        if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: "Kein Bild angekommen." });

        try {
            const file = await service.SaveBackground(access.guild, which, body, type);

            return reply.send({ ok: true, file, config: await service.Settings(access.guild.id) });
        } catch (error) {
            if (error instanceof WelcomeError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }
}
