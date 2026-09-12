import fastify, { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import BotClient from "./client/BotClient";
import RouteManager from "./handler/RouteManager";
import IServer from "./interfaces/services/server/IServer";
import { AssertSecret } from "./utils/jwt";
import logger from "./utils/logger";
import { UPLOAD_TYPES } from "./constants/Gallery";

const DEFAULT_HOST = "0.0.0.0";
const MAX_PORT = 65535;

export default class Server implements IServer {
    client: BotClient;

    private instance: FastifyInstance | null = null;
    private routes: RouteManager;
    private port: number;
    private host: string;

    constructor(client: BotClient) {
        this.client = client;
        this.routes = new RouteManager(client);
        this.port = client.config.SERVER_PORT;
        this.host = DEFAULT_HOST;
    }

    get Routes(): RouteManager {
        return this.routes;
    }

    get Instance(): FastifyInstance | null {
        return this.instance;
    }

    get IsRunning(): boolean {
        return this.instance !== null;
    }

    get BaseURL(): string {
        const { developerMode, config } = this.client;
        const base = developerMode ? `http://localhost:${this.port}` : config.SERVER_PUBLIC_URL;

        return base.replace(/\/+$/, "");
    }

    get Port(): number {
        return this.port;
    }

    set Port(value: number) {
        if (this.IsRunning) throw new Error("Der Port kann nicht geändert werden, während der Server läuft.");
        if (!Number.isInteger(value) || value < 1 || value > MAX_PORT) throw new Error(`Ungültiger Port: ${value}`);

        this.port = value;
    }

    get Host(): string {
        return this.host;
    }

    set Host(value: string) {
        if (this.IsRunning) throw new Error("Der Host kann nicht geändert werden, während der Server läuft.");

        const host = value.trim();
        if (!host) throw new Error("Der Host darf nicht leer sein.");

        this.host = host;
    }

    async Start(): Promise<void> {
        if (this.instance) return;

        AssertSecret(this.client.config.SERVER_JWT_SECRET);

        // Mit und ohne Schrägstrich am Ende dieselbe Route: an der Wurzel heißt
        // das Dashboard "/", im Entwicklungsmodus "/dashboard" - und ein Link auf
        // "/dashboard/" soll nicht ins Leere laufen.
        const instance = fastify({ logger: false, ignoreTrailingSlash: true });

        // Bilder kommen roh: der Browser schickt die Datei als Body, Ziel und
        // Name stehen in der Adresse. Ein Multipart-Paket waere eine Dependency
        // fuer fuenf Zeilen.
        //
        // Kein bodyLimit hier: der Parser gilt serverweit - eine Grenze hier
        // traefe jede POST-Route mit image/*-Body, nicht nur die eine, die
        // wirklich ein Bild erwartet. Ohne eigene Grenze bleibt es beim
        // Fastify-Standard von 1 MiB; die 8 MiB (MAX_IMAGE_BYTES) setzt
        // stattdessen die Galerie-Route selbst ueber IRouteOptions.bodyLimit
        // (Task 8).
        instance.addContentTypeParser(
            UPLOAD_TYPES,
            { parseAs: "buffer" },
            (_request, body, done) => done(null, body)
        );

        await instance.register(rateLimit, {
            global: true,
            max: this.client.config.SERVER_RATE_LIMIT_MAX,
            timeWindow: this.client.config.SERVER_RATE_LIMIT_WINDOW,
        });

        if (this.routes.Size === 0) await this.routes.Load();

        this.routes.Apply(instance);

        await instance.listen({ port: this.port, host: this.host });

        this.instance = instance;

        const secured = this.routes.Routes.filter((route) => route.requiresAuth).size;

        logger.server(
            `🌐 Server läuft auf Port ${this.port} mit ${this.routes.Size} Route(n), ` +
                `davon ${secured} mit Token-Pflicht (öffentlich: ${this.BaseURL})`
        );
    }

    async Stop(): Promise<void> {
        if (!this.instance) return;

        await this.instance.close();
        this.instance = null;

        logger.server("🛑 Server gestoppt");
    }
}
