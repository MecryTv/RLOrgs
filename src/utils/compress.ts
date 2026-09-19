import { FastifyRequest } from "fastify";
import { LRUCache } from "lru-cache";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

export type Encoding = "br" | "gzip";

/** Was sich zu packen lohnt: Text, Skripte, JSON, SVG. Bilder und Schriften sind schon gepackt. */
export const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json)|image\/svg\+xml)/;

/** Darunter kostet das Packen mehr, als es spart. */
export const MIN_COMPRESS = 1024;

/** Brotli, wenn der Browser es kann, sonst gzip - oder gar nicht. */
export function EncodingOf(request: FastifyRequest): Encoding | null {
    const accept = String(request.headers["accept-encoding"] ?? "");

    if (/\bbr\b/.test(accept)) return "br";
    if (/\bgzip\b/.test(accept)) return "gzip";

    return null;
}

// Gepackte Fassungen fester Inhalte (Dateien, Seiten). Sie ändern sich nur mit
// einem Bau - der Schlüssel enthält deshalb den Stand der Datei.
const packed = new LRUCache<string, Buffer>({ maxSize: 32 * 1024 * 1024, sizeCalculation: (body) => body.length || 1 });

/**
 * Packt einen Inhalt. Mit key merkt es sich das Ergebnis (feste Inhalte, dann
 * lohnt die höchste Stufe); ohne key wird jedes Mal gepackt - dafür schneller.
 */
export function Pack(body: Buffer | string, encoding: Encoding, key?: string): Buffer {
    const cached = key ? packed.get(`${encoding}|${key}`) : undefined;

    if (cached) return cached;

    const input = typeof body === "string" ? Buffer.from(body) : body;
    const result =
        encoding === "br"
            ? brotliCompressSync(input, {
                  params: { [constants.BROTLI_PARAM_QUALITY]: key ? 11 : 4, [constants.BROTLI_PARAM_SIZE_HINT]: input.length },
              })
            : gzipSync(input, { level: key ? 9 : 6 });

    if (key) packed.set(`${encoding}|${key}`, result);

    return result;
}
