/**
 * Misst, was ein Seitenaufruf des Dashboards kostet - einmal frisch, einmal mit
 * gefülltem Browser-Cache. Startet den Webserver wie check:dashboard (ohne
 * Discord-Login) und lädt die öffentliche Doku-Seite samt allem, was sie holt.
 *
 *   npx tsx src/scripts/MeasureDashboard.ts
 */
import BotClient from "../client/BotClient";
import { DASHBOARD_PATH } from "../constants/Dashboard";

const PORT = 3478;
const BASE = `http://127.0.0.1:${PORT}`;

interface IHit {
    url: string;
    bytes: number;
    status: number;
    encoding: string;
    cache: string;
    etag: string | null;
}

async function Get(url: string, headers: Record<string, string> = {}): Promise<{ hit: IHit; text: string }> {
    const response = await fetch(url, { headers: { "Accept-Encoding": "br, gzip", ...headers } });
    const body = Buffer.from(await response.arrayBuffer());
    // fetch entpackt selbst - die übertragene Größe steht im Content-Length-Kopf.
    const sent = Number(response.headers.get("content-length") ?? body.length);

    return {
        hit: {
            url,
            bytes: response.status === 304 ? 0 : sent,
            status: response.status,
            encoding: response.headers.get("content-encoding") ?? "-",
            cache: response.headers.get("cache-control") ?? "-",
            etag: response.headers.get("etag"),
        },
        text: body.toString("utf8"),
    };
}

async function main(): Promise<void> {
    const client = new BotClient();

    client.server.Port = PORT;
    await client.server.Start();

    const page = await Get(`${BASE}${DASHBOARD_PATH}/docu`);
    const html = page.text;
    const urls = new Set<string>();

    for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|webp|woff2)(?:\?[^"]*)?)"/g)) urls.add(match[1]);

    const hits: IHit[] = [page.hit];
    const seen = new Set<string>();
    const queue = [...urls];

    // Skripte ziehen ihre Module nach - dem Import-Graph folgen, wie der Browser.
    while (queue.length > 0) {
        const path = queue.shift()!;
        const url = new URL(path, `${BASE}${DASHBOARD_PATH}/docu`).toString();

        if (seen.has(url)) continue;

        seen.add(url);

        const { hit, text } = await Get(url);

        hits.push(hit);

        if (url.includes(".js")) {
            for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+\.js)["']/g)) queue.push(new URL(match[1], url).toString());
        }

        if (url.includes(".css")) {
            for (const match of text.matchAll(/url\("?([^")]+\.woff2)"?\)/g)) {
                // Nur die Schriften, die die Seite wirklich braucht, lädt der Browser - hier alle, als obere Grenze.
                queue.push(new URL(match[1], url).toString());
            }
        }
    }

    const first = hits.reduce((sum, hit) => sum + hit.bytes, 0);

    // Zweiter Aufruf: mit dem, was der Browser sich merken darf.
    let second = 0;
    let requests = 0;

    for (const hit of hits) {
        if (/immutable|max-age=[1-9]/.test(hit.cache) && !hit.cache.includes("no-")) continue;

        requests++;

        const { hit: again } = await Get(hit.url, hit.etag ? { "If-None-Match": hit.etag } : {});

        second += again.bytes;
    }

    const kinds = (test: RegExp) => hits.filter((hit) => test.test(hit.url));

    console.log(`\nErster Aufruf: ${hits.length} Anfragen, ${(first / 1024).toFixed(1)} KB übertragen`);

    for (const [name, test] of [
        ["JS", /\.js/],
        ["CSS", /\.css/],
        ["Schriften", /\.woff2/],
        ["Bilder", /\.(png|webp)/],
    ] as [string, RegExp][]) {
        const list = kinds(test);

        console.log(`  ${name.padEnd(10)} ${String(list.length).padStart(3)} × ${(list.reduce((sum, hit) => sum + hit.bytes, 0) / 1024).toFixed(1).padStart(8)} KB  (${[...new Set(list.map((hit) => hit.encoding))].join(",")} · ${[...new Set(list.map((hit) => hit.cache))].join(" | ")})`);
    }

    console.log(`Zweiter Aufruf: ${requests} Anfragen an den Server, ${(second / 1024).toFixed(1)} KB übertragen\n`);

    process.exit(0);
}

void main();
