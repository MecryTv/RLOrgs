import { FastifyReply, FastifyRequest, HTTPMethods } from "fastify";
import BotClient from "../client/BotClient";
import IRoute from "../interfaces/routes/IRoute";
import IRouteOptions, { IRateLimit } from "../interfaces/routes/IRouteOptions";

export const API_PREFIX = "/dcapi";

export default abstract class Route implements IRoute {
    client: BotClient;
    method: HTTPMethods | HTTPMethods[];
    path: string;
    description: string;
    requiresAuth: boolean;
    rateLimit: IRateLimit | null;
    bodyLimit: number | null;

    constructor(client: BotClient, options: IRouteOptions) {
        this.client = client;
        this.method = options.method;
        this.path = options.prefixed === false ? options.path : `${API_PREFIX}${options.path}`;
        this.description = options.description;
        this.requiresAuth = options.requiresAuth ?? true;
        this.rateLimit = options.rateLimit ?? null;
        this.bodyLimit = options.bodyLimit ?? null;
    }

    get Key(): string {
        return `${Array.isArray(this.method) ? this.method.join("|") : this.method} ${this.path}`;
    }

    abstract Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
}
