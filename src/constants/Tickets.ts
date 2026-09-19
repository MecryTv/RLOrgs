import { IMessageDoc } from "../interfaces/builder/IMessageDoc";
import { ITicketConfig } from "../interfaces/services/tickets/ITicket";

/** Präfix aller customIds des Ticket-Systems. Der Assistent hat sein eigenes. */
export const TICKET_PREFIX = "ticket";
export const SETUP_PREFIX = "ticketsetup";

/** Wie der User mit dem Team spricht: im Ticket selbst oder per DM an den Bot. */
export const CONTACTS = ["direct", "modmail"] as const;
export type TicketContact = (typeof CONTACTS)[number];

/** Wo das Ticket auf der Team-Seite entsteht: Textkanal oder Forum-Post. */
export const SURFACES = ["channel", "forum"] as const;
export type TicketSurface = (typeof SURFACES)[number];

export const PANEL_STYLES = ["buttons", "select"] as const;
export type PanelStyle = (typeof PANEL_STYLES)[number];

export const STATUSES = ["open", "frozen", "closed"] as const;
export type TicketStatus = (typeof STATUSES)[number];

export const PRIORITIES = ["low", "normal", "high"] as const;
export type TicketPriority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<TicketPriority, { name: string; emoji: string }> = {
    low: { name: "Niedrig", emoji: "🟢" },
    normal: { name: "Normal", emoji: "🟡" },
    high: { name: "Hoch", emoji: "🔴" },
};

export const CONTACT_LABELS: Record<TicketContact, string> = { direct: "Klassisch", modmail: "ModMail" };
export const SURFACE_LABELS: Record<TicketSurface, string> = { channel: "Kanal", forum: "Forum-Post" };
export const STYLE_LABELS: Record<PanelStyle, string> = { buttons: "Buttons", select: "Auswahlmenü" };

/**
 * Die Nachrichten, die sich bearbeiten lassen. Das Panel gibt es zweimal: bei
 * ModMail erklärt es, dass man dem Bot schreibt - umgestellt wird so nie der
 * Text, den jemand für den anderen Weg geschrieben hat.
 */
export const MESSAGE_KEYS = ["panel", "modmailPanel", "opened", "dm", "closed", "frozen", "blacklisted"] as const;
export type TicketMessageKey = (typeof MESSAGE_KEYS)[number];

export const MESSAGE_LABELS: Record<TicketMessageKey, string> = {
    panel: "Panel",
    modmailPanel: "Panel (ModMail)",
    opened: "Ticket geöffnet",
    dm: "ModMail-Bestätigung",
    closed: "Ticket geschlossen",
    frozen: "Ticket eingefroren",
    blacklisted: "User gesperrt",
};

/**
 * Alle Aktionen des Menüs im Ticket - dieselben values wie in
 * src/config/ticketactions.json, von dort kommen Name, Beschreibung und Emoji.
 * npm run check:tickets prüft, dass beide Listen übereinstimmen.
 */
export const ACTIONS = [
    "claim",
    "unclaim",
    "transfer",
    "priority",
    "anonymous_mode",
    "media_vault",
    "slowmode",
    "tldr_summary",
    "staff_note",
    "add_user",
    "remove_user",
    "freeze",
    "blacklist",
    "schedule_meeting",
    "close",
] as const;
export type TicketAction = (typeof ACTIONS)[number];

/** Gehören fest dazu und lassen sich nicht abschalten. */
export const CORE_ACTIONS: readonly TicketAction[] = ["close", "claim", "unclaim", "add_user", "remove_user"];

/** Der Schlüssel von src/config/ticketactions.json im ConfigService. */
export const ACTIONS_CONFIG = "ticketactions";

export const MAX_OPTIONS = 25;
export const MAX_LIMIT = 10;
export const MAX_NOTE = 1000;
export const MAX_REASON = 300;
/** Höchstens so viele Moderatoren - je User und je Rolle. */
export const MAX_MODERATORS = 25;

/** "Sofort" unter den Löschfristen - kein Stundenwert, deshalb eine eigene Zahl. */
export const DELETE_NOW = -1;

/** So lange steht ein Kanal bei "sofort" noch, damit das Schließen zu Ende läuft. */
export const DELETE_NOW_DELAY = 5_000;

/** Löschfristen nach dem Schließen, in Stunden. 0 = der Kanal bleibt. */
export const DELETE_AFTER_HOURS = [0, DELETE_NOW, 1, 6, 24, 72, 168] as const;

export function DeleteLabel(hours: number): string {
    if (hours === 0) return "nie";
    if (hours === DELETE_NOW) return "sofort";
    if (hours < 24) return `nach ${hours} Stunde${hours === 1 ? "" : "n"}`;

    return `nach ${hours / 24} Tag${hours === 24 ? "" : "en"}`;
}

