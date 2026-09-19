/**
 * Die Platzhalter der Ticket-Nachrichten. Das Dashboard führt dieselbe Liste mit
 * Beschriftung und Beispielwert (src/dashboard/client/constants/Placeholders.ts);
 * npm run check:dashboard prüft, dass beide übereinstimmen.
 */
export const PLACEHOLDER_KEYS = [
    "user",
    "user.name",
    "user.id",
    "user.avatar",
    "user.code",
    "guild",
    "guild.id",
    "guild.icon",
    "guild.members",
    "ticket.id",
    "ticket.option",
    "ticket.priority",
    "ticket.opened",
    "ticket.claimer",
    "support.role",
    "closer",
    "reason",
    "bot",
] as const;

export type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number];

export type PlaceholderValues = Partial<Record<PlaceholderKey, string>>;

/**
 * Was als Bildquelle taugt: sie ergeben eine URL. Die ersten beiden gehören den
 * Tickets, die übrigen den Notifiern (constants/Streams.ts) - in einer fremden
 * Nachricht ergeben sie nichts, und der Baustein fällt weg.
 */
export const IMAGE_PLACEHOLDERS = ["{user.avatar}", "{guild.icon}", "{streamer.avatar}", "{stream.preview}", "{channel.avatar}", "{video.thumbnail}"] as const;

/** Werte irgendeiner Platzhalter-Liste - Tickets, Twitch, YouTube. */
export type AnyPlaceholderValues = Readonly<Record<string, string | undefined>>;

/**
 * Setzt ein, was bekannt ist. Unbekannte Platzhalter bleiben stehen, statt zu
 * verschwinden - ein Tippfehler soll in der Nachricht zu sehen sein.
 */
export function Fill(text: string, values: AnyPlaceholderValues): string {
    return text.replace(/\{([a-z.]+)\}/g, (match, key: string) => values[key] ?? match);
}
