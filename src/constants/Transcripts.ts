import path from "path";

/**
 * Gesicherte Anhänge der Transcripts: transcripts/<server>/<ticket>/<nr>.<endung>.
 * Wie die Uploads der Galerie nicht im Repo (.gitignore).
 */
export const TRANSCRIPT_ROOT = path.join(process.cwd(), "transcripts");

/** So weit liest der Bot beim Schließen zurück. */
export const MAX_TRANSCRIPT_MESSAGES = 5000;

/** Größer bleibt ein Anhang ein Discord-Link - und der läuft nach etwa einem Tag ab. */
export const MAX_TRANSCRIPT_FILE = 25 * 1024 * 1024;

/** Alle gesicherten Anhänge eines Tickets zusammen. */
export const MAX_TRANSCRIPT_BYTES = 100 * 1024 * 1024;

/**
 * Bilder, die in die HTML-Datei für Discord eingebettet werden. Discord nimmt
 * von Bots 10 MB je Datei; was darüber hinaus geht, verlinkt auf die Online-Ansicht.
 */
export const TRANSCRIPT_INLINE_BYTES = 6 * 1024 * 1024;
export const MAX_DISCORD_UPLOAD = 10 * 1024 * 1024;

/** Nur von hier lädt der Bot Anhänge herunter - nie von einer Adresse aus einer Nachricht. */
export const ATTACHMENT_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];

/** Was die Online-Ansicht direkt zeigt. Alles andere kommt als Download, auch SVG. */
export const INLINE_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
};

/** So heißt ein gesicherter Anhang - nie ein Name aus einer Nachricht. */
export const STORED_FILE = /^\d{1,5}\.[a-z0-9]{1,8}$/;

/**
 * Der Schlüssel eines Discord-Anhangs: sein Pfad. cdn.discordapp.com und
 * media.discordapp.net liefern denselben Anhang unter demselben Pfad, und die
 * Signatur im Query-String wechselt - der Pfad bleibt.
 */
export function AttachmentKey(url: string): string | null {
    if (!URL.canParse(url)) return null;

    const parsed = new URL(url);

    if (parsed.protocol !== "https:" || !ATTACHMENT_HOSTS.includes(parsed.hostname)) return null;

    return /^\/(ephemeral-)?attachments\//.test(parsed.pathname) ? parsed.pathname : null;
}
