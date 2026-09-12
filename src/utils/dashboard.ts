import path from "path";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import IDashboardSession from "../interfaces/services/dashboard/IDashboardSession";
import {
    AssetTypeOf,
    BASE_PLACEHOLDER,
    DASHBOARD_PATH,
    DASHBOARD_ROOT,
    DEVELOPER_MODE,
    ParseCookies,
    SESSION_COOKIE,
    SITE_PLACEHOLDER,
} from "../constants/Dashboard";

export function SessionOf(client: BotClient, request: FastifyRequest): IDashboardSession | null {
    return client.dashboardService.Session(ParseCookies(request.headers.cookie)[SESSION_COOKIE]);
}

// Ohne Client Secret gibt es keinen Login. Das sagen wir deutlich, statt den
// Nutzer auf eine Discord-Fehlerseite laufen zu lassen.
export function Unconfigured(reply: FastifyReply): FastifyReply {
    return reply.code(503).send({
        error: "Dashboard nicht eingerichtet",
        hint: "CLIENT_SECRET (bzw. DEV_CLIENT_SECRET) in der .env setzen - siehe docs/Dashboard.md.",
    });
}

export async function SendFile(reply: FastifyReply, file: string, cache: string): Promise<unknown> {
    const info = await stat(file).catch(() => null);

    if (!info?.isFile()) return reply.code(404).send({ error: "Not Found" });

    return reply
        .header("Content-Type", AssetTypeOf(file) as string)
        .header("Content-Length", info.size)
        .header("Cache-Control", cache)
        .send(createReadStream(file));
}

/**
 * Die HTML-Seiten, fertig für die Adresse, unter der das Dashboard läuft.
 *
 * In den Dateien steht `__BASE__` dort, wo ein eigener Pfad beginnt. Beim
 * Ausliefern wird daraus `/dashboard` (Entwicklung) oder nichts (eigene
 * Domain) - siehe `BASE_PLACEHOLDER` in constants/Dashboard.ts. So gibt es
 * weiterhin genau eine Fassung jeder Seite.
 *
 * Im Betrieb wird das Ergebnis gemerkt; im Entwicklungsmodus nicht, sonst
 * bräuchte jede Änderung am HTML einen Neustart des Bots.
 */
const pages = new Map<string, string>();

async function PageBody(client: BotClient, name: string): Promise<string | null> {
    const cached = pages.get(name);

    if (cached !== undefined) return cached;

    const raw = await readFile(path.join(DASHBOARD_ROOT, name), "utf8").catch(() => null);

    if (raw === null) return null;

    const body = raw
        .replaceAll(BASE_PLACEHOLDER, DASHBOARD_PATH)
        .replaceAll(SITE_PLACEHOLDER, client.config.SITE_PUBLIC_URL.replace(/\/+$/, ""));

    if (!DEVELOPER_MODE) pages.set(name, body);

    return body;
}

// Seiten nie zwischenspeichern: sonst zeigt der Zurück-Button nach dem Logout
// noch die alte Ansicht an.
export async function SendPage(client: BotClient, reply: FastifyReply, name: string): Promise<unknown> {
    const body = await PageBody(client, name);

    if (body === null) return reply.code(404).send({ error: "Not Found" });

    return reply.header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "no-store").send(body);
}
