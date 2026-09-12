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
    /** Eigene Grenze für den Body in Byte; ohne sie gilt Fastifys Standard (1 MiB). Nur setzen, wenn die Route wirklich größere Bodies braucht, z. B. ein Bild-Upload. */
    bodyLimit?: number;
}
