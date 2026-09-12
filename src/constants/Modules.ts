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
