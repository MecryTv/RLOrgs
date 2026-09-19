import { IMessageDoc } from "../interfaces/builder/IMessageDoc";
import { IStreamConfig, StreamKind, StreamPlatform } from "../interfaces/services/community/ICommunity";

/**
 * Twitch und YouTube Notifier: Farben, Grenzen, Platzhalter und die Vorlagen
 * der Nachrichten. Das Dashboard führt dieselben Platzhalter mit Beschriftung
 * (src/dashboard/client/constants/Placeholders.ts); npm run check:dashboard
 * vergleicht beide.
 */

export const TWITCH_PURPLE = "#9146ff";
export const YOUTUBE_RED = "#ff0033";

/** Je Server und Plattform - mehr wird unübersichtlich und kostet Abfragen. */
export const MAX_NOTIFIERS = 25;

/** Twitch wird jede Minute gefragt (100 Streamer je Abfrage), die Live-Karte zieht höchstens alle fünf Minuten nach. */
export const TWITCH_CARD_EVERY = 5 * 60_000;
/** Die Feeds der YouTube-Kanäle alle fünf Minuten. */
export const YOUTUBE_EVERY = 5 * 60_000;
/** So viele Video-IDs merkt sich der Bot je Kanal - der Feed zeigt die letzten 15. */
export const SEEN_MAX = 60;

export const STREAM_KINDS: Record<StreamPlatform, StreamKind[]> = {
    twitch: ["live"],
    youtube: ["video", "short", "live"],
};

export const KIND_LABELS: Record<StreamKind, string> = { live: "Livestream", video: "Video", short: "Short" };

export const TWITCH_PLACEHOLDER_KEYS = [
    "streamer",
    "streamer.login",
    "streamer.avatar",
    "stream.title",
    "stream.game",
    "stream.url",
    "stream.viewers",
    "stream.preview",
    "stream.started",
    "guild",
] as const;

export const YOUTUBE_PLACEHOLDER_KEYS = [
    "channel",
    "channel.avatar",
    "video.title",
    "video.url",
    "video.thumbnail",
    "video.kind",
    "video.published",
    "guild",
] as const;

export type StreamPlaceholderValues = Partial<Record<(typeof TWITCH_PLACEHOLDER_KEYS)[number] | (typeof YOUTUBE_PLACEHOLDER_KEYS)[number], string>>;

const text = (body: string): IMessageDoc["blocks"][number] => ({ type: "text", body });
const image = (source: string): IMessageDoc["blocks"][number] => ({ type: "image", images: [source] });

/** Die Vorlagen - so steht es da, bis jemand die Nachricht selbst schreibt. */
export function DefaultMessage(platform: StreamPlatform, kind: StreamKind): IMessageDoc {
    if (platform === "twitch") {
        return {
            accent: TWITCH_PURPLE,
            blocks: [text("## 🔴 {streamer} ist live!\n**{stream.title}**\n-# 🎮 {stream.game}"), image("{stream.preview}")],
        };
    }

    if (kind === "short") {
        return { accent: YOUTUBE_RED, blocks: [text("## ⚡ Neuer Short von {channel}\n**{video.title}**"), image("{video.thumbnail}")] };
    }

    if (kind === "live") {
        return { accent: YOUTUBE_RED, blocks: [text("## 🔴 {channel} ist live auf YouTube!\n**{video.title}**"), image("{video.thumbnail}")] };
    }

    return { accent: YOUTUBE_RED, blocks: [text("## 🎬 Neues Video von {channel}\n**{video.title}**"), image("{video.thumbnail}")] };
}

export function DefaultStreamConfig(platform: StreamPlatform): IStreamConfig {
    return {
        channelId: null,
        ping: null,
        kinds: platform === "twitch" ? ["live"] : ["video", "short"],
        messages: {},
        update: true,
        ended: "summary",
    };
}

/** "twitch.tv/name", "https://www.twitch.tv/name", "@name" oder "name" - der Login. */
export function TwitchLogin(input: string): string | null {
    const value = input.trim().replace(/^@/, "");
    const match = /^(?:https?:\/\/)?(?:www\.)?(?:twitch\.tv\/)?([a-z0-9_]{3,25})\/?(?:[?#].*)?$/i.exec(value);

    return match ? match[1].toLowerCase() : null;
}

/** Eine Kanal-ID (UC + 22 Zeichen) in einer Eingabe - oder null. */
export function YouTubeChannelId(input: string): string | null {
    return /(?:^|\/channel\/)(UC[\w-]{22})(?:[/?#]|$)/.exec(input.trim())?.[1] ?? null;
}

/** "@name", "youtube.com/@name", "youtube.com/c/name", "youtube.com/user/name" - die Adresse zum Nachschlagen. */
export function YouTubeLookupUrl(input: string): string | null {
    const value = input.trim();
    const handle = /^@([\w.-]{3,30})$/.exec(value) ?? /youtube\.com\/@([\w.-]{3,30})/i.exec(value);

    if (handle) return `https://www.youtube.com/@${handle[1]}`;

    const legacy = /youtube\.com\/(c|user)\/([\w.-]{1,100})/i.exec(value);

    if (legacy) return `https://www.youtube.com/${legacy[1]}/${legacy[2]}`;

    return /^[\w.-]{3,30}$/.test(value) ? `https://www.youtube.com/@${value}` : null;
}
