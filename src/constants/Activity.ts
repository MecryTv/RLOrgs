/**
 * Zeitraster und Aufbewahrung der Server-Aktivität - siehe docs/Activity.md.
 *
 * Gezählt wird in Stunden und Tagen seit 1970 (UTC). Ganze Zahlen statt
 * Zeitstempel: so gibt es auf dem Weg in die Datenbank keine Zeitzone, die
 * jemand falsch umrechnen könnte. In Ortszeit rechnet erst der Browser.
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Wie oft das Gezählte in die Datenbank geht. Ein Neustart kostet höchstens so viel. */
export const FLUSH_MS = 60 * 1000;

/** Aufbewahrung der Zahlen je Server und je Kanal. */
export const KEEP_DAYS = 90;
/** Aufbewahrung der Zahlen je Mitglied - die einzigen mit Discord-ID. */
export const KEEP_MEMBER_DAYS = 14;

/** Verlauf: 30 Tage in Ortszeit, dazu einer, damit die Zeitverschiebung den ältesten nicht anschneidet. */
export const SHOW_DAYS = 31;
/** Aktivste Kanäle. */
export const CHANNEL_DAYS = 30;
/** Aktivste Mitglieder. */
export const TOP_DAYS = 7;
export const TOP_COUNT = 5;

export function HourOf(ms: number): number {
    return Math.floor(ms / HOUR_MS);
}

export function DayOf(ms: number): number {
    return Math.floor(ms / DAY_MS);
}

/**
 * Zerlegt eine Zeitspanne in die Abschnitte eines Rasters, die sie berührt, samt
 * Anteil in Millisekunden. Eine Stunde Voice von 18:30 bis 19:30 gehört zur
 * Hälfte in die 18-Uhr-Stunde und zur Hälfte in die 19-Uhr-Stunde.
 */
export function SplitSpan(from: number, to: number, size: number): { slot: number; ms: number }[] {
    const parts: { slot: number; ms: number }[] = [];

    for (let start = from; start < to; ) {
        const slot = Math.floor(start / size);
        const end = Math.min(to, (slot + 1) * size);

        parts.push({ slot, ms: end - start });
        start = end;
    }

    return parts;
}
