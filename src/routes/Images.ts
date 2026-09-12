import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { ResolveImagePath, TypeOf } from "../constants/Gallery";

const CACHE_CONTROL = "public, max-age=86400";

function SafeDecode(value: string): string | null {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

export default class Images extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: "/images/*",
            description: "Liefert Galerie-Bilder aus src/images aus",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 300, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const params = request.params as { "*"?: string };
        const relative = SafeDecode(params["*"] ?? "");
        const file = relative ? ResolveImagePath(relative) : null;

        if (!file) return reply.code(403).send({ error: "Forbidden" });

        const info = await stat(file).catch(() => null);

        if (!info?.isFile()) return reply.code(404).send({ error: "Not Found" });

        return reply
            .header("Content-Type", TypeOf(file) as string)
            .header("Content-Length", info.size)
            .header("Cache-Control", CACHE_CONTROL)
            .send(createReadStream(file));
    }
}
