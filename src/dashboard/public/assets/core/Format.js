/** Zahlen und Zeiten auf Deutsch. */
export const numbers = new Intl.NumberFormat("de-DE");
export const relative = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });
// "vor 5 Minuten" statt eines Zeitstempels - Intl kennt die deutschen Formen.
export function ago(at) {
    const units = [
        ["second", 60],
        ["minute", 60],
        ["hour", 24],
        ["day", 7],
    ];
    let value = (at - Date.now()) / 1000;
    for (const [unit, size] of units) {
        if (Math.abs(value) < size)
            return relative.format(Math.round(value), unit);
        value /= size;
    }
    return new Date(at).toLocaleDateString("de-DE", { day: "numeric", month: "long" });
}
export function waitLabel(ms) {
    if (ms <= 0)
        return "jetzt";
    if (ms < 60_000)
        return `${Math.ceil(ms / 1000)} Sekunden`;
    if (ms < 3_600_000)
        return `${Math.ceil(ms / 60_000)} Minuten`;
    if (ms < 86_400_000)
        return `${Math.ceil(ms / 3_600_000)} Stunden`;
    return `${Math.ceil(ms / 86_400_000)} Tagen`;
}
export function compact(value) {
    if (value < 1000)
        return numbers.format(value);
    const thousands = value / 1000;
    return `${numbers.format(thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10)}k`;
}
export function monthOf(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? "unbekannt"
        : date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}
