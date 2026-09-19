import { IPollSettings } from "../interfaces/services/community/ICommunity";

/** Umfragen: Grenzen und Standardwerte. Siehe docs/Polls.md. */

export const POLL_PREFIX = "poll";
export const POLL_ACCENT = "#00afff";

export const MAX_POLL_OPTIONS = 10;
export const MAX_QUESTION = 300;
export const MAX_POLL_DESCRIPTION = 1000;
/** Discord erlaubt bei seinen Umfragen 55 Zeichen je Antwort - eigene nehmen mehr. */
export const MAX_OPTION_NATIVE = 55;
export const MAX_OPTION_OWN = 80;
/** Discords Umfragen laufen eine Stunde bis 32 Tage. */
export const NATIVE_MIN_HOURS = 1;
export const NATIVE_MAX_HOURS = 768;
/** Eigene Umfragen dürfen ohne Ende laufen - mit Ende höchstens ein Jahr. */
export const MAX_POLL_SECONDS = 365 * 86_400;
/** Eine Umfrage mit vielen Stimmen zeichnet ihre Karte höchstens so oft neu. */
export const POLL_REDRAW_MS = 3_000;

export function DefaultPollSettings(): IPollSettings {
    return { multi: false, maxChoices: 0, anonymous: false, results: "live", roles: [], ping: null, accent: null };
}

/** Ein Balken aus Blöcken - Discord hat keine Grafik in Nachrichten. */
export function Bar(share: number, width = 12): string {
    const filled = Math.round(Math.min(Math.max(share, 0), 1) * width);

    return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}
