import { Collection } from "discord.js";
import { FastifyInstance } from "fastify";
import Route from "../../../structures/Route";

export default interface IRouteManager {
    readonly Routes: Collection<string, Route>;
    readonly Size: number;
    readonly Keys: string[];

    Register(route: Route): boolean;
    Get(key: string): Route | undefined;
    Has(key: string): boolean;
    Remove(key: string): boolean;
    Clear(): void;

    Load(): Promise<number>;
    Apply(server: FastifyInstance): void;
}
