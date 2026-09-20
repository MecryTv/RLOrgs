import { ILevelSettings } from "../interfaces/services/levels/ILevels";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";

/**
 * Level System: Grenzen, Vorgaben und die Rechnung hinter den Punkten.
 * Siehe docs/Levels.md.
 */
export const LEVELS_ACCENT = "#8a4dff";

export const MAX_LEVEL = 999;
export const MAX_REWARDS = 25;
export const MAX_BONUS = 15;
export const MAX_EXCLUDED = 25;
export const MAX_COOLDOWN = 3600;
export const MAX_XP_PER_ACTION = 500;
/** Kleinster und größter Faktor für Bonus-Punkte. */
export const MIN_FACTOR = 0.1;
export const MAX_FACTOR = 5;

export const LEVEL_PLACEHOLDER_KEYS = ["user", "user.name", "user.id", "level", "level.old", "xp", "xp.next", "rank", "guild", "channel"] as const;

export function DefaultLevelSettings(): ILevelSettings {
    return {
        chat: { on: true, min: 15, max: 25, cooldown: 60 },
        voice: { on: true, xp: 5, alone: false, muted: false },
        base: 100,
        roleBonus: [],
        channelBonus: [],
        noChannels: [],
        noRoles: [],
        announce: "current",
        announceChannelId: null,
        message: null,
        rewards: [],
        stack: true,
    };
}

/** Die Vorlage für die Aufstiegs-Nachricht. */
export function DefaultLevelMessage(): IMessageDoc {
    return {
        accent: LEVELS_ACCENT,
        blocks: [{ type: "text", body: "## 🎉 Level {level}!\n{user} ist aufgestiegen – weiter so.\n-# {xp} Punkte · Platz {rank}" }],
    };
}

/**
 * Punkte von Level n auf n+1: base * (n + 1). Insgesamt braucht Level L also
 * base * L * (L + 1) / 2 - mit base 100 sind das 100 für Level 1, 1500 für
 * Level 5 und 5500 für Level 10.
 */
export function XpForLevel(level: number, base: number): number {
    return Math.round((base * level * (level + 1)) / 2);
}

/** Welches Level jemand mit diesen Punkten hat. */
export function LevelFromXp(xp: number, base: number): number {
    if (xp <= 0 || base <= 0) return 0;

    // Umkehrung von base * L * (L + 1) / 2 <= xp.
    const level = Math.floor((Math.sqrt(1 + (8 * xp) / base) - 1) / 2);

    return Math.min(MAX_LEVEL, Math.max(0, level));
}

/** Wie weit jemand im aktuellen Level ist: 0 bis 1. */
export function LevelProgress(xp: number, base: number): { level: number; into: number; need: number; share: number } {
    const level = LevelFromXp(xp, base);
    const start = XpForLevel(level, base);
    const need = XpForLevel(level + 1, base) - start;
    const into = xp - start;

    return { level, into, need, share: need > 0 ? Math.min(1, into / need) : 1 };
}
