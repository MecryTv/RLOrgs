import path from "path";

export const DASHBOARD_ROOT = path.join(process.cwd(), "src", "dashboard", "public");

// Nur dieser Unterordner ist öffentlich abrufbar - Stylesheets, Skripte und
// Bilder liegen alle darin. Die HTML-Seiten liegen eine Ebene darüber und
// werden ausschließlich namentlich ausgeliefert.
export const ASSETS_ROOT = path.join(DASHBOARD_ROOT, "assets");

/**
 * Wo das Dashboard haengt.
 *
 * Im Entwicklungsmodus teilt es sich den Server mit der API und liegt deshalb
 * unter `/dashboard`. Im Betrieb hat es eine eigene Domain - die Hauptseite
 * steht auf nexus-emb.de, das Dashboard auf dashboard.nexus-emb.de - und liegt
 * dort an der Wurzel. Dann ist das Praefix leer und aus `/dashboard/api/me`
 * wird `/api/me`.
 *
 * Aus derselben Quelle wie `BotClient.developerMode`, weil dieser Wert schon
 * beim Laden der Routen feststehen muss - da gibt es den Client noch nicht.
 *
 * Das Frontend liest denselben Pfad an seiner eigenen Adresse ab, siehe
 * `dashboard/client/core/Base.ts`; die HTML-Seiten tragen ihn als Platzhalter,
 * siehe `BASE_PLACEHOLDER` weiter unten.
 */
export const DEVELOPER_MODE = process.argv.includes("--dev");

export const DASHBOARD_PATH = DEVELOPER_MODE ? "/dashboard" : "";

/**
 * Derselbe Ort, aber als Pfad, der mit "/" beginnt.
 *
 * Fastify und Cookies nehmen kein leeres Praefix an: an der Wurzel heisst der
 * Pfad "/" und nicht "".
 */
export const DASHBOARD_HOME = DASHBOARD_PATH || "/";

/**
 * Steht in den HTML-Seiten dort, wo sonst `/dashboard` stuende.
 *
 * `SendPage()` ersetzt ihn beim Ausliefern durch `DASHBOARD_PATH`. Damit
 * funktionieren dieselben Dateien unter beiden Adressen, ohne dass irgendwo
 * eine zweite Fassung gepflegt werden muss.
 */
export const BASE_PLACEHOLDER = "__BASE__";

/** Dasselbe fuer die Adresse der Hauptseite (SITE_PUBLIC_URL). */
export const SITE_PLACEHOLDER = "__SITE__";

export const DISCORD_API = "https://discord.com/api/v10";
export const DISCORD_CDN = "https://cdn.discordapp.com";
export const DISCORD_EPOCH = 1420070400000;

// "identify" für Name und Avatar, "guilds" für die Serverliste,
// "guilds.members.read" für die eigenen Mitgliedsdaten auf der Detailseite,
// "email" für die Adresse im Konto-Bereich der Einstellungen.
// Achtung: der Scope heißt "members" (Plural), der Endpunkt dazu "/member"
// (Singular). Ein falscher Scope fällt erst bei Discord auf - CheckDashboard
// prüft die Namen deshalb gegen die offizielle Liste.
// Jeder Scope kostet eine Zeile im Zustimmungsdialog: wer die Adresse nicht
// braucht, streicht "email" hier - die Zeile in den Einstellungen bleibt dann
// leer, sonst ändert sich nichts.
// "connections" liest Twitch und YouTube des Nutzers - damit erkennt der Notifier,
// welcher Discord-Account zu einem Streamer gehoert (docs/Notifiers.md).
export const OAUTH_SCOPES = ["identify", "guilds", "guilds.members.read", "email", "connections"];

// Rechte, die der Bot beim Einladen anfragt - genau die, die er heute benutzt.
// Ändern heißt: bereits eingeladene Server müssen neu autorisiert werden.
export const INVITE_PERMISSIONS = "117760";

// Manage Server (1 << 5) und Administrator (1 << 3). Beides erlaubt Bearbeiten.
export const MANAGE_GUILD = 1n << 5n;
export const ADMINISTRATOR = 1n << 3n;

export const SESSION_COOKIE = "rlnexus_session";
export const STATE_COOKIE = "rlnexus_oauth_state";

export const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
export const STATE_LIFETIME = 10 * 60 * 1000;

