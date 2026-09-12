import { FastifyInstance } from "fastify";
import IRouteManager from "./IRouteManager";

export default interface IServer {
    readonly Routes: IRouteManager;
    readonly Instance: FastifyInstance | null;
    readonly IsRunning: boolean;
    readonly BaseURL: string;

    Port: number;
    Host: string;

    Start(): Promise<void>;
    Stop(): Promise<void>;
}
