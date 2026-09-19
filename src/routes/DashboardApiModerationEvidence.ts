import path from "path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { UPLOAD_TYPES } from "../constants/Gallery";
import { MAX_EVIDENCE_BYTES } from "../constants/Moderation";
import { ModerationError } from "../services/ModerationService";
import { ModGate } from "../utils/modgate";

const TYPES: Record<string, string> = { ".webp": "image/webp", ".gif": "image/gif", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/**
 * Beweisbilder eines Falls. POST .../evidence/<fall-nummer>?name=…: das Bild
 * roh als Body (image/*) - wie ein Galerie-Upload. GET .../evidence/<fall-id>/<datei>:
 * das gespeicherte Bild, nur für die Moderatoren des Servers.
 */
export default class DashboardApiModerationEvidence extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/moderation/evidence/:case/:file?`,
            description: "Lädt Beweisbilder eines Moderations-Falls hoch und liefert sie aus",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 120, timeWindow: "1 minute" },
            bodyLimit: MAX_EVIDENCE_BYTES,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const type = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();

        // Nur roh als Bild: ein Formular von einer fremden Seite kann diesen Typ nicht schicken.
        if (request.method === "POST" && !UPLOAD_TYPES.includes(type)) return reply.code(415).send({ error: "Nur PNG, JPG, GIF oder WebP." });

        const access = await ModGate(this.client, request, reply);

        if (!access) return reply;

        const { case: raw, file } = request.params as { case?: string; file?: string };

        if (!raw || !/^\d{1,9}$/.test(raw)) return reply.code(404).send({ error: "Not Found" });

        if (request.method === "GET") {
            // Die Adresse trägt die interne ID des Falls - er muss zu diesem Server gehören.
            const entry = await this.client.modCases.ById(Number(raw));
            const target = entry?.guildId === access.guild.id && file ? this.client.moderationService.EvidencePath(entry.guildId, entry.id, file) : null;
            const info = target ? await stat(target).catch(() => null) : null;

            if (!target || !info?.isFile()) return reply.code(404).send({ error: "Not Found" });

            return reply
                .header("Content-Type", TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream")
                .header("Content-Length", info.size)
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "private, max-age=3600")
                .send(createReadStream(target));
        }

        if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "Das Bild fehlt." });

        const { name } = request.query as { name?: string };
        const actor = { id: access.member.id, name: access.member.displayName, member: access.member };

        try {
            await this.client.moderationService.AddImage(
                access.guild.id,
                actor,
                Number(raw),
                request.body,
                type,
                typeof name === "string" ? name.replace(/[^\p{L}\p{N}._ ()-]/gu, "_").slice(-100) || null : null
            );
        } catch (error) {
            if (error instanceof ModerationError) return reply.code(400).send({ error: error.message });

            throw error;
        }

        return reply.header("Cache-Control", "no-store").send({ ok: true });
    }
}
