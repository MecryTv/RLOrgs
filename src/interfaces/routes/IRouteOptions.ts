import { HTTPMethods } from "fastify";

export interface IRateLimit {
    max: number;
    timeWindow: string | number;
}

export default interface IRouteOptions {
    /** Eine Methode oder mehrere, wenn dieselbe Adresse liest und schreibt. */
    method: HTTPMethods | HTTPMethods[];
    path: string;
    description: string;
    prefixed?: boolean;
    requiresAuth?: boolean;
    rateLimit?: IRateLimit;
}
