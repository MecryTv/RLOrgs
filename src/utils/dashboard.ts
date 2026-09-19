import path from "path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { FastifyReply, FastifyRequest } from "fastify";
import { Guild, GuildMember } from "discord.js";
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
import { COMPRESSIBLE, EncodingOf, MIN_COMPRESS, Pack } from "./compress";

/** Mitglieder nach Name oder User-ID - für Auswahlen im Dashboard. Ohne Bots, höchstens zehn. */
export async function SearchMembers(guild: Guild, query: string): Promise<GuildMember[]> {
    if (!query) return [];

    const found = /^\d{17,20}$/.test(query)
        ? [await guild.members.fetch(query).catch(() => null)]
        : [...((await guild.members.search({ query, limit: 10 }).catch(() => null))?.values() ?? [])];

    return found.filter((member): member is GuildMember => member !== null && !member.user.bot).slice(0, 10);
}

/** Wie eine Person in Auswahlen des Dashboards steht. */
export function PersonOf(member: GuildMember): { id: string; name: string; avatar: string } {
    return { id: member.id, name: member.displayName, avatar: member.displayAvatarURL({ extension: "webp", size: 64 }) };
}

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

/**
 * Eine Datei aus public/assets. Mit ETag: hat der Browser denselben Stand, kommt
 * ein 304 ohne Inhalt. Text, Skripte und SVG gehen gepackt raus (Brotli oder
 * gzip) - die gepackte Fassung wird je Stand gemerkt.
 */
export async function SendFile(reply: FastifyReply, file: string, cache: string): Promise<unknown> {
    const info = await stat(file).catch(() => null);

    if (!info?.isFile()) return reply.code(404).send({ error: "Not Found" });

    const type = AssetTypeOf(file) as string;
    const tag = `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const compressible = COMPRESSIBLE.test(type);

    reply.header("Content-Type", type).header("Cache-Control", cache).header("ETag", tag).header("Last-Modified", info.mtime.toUTCString());

    if (compressible) reply.header("Vary", "Accept-Encoding");

    const known = String(reply.request.headers["if-none-match"] ?? "");

    if (known.split(",").some((entry) => entry.trim() === tag)) return reply.code(304).send();

    const encoding = compressible && info.size >= MIN_COMPRESS ? EncodingOf(reply.request) : null;

    if (!encoding) return reply.header("Content-Length", info.size).send(createReadStream(file));

    return reply.header("Content-Encoding", encoding).send(Pack(await readFile(file), encoding, `${file}|${tag}`));
}

// Prüfsumme einer Datei in public/assets - hängt als ?v= an app.js und style.css.
// Ändert sich die Datei, ändert sich die Adresse, und der Browser darf die alte
// Fassung ein Jahr lang behalten, ohne je eine veraltete zu zeigen.
async function Version(file: string): Promise<string> {
    const body = await readFile(path.join(DASHBOARD_ROOT, "assets", file)).catch(() => null);

    return body ? createHash("sha1").update(body).digest("hex").slice(0, 10) : "0";
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
        .replaceAll(`${BASE_PLACEHOLDER}/assets/app.js"`, `${BASE_PLACEHOLDER}/assets/app.js?v=${await Version("app.js")}"`)
        .replaceAll(`${BASE_PLACEHOLDER}/assets/style.css"`, `${BASE_PLACEHOLDER}/assets/style.css?v=${await Version("style.css")}"`)
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

    reply.header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "no-store").header("Vary", "Accept-Encoding");

    const encoding = EncodingOf(reply.request);

    if (!encoding) return reply.send(body);

    // Im Betrieb ist die Seite fest - dann lohnt es, die gepackte Fassung zu merken.
    return reply.header("Content-Encoding", encoding).send(Pack(body, encoding, DEVELOPER_MODE ? undefined : `page|${name}`));
}