/** Stufen für "Slowmode aktivieren", in Sekunden. */
export const SLOWMODE_STEPS = [0, 5, 10, 30, 60, 300, 900] as const;

export const HOUR_MS = 3_600_000;

function Text(accent: string, body: string): IMessageDoc {
    return { accent, blocks: [{ type: "text", body }] };
}

export const DEFAULT_MESSAGES: Record<TicketMessageKey, IMessageDoc> = {
    panel: Text(
        "#ff1e2d",
        "# 🎫 Support\nDu hast eine Frage, ein Problem oder eine Bewerbung? Wähle unten aus, worum es geht – das Team von **{guild}** meldet sich bei dir."
    ),
    modmailPanel: Text(
        "#ff1e2d",
        "# 📬 Support per DM\nKlick unten auf **Ticket per DM starten** – ich schreibe dir, und du wählst dein Thema direkt in der DM. Du kannst {bot} auch einfach selbst anschreiben.\nDein Anliegen landet beim Team von **{guild}**, die Antwort kommt ebenfalls per DM.\n-# Damit das klappt, müssen Direktnachrichten von Servermitgliedern erlaubt sein."
    ),
    opened: Text(
        "#00afff",
        "## Ticket {ticket.id} · {ticket.option}\nHallo {user}, danke für deine Anfrage! {support.role} ist informiert und übernimmt gleich.\nBeschreib dein Anliegen schon mal so genau wie möglich – Screenshots helfen."
    ),
    dm: Text(
        "#ff1e2d",
        "## 📬 Dein Ticket auf {guild}\nWir haben dein Ticket **{ticket.id}** ({ticket.option}) erhalten. Schreib einfach hier weiter – alles landet direkt beim Team."
    ),
    closed: Text("#6b7683", "## 🔒 Ticket geschlossen\n{closer} hat das Ticket **{ticket.id}** geschlossen.\n-# Grund: {reason}"),
    frozen: Text(
        "#5ccdff",
        "## ❄️ Ticket eingefroren\nDas Team hat das Ticket kurz angehalten. Du kannst gerade nicht schreiben – wir melden uns."
    ),
    blacklisted: Text("#ff4d5e", "## 🚫 Gesperrt\nDu kannst auf **{guild}** keine Tickets mehr öffnen."),
};

/**
 * Der erste Standardtext des ModMail-Panels - er versprach Themen unter dem
 * Text, die dort nicht mehr stehen. Wer ihn nie angefasst hat, bekommt beim
 * Lesen den neuen (TicketSettings.Of); ein eigener Text bleibt, wie er ist.
 */
export const LEGACY_MODMAIL_PANEL =
    "# 📬 Support per DM\nSchreib {bot} einfach eine Direktnachricht – dein Anliegen landet direkt beim Team von **{guild}**, und die Antwort kommt ebenfalls per DM.\nOder wähle unten dein Thema, dann melde ich mich bei dir.\n-# Damit das klappt, müssen Direktnachrichten von Servermitgliedern erlaubt sein.";

/** Was SendPanel getan hat: neu geschickt, an Ort und Stelle bearbeitet oder umgezogen. */
export type PanelState = "sent" | "updated" | "moved";

/** Die Rückmeldung dazu - {channel} wird der Kanal. */
export const PANEL_STATES: Record<PanelState, { title: string; text: string }> = {
    sent: { title: "Panel gesendet", text: "Das Ticket-Panel steht jetzt in {channel}." },
    updated: {
        title: "Panel aktualisiert",
        text: "In {channel} stand schon ein Panel – es ist jetzt auf dem neuen Stand. Ein zweites schicke ich nicht.",
    },
    moved: { title: "Panel umgezogen", text: "Das Panel steht jetzt in {channel}, das alte habe ich entfernt." },
};

export function DefaultConfig(): ITicketConfig {
    return {
        contact: "direct",
        surface: "channel",
        style: "buttons",
        supportRoleId: null,
        forumId: null,
        limit: 1,
        deleteAfter: 0,
        actions: [],
        options: [
            {
                id: "support",
                name: "Support",
                description: "Fragen und Probleme rund um den Server",
                emoji: "🎫",
                categoryId: null,
                tagId: null,
                supportRoleId: null,
                opened: null,
            },
        ],
        messages: structuredClone(DEFAULT_MESSAGES),
        tags: { low: null, normal: null, high: null, claimed: null, closed: null },
        panel: { channelId: null, messageId: null },
        transcripts: { enabled: true, channelId: null, dm: false },
        moderators: { users: [], roles: [] },
    };
}

/** "#0042" - die Nummer, wie sie überall steht. */
export function TicketNumber(number: number): string {
    return `#${String(number).padStart(4, "0")}`;
}
