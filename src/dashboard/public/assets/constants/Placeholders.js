export const PLACEHOLDERS = [
    { key: "user", label: "User (Erwähnung)", sample: "@du" },
    { key: "user.name", label: "Name des Users", sample: "du" },
    { key: "user.id", label: "ID des Users", sample: "123456789012345678" },
    { key: "user.avatar", label: "Avatar des Users (Bild)", sample: "" },
    { key: "guild", label: "Servername", sample: "Dein Server" },
    { key: "guild.id", label: "Server-ID", sample: "123456789012345678" },
    { key: "guild.icon", label: "Server-Icon (Bild)", sample: "" },
    { key: "guild.members", label: "Mitgliederzahl", sample: "0" },
    { key: "ticket.id", label: "Ticketnummer", sample: "#0042" },
    { key: "ticket.option", label: "Gewählte Option", sample: "Support" },
    { key: "ticket.priority", label: "Priorität", sample: "Normal" },
    { key: "ticket.opened", label: "Geöffnet (Zeitpunkt)", sample: "vor 2 Minuten" },
    { key: "ticket.claimer", label: "Wer bearbeitet", sample: "niemand" },
    { key: "support.role", label: "Support-Rolle", sample: "@Team" },
    { key: "closer", label: "Wer geschlossen hat", sample: "@Team" },
    { key: "reason", label: "Grund", sample: "Erledigt" },
];
/** Die beiden, die als Bildquelle taugen - sie ergeben eine URL. */
export const IMAGE_PLACEHOLDERS = ["{user.avatar}", "{guild.icon}"];
/** Setzt ein, was bekannt ist. Unbekanntes bleibt stehen, wie beim Bot. */
export function fill(text, values) {
    return text.replace(/\{([a-z.]+)\}/g, (match, key) => values[key] ?? match);
}
