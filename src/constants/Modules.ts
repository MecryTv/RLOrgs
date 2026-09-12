/**
 * Die Module, die sich auf einem Server einschalten lassen - ihre IDs, so wie
 * sie in guild_settings.modules stehen. Nur diese nimmt die Schalter-Route an
 * (DashboardApiModules), damit dort nichts landet, was jemand in eine Anfrage
 * geschrieben hat.
 *
 * Teile eines Moduls stehen hier nicht: Live Tickets und Transcriptions gehören
 * zum Ticket System und gehen mit ihm an. Das Dashboard führt dieselbe Liste mit
 * Namen, Beschreibungen und Symbolen (src/dashboard/client/constants/Modules.ts);
 * npm run check:dashboard prüft, dass beide übereinstimmen.
 */
export const MODULE_IDS = [
    "rl-6mans",
    "lft",
    "teams",
    "clips",
    "matchups",
    "moderation",
    "automod",
    "logging",
    "welcome",
    "apply",
    "reaction-roles",
    "levels",
    "giveaways",
    "polls",
    "voice-hub",
    "tickets",
    "twitch-notifier",
    "youtube-notifier",
    "custom-message",
    "gallery",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export function IsModule(value: unknown): value is ModuleId {
    return typeof value === "string" && (MODULE_IDS as readonly string[]).includes(value);
}

/**
 * Module, die zum Bot gehoeren und sich nicht abschalten lassen. Sie stehen
 * trotzdem in MODULE_IDS: das Dashboard zeigt ihre Kachel, nur gesperrt.
 *
 * GuildSettings.Of() mischt sie in jede Modulliste - damit muss keine andere
 * Stelle davon wissen. Die Schalter-Route weist ein Ausschalten zusaetzlich mit
 * 400 ab, damit die Antwort erklaert, was passiert ist.
 */
export const PERMANENT_MODULES = new Set<ModuleId>(["gallery"]);

export function IsPermanent(value: unknown): value is ModuleId {
    return IsModule(value) && PERMANENT_MODULES.has(value);
}
