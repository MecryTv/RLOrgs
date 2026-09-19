/**
 * Die Platzhalter der Ticket-Nachrichten, mit Beschriftung und einem Beispiel
 * für die Vorschau. Der Bot führt dieselben Schlüssel (src/constants/Placeholders.ts);
 * npm run check:dashboard vergleicht beide Listen.
 */
export interface IPlaceholder {
    key: string;
    label: string;
    /** Was die Vorschau zeigt, solange es keinen echten Wert gibt. */
    sample: string;
}

export const PLACEHOLDERS: IPlaceholder[] = [
    { key: "user", label: "User (Erwähnung)", sample: "@du" },
    { key: "user.name", label: "Name des Users", sample: "du" },
    { key: "user.id", label: "ID des Users", sample: "123456789012345678" },
    { key: "user.avatar", label: "Avatar des Users (Bild)", sample: "" },
    { key: "guild", label: "Servername", sample: "Dein Server" },
    { key: "guild.id", label: "Server-ID", sample: "123456789012345678" },
    { key: "guild.icon", label: "Server-Icon (Bild)", sample: "" },
    { key: "guild.members", label: "Mitgliederzahl", sample: "0" },
    { key: "ticket.id", label: "Ticket-ID", sample: "SUP-42" },
    { key: "user.code", label: "User-ID", sample: "U-7K3F" },
    { key: "ticket.option", label: "Gewählte Option", sample: "Support" },
    { key: "ticket.priority", label: "Priorität", sample: "Normal" },
    { key: "ticket.opened", label: "Geöffnet (Zeitpunkt)", sample: "vor 2 Minuten" },
    { key: "ticket.claimer", label: "Wer bearbeitet", sample: "niemand" },
    { key: "support.role", label: "Support-Rolle", sample: "@Team" },
    { key: "closer", label: "Wer geschlossen hat", sample: "@Team" },
    { key: "reason", label: "Grund", sample: "Erledigt" },
    { key: "bot", label: "Der Bot (Erwähnung)", sample: "@RL Nexus" },
];

/** Die beiden, die als Bildquelle taugen - sie ergeben eine URL. */
export const IMAGE_PLACEHOLDERS = ["{user.avatar}", "{guild.icon}"];

/** Twitch Notifier - dieselben Schlüssel wie TWITCH_PLACEHOLDER_KEYS im Bot (constants/Streams.ts). */
export const TWITCH_PLACEHOLDERS: IPlaceholder[] = [
    { key: "streamer", label: "Streamer", sample: "MecryTv" },
    { key: "streamer.login", label: "Twitch-Name", sample: "mecrytv" },
    { key: "streamer.avatar", label: "Profilbild (Bild)", sample: "" },
    { key: "stream.title", label: "Titel des Streams", sample: "Ranked 2v2 bis GC – !discord" },
    { key: "stream.game", label: "Spiel", sample: "Rocket League" },
    { key: "stream.url", label: "Link zum Stream", sample: "https://twitch.tv/mecrytv" },
    { key: "stream.viewers", label: "Zuschauer", sample: "128" },
    { key: "stream.preview", label: "Vorschaubild (Bild)", sample: "" },
    { key: "stream.started", label: "Live seit (Zeitpunkt)", sample: "vor 3 Minuten" },
    { key: "guild", label: "Servername", sample: "Dein Server" },
];

export const TWITCH_IMAGES = ["{stream.preview}", "{streamer.avatar}"];

/** YouTube Notifier - dieselben Schlüssel wie YOUTUBE_PLACEHOLDER_KEYS im Bot. */
export const YOUTUBE_PLACEHOLDERS: IPlaceholder[] = [
    { key: "channel", label: "Kanal", sample: "RL Nexus" },
    { key: "channel.avatar", label: "Kanalbild (Bild)", sample: "" },
    { key: "video.title", label: "Titel", sample: "Die 10 besten Aerial-Tore der Woche" },
    { key: "video.url", label: "Link", sample: "https://youtu.be/dQw4w9WgXcQ" },
    { key: "video.thumbnail", label: "Vorschaubild (Bild)", sample: "" },
    { key: "video.kind", label: "Art (Video, Short, Livestream)", sample: "Video" },
    { key: "video.published", label: "Veröffentlicht (Zeitpunkt)", sample: "vor 2 Minuten" },
    { key: "guild", label: "Servername", sample: "Dein Server" },
];

export const YOUTUBE_IMAGES = ["{video.thumbnail}", "{channel.avatar}"];

/** Setzt ein, was bekannt ist. Unbekanntes bleibt stehen, wie beim Bot. */
export function fill(text: string, values: Record<string, string>): string {
    return text.replace(/\{([a-z.]+)\}/g, (match, key: string) => values[key] ?? match);
}
