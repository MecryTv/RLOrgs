import { ICustomEmbed, IResponseSettings, ISchedule } from "../interfaces/services/messages/IMessages";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";

/**
 * Custom Message: Grenzen, Vorgaben und das Ausrechnen des nächsten Termins.
 * Siehe docs/Messages.md.
 */
export const MESSAGE_PREFIX = "cm";
export const MESSAGE_ACCENT = "#00afff";

export const MAX_MESSAGES = 50;
export const MAX_RESPONSES = 50;
export const MAX_BUTTONS = 10;
export const MAX_LABEL = 80;
export const MAX_BUTTON_TEXT = 1500;
export const MAX_NAME = 80;
export const MAX_PHRASE = 200;
export const MAX_COOLDOWN = 3600;
export const MAX_FILTER = 15;
export const MAX_CONTENT = 2000;
export const MAX_EMBED_TITLE = 256;
export const MAX_EMBED_DESCRIPTION = 4000;
export const MAX_EMBED_FIELDS = 10;
export const MAX_FIELD_NAME = 256;
export const MAX_FIELD_VALUE = 1024;
export const MAX_FOOTER = 2048;

export const KIND_LABELS: Record<string, string> = {
    v2: "Karte (Components V2)",
    embed: "Embed",
    text: "Normale Nachricht",
};

export const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export const MATCH_LABELS: Record<string, string> = {
    contains: "enthält",
    exact: "ist genau",
    starts: "beginnt mit",
    regex: "Regex",
};

export function DefaultEmbed(): ICustomEmbed {
    return {
        title: "Überschrift",
        description: "Hier steht, was ihr sagen wollt.",
        color: MESSAGE_ACCENT,
        url: null,
        image: null,
        thumbnail: null,
        author: null,
        footer: null,
        timestamp: false,
        fields: [],
    };
}

export function DefaultSchedule(): ISchedule {
    return { mode: "off", at: null, hour: 18, minute: 0, weekday: 1, next: null, replace: false };
}

export function DefaultResponseSettings(): IResponseSettings {
    return { reply: true, delete: false, quiet: false, cooldown: 30, channels: [], roles: [], ignoreRoles: [] };
}

export function DefaultMessageDoc(): IMessageDoc {
    return { accent: MESSAGE_ACCENT, blocks: [{ type: "text", body: "## Überschrift\nHier steht, was ihr sagen wollt." }] };
}

export function DefaultResponseDoc(): IMessageDoc {
    return { accent: MESSAGE_ACCENT, blocks: [{ type: "text", body: "Schau mal in <#123> – dort steht alles." }] };
}

/**
 * Der nächste Termin in Millisekunden, gerechnet in der Zeitzone des Servers
 * (Europe/Berlin). Für "once" ist es der Zeitpunkt selbst, solange er in der
 * Zukunft liegt. Ohne Termin: null.
 */
export function NextRun(schedule: ISchedule, from = Date.now()): number | null {
    if (schedule.mode === "off") return null;
    if (schedule.mode === "once") return schedule.at && schedule.at > from ? schedule.at : null;

    const hour = Math.min(23, Math.max(0, Math.floor(schedule.hour)));
    const minute = Math.min(59, Math.max(0, Math.floor(schedule.minute)));
    const start = new Date(from);

    // Die Uhrzeit ist die des Servers - wer 18:00 einstellt, meint seine Uhr.
    for (let day = 0; day <= 8; day++) {
        const when = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day, hour, minute, 0, 0);

        if (when.getTime() <= from) continue;
        if (schedule.mode === "weekly" && when.getDay() !== Math.min(6, Math.max(0, Math.floor(schedule.weekday)))) continue;

        return when.getTime();
    }

    return null;
}

/** Passt der Text auf das Stichwort? */
export function Matches(content: string, phrase: string, mode: string): boolean {
    const text = content.toLowerCase().trim();
    const needle = phrase.toLowerCase().trim();

    if (!needle) return false;

    if (mode === "exact") return text === needle;
    if (mode === "starts") return text.startsWith(needle);

    if (mode === "regex") {
        try {
            // Ein Muster aus dem Dashboard - kaputte Ausdrücke sollen nichts auslösen.
            return new RegExp(phrase, "i").test(content);
        } catch {
            return false;
        }
    }

    return text.includes(needle);
}
