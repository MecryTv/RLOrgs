import { IJWTPayload } from "../interfaces/server/IJWT";

declare module "fastify" {
    interface FastifyRequest {
        token?: IJWTPayload;
    }
}

export {};
