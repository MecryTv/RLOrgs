import { LRUCache } from "lru-cache";
import { YouTubeChannelId, YouTubeLookupUrl } from "../constants/Streams";

/**
 * YouTube ohne API-Schlüssel: jeder Kanal hat einen öffentlichen Feed mit
 * seinen letzten 15 Videos (Shorts und Livestreams darunter). Nur ob etwas
 * gerade live ist, weiß allein die Data API - dafür braucht es YOUTUBE_API_KEY
 * (eine Einheit Kontingent je 50 neue Videos). Siehe docs/Notifiers.md.
 */

export interface IYouTubeChannel {
    id: string;
    title: string;
    handle: string | null;
    avatar: string | null;
}

export interface IFeedEntry {
    id: string;
    title: string;
    url: string;
    published: number;
    thumbnail: string;
    /** Aus dem Link: /shorts/ ist ein Short. null: der Feed sagt es nicht. */
    short: boolean | null;
}

const TIMEOUT = 10_000;
// Ohne Zustimmung leitet YouTube aus der EU auf eine Einwilligungsseite um.
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    Cookie: "CONSENT=YES+1; SOCS=CAI",
};

// Einmal geprüft, bleibt ein Video, was es ist.
const shorts = new LRUCache<string, boolean>({ max: 2000 });

export function Decode(text: string): string {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

/** Liest den Feed eines Kanals - ohne XML-Bibliothek, er ist immer gleich gebaut. */
export function ParseFeed(xml: string): { title: string; entries: IFeedEntry[] } {
    const title = Decode(/<author>\s*<name>([\s\S]*?)<\/name>/.exec(xml)?.[1] ?? /<title>([\s\S]*?)<\/title>/.exec(xml)?.[1] ?? "");
    const entries: IFeedEntry[] = [];

    for (const [, body] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const id = /<yt:videoId>([\w-]{6,20})<\/yt:videoId>/.exec(body)?.[1];

        if (!id) continue;

        const url = /<link rel="alternate" href="([^"]+)"/.exec(body)?.[1] ?? `https://www.youtube.com/watch?v=${id}`;

        entries.push({
            id,
            title: Decode(/<title>([\s\S]*?)<\/title>/.exec(body)?.[1] ?? ""),
            url,
            published: Date.parse(/<published>([^<]+)<\/published>/.exec(body)?.[1] ?? "") || 0,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            short: url.includes("/shorts/") ? true : null,
        });
    }

    return { title, entries };
}

export async function Feed(channelId: string): Promise<{ title: string; entries: IFeedEntry[] } | null> {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(TIMEOUT),
    }).catch(() => null);

    return response?.ok ? ParseFeed(await response.text()) : null;
}

/** Ist ein Video ein Short? /shorts/<id> antwortet dann mit 200, sonst mit einer Umleitung. */
export async function IsShort(entry: IFeedEntry): Promise<boolean> {
    if (entry.short !== null) return entry.short;

    const known = shorts.get(entry.id);

    if (known !== undefined) return known;

    const response = await fetch(`https://www.youtube.com/shorts/${entry.id}`, {
        method: "HEAD",
        redirect: "manual",
        headers: HEADERS,
        signal: AbortSignal.timeout(TIMEOUT),
    }).catch(() => null);
    const short = response?.status === 200;

    if (response) shorts.set(entry.id, short);

    return short;
}

/** live, upcoming oder none je Video - braucht den API-Schlüssel. */
export async function LiveStates(ids: string[], key: string): Promise<Map<string, "live" | "upcoming" | "none">> {
    const states = new Map<string, "live" | "upcoming" | "none">();

    for (let index = 0; index < ids.length; index += 50) {
        const params = new URLSearchParams({ part: "snippet", id: ids.slice(index, index + 50).join(","), key });
        const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);

        if (!response?.ok) continue;

        const body = (await response.json()) as { items?: { id: string; snippet?: { liveBroadcastContent?: string } }[] };

        for (const item of body.items ?? []) {
            const state = item.snippet?.liveBroadcastContent;

            states.set(item.id, state === "live" || state === "upcoming" ? state : "none");
        }
    }

    return states;
}

/**
 * Ein Kanal aus einer Eingabe: Kanal-ID, Link, @handle. Mit API-Schlüssel über
 * die Data API, ohne über die Kanalseite selbst (dort steht die ID im Quelltext).
 */
export async function ResolveChannel(input: string, key: string): Promise<IYouTubeChannel | null> {
    const direct = YouTubeChannelId(input);
    const lookup = direct ? `https://www.youtube.com/channel/${direct}` : YouTubeLookupUrl(input);

    if (!lookup) return null;

    if (key) {
        const handle = /\/@([\w.-]+)/.exec(lookup)?.[1];
        const params = new URLSearchParams({ part: "snippet", key, ...(direct ? { id: direct } : handle ? { forHandle: `@${handle}` } : {}) });

        if (direct || handle) {
            const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`, { signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
            const body = response?.ok
                ? ((await response.json()) as { items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { high?: { url: string }; default?: { url: string } } } }[] })
                : null;
            const item = body?.items?.[0];

            if (item) {
                return {
                    id: item.id,
                    title: item.snippet.title,
                    handle: item.snippet.customUrl ?? null,
                    avatar: item.snippet.thumbnails?.high?.url ?? item.snippet.thumbnails?.default?.url ?? null,
                };
            }
        }
    }

    const response = await fetch(lookup, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);

    if (!response?.ok) return null;

    const html = await response.text();
    const id =
        direct ??
        /<meta itemprop="identifier" content="(UC[\w-]{22})"/.exec(html)?.[1] ??
        /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
        /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1];

    if (!id) return null;

    return {
        id,
        title: Decode(/<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? /<title>([^<]*)<\/title>/.exec(html)?.[1]?.replace(/ - YouTube$/, "") ?? id),
        handle: /"canonicalBaseUrl":"\/(@[\w.-]+)"/.exec(html)?.[1] ?? null,
        avatar: Decode(/<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? "") || null,
    };
}
