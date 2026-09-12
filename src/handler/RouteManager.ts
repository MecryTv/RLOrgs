import path from "path";
import { pathToFileURL } from "node:url";
import { Collection } from "discord.js";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { glob } from "glob";
import BotClient from "../client/BotClient";
import IRouteManager from "../interfaces/services/server/IRouteManager";
import Route from "../structures/Route";
import { VerifyToken } from "../utils/jwt";
import logger from "../utils/logger";

export default class RouteManager implements IRouteManager {
    client: BotClient;

    private routes: Collection<string, Route>;

    constructor(client: BotClient) {
        this.client = client;
        this.routes = new Collection();
    }

    get Routes(): Collection<string, Route> {
        return this.routes;
    }

    get Size(): number {
        return this.routes.size;
    }

    get Keys(): string[] {
        return [...this.routes.keys()];
    }

    Register(route: Route): boolean {
        if (this.routes.has(route.Key)) {
            logger.error(`[RouteManager] Route "${route.Key}" ist bereits registriert.`);
            return false;
        }

        this.routes.set(route.Key, route);
        return true;
    }

    Get(key: string): Route | undefined {
        return this.routes.get(key);
    }

    Has(key: string): boolean {
        return this.routes.has(key);
    }

    Remove(key: string): boolean {
        return this.routes.delete(key);
    }

    Clear(): void {
        this.routes.clear();
    }

    async Load(): Promise<number> {
        const files = await glob("**/*.{ts,js}", {
            cwd: path.join(__dirname, "../routes"),
            absolute: true,
        });

        for (const file of files) {
            try {
                const imported = await import(pathToFileURL(file).href);
                const RouteClass = imported.default?.default ?? imported.default;

                if (typeof RouteClass !== "function") {
                    logger.error(`[RouteManager] Route at ${file} has no default export.`);
                    continue;
                }

                const route: Route = new RouteClass(this.client);

                if (!route.method || !route.path) {
                    logger.error(`[RouteManager] Route at ${file} is missing a method or path.`);
                    continue;
                }

                this.Register(route);
            } catch (error) {
                const normalized = error instanceof Error ? error : new Error(String(error));
                logger.error(`[RouteManager] Error while loading ${file}: ${normalized.message}`);
            }
        }

        return this.routes.size;
    }

    Apply(server: FastifyInstance): void {
        for (const route of this.routes.values()) {
            server.route({
                method: route.method,
                url: route.path,
                config: route.rateLimit ? { rateLimit: route.rateLimit } : {},
                // Nur gesetzt weiterreichen: Fastifys eigene Prüfung akzeptiert
                // "undefined" (Standard bleibt in Kraft), aber kein "null".
                ...(route.bodyLimit ? { bodyLimit: route.bodyLimit } : {}),
                onRequest: route.requiresAuth
                    ? (request: FastifyRequest, reply: FastifyReply) => this.Authenticate(route, request, reply)
                    : undefined,
                handler: (request: FastifyRequest, reply: FastifyReply) => this.Dispatch(route, request, reply),
            });
        }
    }

    private async Authenticate(route: Route, request: FastifyRequest, reply: FastifyReply): Promise<void> {
        const [scheme, token] = (request.headers.authorization ?? "").split(" ");

        const payload =
            scheme?.toLowerCase() === "bearer" && token
                ? VerifyToken(token, this.client.config?.SERVER_JWT_SECRET)
                : null;

        if (!payload) {
            logger.http(request.method, request.url, 401);

            return reply
                .code(401)
                .header("WWW-Authenticate", 'Bearer realm="RL Nexus"')
                .send({ error: "Unauthorized" });
        }

        request.token = payload;
    }

    private async Dispatch(route: Route, request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        try {
            const result = await route.Handle(request, reply);

            logger.http(request.method, request.url, reply.statusCode);

            return result;
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));

            logger.http(request.method, request.url, 500);
            logger.error(`[RouteManager] ${route.Key} ist fehlgeschlagen: ${normalized.message}`);

            this.client.guardian
                ?.HandleServer(normalized.message, { route: route.Key, stack: normalized.stack })
                .catch(() => {});

            return reply.code(500).send({ error: "Internal Server Error" });
        }
    }
}