// Discord limitiert /users/@me/guilds hart. Eine Minute Cache reicht,
// damit ein F5-Gewitter nicht in ein 429 läuft.
export const GUILD_CACHE_TTL = 60 * 1000;
export const MAX_SESSIONS = 2000;

export const ASSET_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
} as const;

export type AssetExtension = keyof typeof ASSET_TYPES;

export function AssetTypeOf(file: string): string | null {
    return ASSET_TYPES[path.extname(file).toLowerCase() as AssetExtension] ?? null;
}

// Gleiche Absicherung wie bei der Galerie: erst auflösen, dann prüfen, ob das
// Ergebnis noch unter der Wurzel liegt. "../../.env" endet damit in null.
function ResolveUnder(root: string, relative: string): string | null {
    const file = path.resolve(root, relative);

    if (!file.startsWith(root + path.sep)) return null;

    return AssetTypeOf(file) ? file : null;
}

export function ResolveAssetPath(relative: string): string | null {
    return ResolveUnder(ASSETS_ROOT, relative);
}

export function ParseCookies(header: string | undefined): Record<string, string> {
    const jar: Record<string, string> = {};

    for (const part of (header ?? "").split(";")) {
        const index = part.indexOf("=");
        if (index < 1) continue;

        const name = part.slice(0, index).trim();
        if (!name || name in jar) continue;

        try {
            jar[name] = decodeURIComponent(part.slice(index + 1).trim());
        } catch {
            // Ein kaputtes Cookie ist kein Grund, den Request zu verlieren.
        }
    }

    return jar;
}

export function SerializeCookie(name: string, value: string, maxAge: number, secure: boolean): string {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        `Path=${DASHBOARD_HOME}`,
        `Max-Age=${Math.floor(maxAge / 1000)}`,
        "HttpOnly",
        // Lax statt Strict: der Rücksprung von Discord ist eine fremde Navigation,
        // bei Strict käme das Cookie dabei nicht mit und der Login liefe ins Leere.
        "SameSite=Lax",
    ];

    if (secure) parts.push("Secure");

    return parts.join("; ");
}

export function ClearCookie(name: string, secure: boolean): string {
    return SerializeCookie(name, "", 0, secure);
}

// Nur eigene Dashboard-Pfade. "//example.com" und "/\example.com" liest der
// Browser als fremden Host - das wäre ein offener Redirect nach dem Login.
//
// Geprüft wird gegen DASHBOARD_PATH + "/". An der Wurzel bleibt davon "/"
// übrig: dann muss der Pfad wenigstens mit einem einzelnen Slash beginnen, und
// "https://fremd.de" fällt genauso durch wie vorher.
export function SafeReturnPath(value: string | undefined): string {
    if (!value || !value.startsWith(`${DASHBOARD_PATH}/`)) return DASHBOARD_HOME;
    if (value.startsWith("//") || value.includes("\\")) return DASHBOARD_HOME;

    return value;
}

export function CreatedAt(id: string): Date {
    return new Date(Number(BigInt(id) >> 22n) + DISCORD_EPOCH);
}

export function Initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) return "??";
    if (words.length === 1) return [...words[0]].slice(0, 2).join("").toUpperCase();

    return ([...words[0]][0] + [...words[1]][0]).toUpperCase();
}

// Farbpaar aus der Guild-ID: gleiche ID heißt immer gleiches Wappen,
// ohne dass irgendwo eine Farbe gespeichert werden muss.
export function CrestColors(id: string): { c1: string; c2: string } {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;

    const hue = hash % 360;

    return { c1: `hsl(${hue} 90% 66%)`, c2: `hsl(${(hue + 38) % 360} 76% 42%)` };
}

// 256 statt 128: die Wappen stehen auf Bildschirmen mit doppelter Punktdichte,
// dort sah ein 128er Icon schon leicht weich aus.
export function IconURL(id: string, icon: string | null): string | null {
    if (!icon) return null;

    return `${DISCORD_CDN}/icons/${id}/${icon}.${icon.startsWith("a_") ? "gif" : "png"}?size=256`;
}

export function AvatarURL(id: string, avatar: string | null): string | null {
    if (!avatar) return null;

    return `${DISCORD_CDN}/avatars/${id}/${avatar}.${avatar.startsWith("a_") ? "gif" : "png"}?size=128`;
}
