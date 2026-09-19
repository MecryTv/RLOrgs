import path from "path";
import { PermissionFlagsBits } from "discord.js";
import { IModConfig, IModStage, ModAction } from "../interfaces/services/moderation/IModeration";

/**
 * Das Moderations-Modul: Aktionen, Grenzen, Dauer-Angaben. Dieselben Werte
 * nutzen die Befehle in Discord, der Dienst und das Dashboard (über die API).
 */

export const MOD_ACTIONS = ["ban", "unban", "kick", "timeout", "untimeout", "warn", "unwarn", "purge"] as const satisfies readonly ModAction[];

export interface IModActionInfo {
    label: string;
    /** "… wurde gebannt" */
    past: string;
    emoji: string;
    color: `#${string}`;
}

export const ACTION_INFO: Record<ModAction, IModActionInfo> = {
    ban: { label: "Bann", past: "gebannt", emoji: "🔨", color: "#ff4d5e" },
    unban: { label: "Entbannt", past: "entbannt", emoji: "🔓", color: "#35e07f" },
    kick: { label: "Kick", past: "gekickt", emoji: "👢", color: "#ff8a3d" },
    timeout: { label: "Timeout", past: "stummgeschaltet", emoji: "⏳", color: "#ffc53d" },
    untimeout: { label: "Timeout aufgehoben", past: "wieder freigeschaltet", emoji: "🔊", color: "#35e07f" },
    warn: { label: "Verwarnung", past: "verwarnt", emoji: "⚠️", color: "#ffc53d" },
    unwarn: { label: "Verwarnung entfernt", past: "entwarnt", emoji: "🧽", color: "#35e07f" },
    purge: { label: "Nachrichten gelöscht", past: "aufgeräumt", emoji: "🧹", color: "#00afff" },
};

/** Welches Discord-Recht eine Aktion auch ohne Moderatoren-Liste erlaubt - und welches der Bot selbst braucht. */
export const ACTION_PERMISSION: Record<ModAction, bigint> = {
    ban: PermissionFlagsBits.BanMembers,
    unban: PermissionFlagsBits.BanMembers,
    kick: PermissionFlagsBits.KickMembers,
    timeout: PermissionFlagsBits.ModerateMembers,
    untimeout: PermissionFlagsBits.ModerateMembers,
    warn: PermissionFlagsBits.ModerateMembers,
    unwarn: PermissionFlagsBits.ModerateMembers,
    purge: PermissionFlagsBits.ManageMessages,
};

export const PERMISSION_LABEL: Record<ModAction, string> = {
    ban: "Mitglieder bannen",
    unban: "Mitglieder bannen",
    kick: "Mitglieder kicken",
    timeout: "Mitglieder im Timeout",
    untimeout: "Mitglieder im Timeout",
    warn: "Mitglieder im Timeout",
    unwarn: "Mitglieder im Timeout",
    purge: "Nachrichten verwalten",
};

/** Bleibt ein Fall dieser Art aktiv, bis ihn etwas beendet? */
export const LASTING: ReadonlySet<ModAction> = new Set<ModAction>(["ban", "timeout", "warn"]);

// Discord nimmt für das Audit-Log höchstens 512 Zeichen.
export const MAX_REASON = 500;
export const MAX_NOTE = 1000;
export const MAX_NOTES = 50;
export const MAX_EVIDENCE = 20;
export const MAX_STAGES = 10;
export const MAX_PURGE = 100;
/** Länger geht ein Timeout bei Discord nicht. */
export const MAX_TIMEOUT = 28 * 86_400;
/** Ein befristeter Bann: höchstens ein Jahr - danach eben dauerhaft. */
export const MAX_BAN = 365 * 86_400;
export const MIN_DURATION = 60;
/** Nachrichten mitlöschen: höchstens sieben Tage, sagt Discord. */
export const MAX_DELETE_SECONDS = 7 * 86_400;

export const DELETE_CHOICES: [number, string][] = [
    [0, "Nichts löschen"],
    [3_600, "Letzte Stunde"],
    [21_600, "Letzte 6 Stunden"],
    [86_400, "Letzte 24 Stunden"],
    [259_200, "Letzte 3 Tage"],
    [604_800, "Letzte 7 Tage"],
];

/** Vorschläge für Dauer-Felder - in Discord als Autovervollständigung, im Dashboard als Knöpfe. */
export const DURATION_PRESETS: [string, number][] = [
    ["60 Sekunden", 60],
    ["5 Minuten", 300],
    ["10 Minuten", 600],
    ["30 Minuten", 1_800],
    ["1 Stunde", 3_600],
    ["6 Stunden", 21_600],
    ["12 Stunden", 43_200],
    ["1 Tag", 86_400],
    ["3 Tage", 259_200],
    ["1 Woche", 604_800],
    ["2 Wochen", 1_209_600],
    ["28 Tage", 2_419_200],
];

/** Beweisbilder: evidence/<server>/<fall-id>/<nr>.<endung>. Nicht im Repo (.gitignore). */
export const EVIDENCE_ROOT = path.join(process.cwd(), "evidence");
export const STORED_EVIDENCE = /^\d{1,3}\.(png|jpe?g|gif|webp)$/;
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

export function DefaultModConfig(): IModConfig {
    return {
        logChannelId: null,
        dm: true,
        warnDays: 0,
        // Das Beispiel aus der Anfrage: drei Verwarnungen eine Stunde Timeout, fünf ein Kick.
        stages: [
            { warns: 3, action: "timeout", duration: 3_600 },
            { warns: 5, action: "kick", duration: null },
        ],
    };
}

const UNITS: Record<string, number> = {
    s: 1, sek: 1, sec: 1, sekunde: 1, sekunden: 1,
    m: 60, min: 60, minute: 60, minuten: 60,
    h: 3_600, std: 3_600, stunde: 3_600, stunden: 3_600,
    d: 86_400, t: 86_400, tag: 86_400, tage: 86_400, day: 86_400, days: 86_400,
    w: 604_800, wo: 604_800, woche: 604_800, wochen: 604_800, week: 604_800,
};

/**
 * "1h30m", "2 Tage", "10 min", "90" (Minuten) - in Sekunden. null, wenn nichts
 * davon passt. Leer ist auch null: dann gibt es keine Dauer.
 */
export function ParseDuration(text: string | null | undefined): number | null {
    const value = (text ?? "").trim().toLowerCase().replace(",", ".");

    if (!value) return null;
    if (/^\d+$/.test(value)) return Number(value) * 60;

    let total = 0;
    let rest = value;

    for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*([a-zäöü]+)/g)) {
        const unit = UNITS[match[2]];

        if (!unit) return null;

        total += Number(match[1]) * unit;
        rest = rest.replace(match[0], "");
    }

    return total > 0 && !rest.trim() ? Math.round(total) : null;
}

/** 5400 -> "1 Std. 30 Min.", 604800 -> "7 Tage". */
export function FormatDuration(seconds: number): string {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const parts: string[] = [];

    if (days) parts.push(`${days} ${days === 1 ? "Tag" : "Tage"}`);
    if (hours) parts.push(`${hours} Std.`);
    if (minutes && !days) parts.push(`${minutes} Min.`);
    if (!parts.length) parts.push(`${seconds} Sek.`);

    return parts.join(" ");
}

/** Die Stufe genau für diese Zahl aktiver Verwarnungen - bei der vierten löst die dritte nicht nochmal aus. */
export function StageFor(stages: IModStage[], warns: number): IModStage | null {
    return stages.find((stage) => stage.warns === warns) ?? null;
}

export function CaseRef(number: number): string {
    return `#${number}`;
}
