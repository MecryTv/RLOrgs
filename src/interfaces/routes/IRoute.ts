import { FastifyReply, FastifyRequest, HTTPMethods } from "fastify";
import BotClient from "../../client/BotClient";
import { IRateLimit } from "./IRouteOptions";

export default interface IRoute {
    client: BotClient;

    method: HTTPMethods | HTTPMethods[];
    path: string;
    description: string;
    requiresAuth: boolean;
    rateLimit: IRateLimit | null;

    readonly Key: string;

    Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
}
