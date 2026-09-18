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
] as const;

export type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number];

export type PlaceholderValues = Partial<Record<PlaceholderKey, string>>;

/** Die beiden, die als Bildquelle taugen: sie ergeben eine URL. */
export const IMAGE_PLACEHOLDERS = ["{user.avatar}", "{guild.icon}"] as const;

/**
 * Setzt ein, was bekannt ist. Unbekannte Platzhalter bleiben stehen, statt zu
 * verschwinden - ein Tippfehler soll in der Nachricht zu sehen sein.
 */
export function Fill(text: string, values: PlaceholderValues): string {
    return text.replace(/\{([a-z.]+)\}/g, (match, key: string) => values[key as PlaceholderKey] ?? match);
}
