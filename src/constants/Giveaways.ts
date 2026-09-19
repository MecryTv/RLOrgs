import { IGiveawayRequirements, IGiveawaySettings } from "../interfaces/services/community/ICommunity";

/** Giveaways: Grenzen und Standardwerte. Siehe docs/Giveaways.md. */

export const GIVEAWAY_PREFIX = "giveaway";
export const GIVEAWAY_ACCENT = "#ffc53d";

export const MAX_WINNERS = 50;
export const MAX_PRIZE = 200;
export const MAX_GIVEAWAY_DESCRIPTION = 1500;
export const MAX_BONUS_ROLES = 10;
export const MAX_BONUS_TICKETS = 10;
/** Ein Giveaway läuft zwischen einer Minute und 60 Tagen. */
export const MIN_GIVEAWAY_SECONDS = 60;
export const MAX_GIVEAWAY_SECONDS = 60 * 86_400;
/** Geplant höchstens 90 Tage im Voraus. */
export const MAX_SCHEDULE_AHEAD = 90 * 86_400_000;
export const CLAIM_CHOICES = [0, 6, 12, 24, 48, 72, 168];

export function DefaultRequirements(): IGiveawayRequirements {
    return { roles: [], allRoles: false, forbidden: [], booster: "any", serverDays: 0, accountDays: 0, messages: 0, linked: false };
}

export function DefaultGiveawaySettings(): IGiveawaySettings {
    return { dm: true, claimHours: 24, ping: null, accent: null };
}
