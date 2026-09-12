/**
 * Das Postfach.
 *
 * Es liegt beim Bot, nicht im Browser: dadurch sieht man dieselben Meldungen
 * auf jedem Geraet, und der Bot kann selbst welche dazulegen.
 */

import { icon, maybe } from "../core/Dom.js";
import { ago } from "../core/Format.js";
import { url } from "../core/Base.js";

/* ----------------------------------------------------------
   Benachrichtigungen
   Sie liegen beim Bot, nicht im Browser: dadurch sieht man sie auf jedem
   Gerät und der Bot kann selbst welche dazulegen. Der Toast ist nur die
   kurze Einblendung - er verschwindet, die Meldung bleibt.
   ---------------------------------------------------------- */
export interface INote {
    id: number;
    kind: "info" | "success" | "warn" | "group" | "account";
    title: string;
    body: string;
    link: string | null;
    read: boolean;
    at: string;
}

// Wie oft im Hintergrund nachgesehen wird. Eine Minute reicht: es geht darum,
// dass man etwas mitbekommt, nicht um Sekunden.
export const NOTES_POLL = 60_000;

let notes: INote[] = [];
let unread = 0;

export async function pullNotes(): Promise<void> {
    let response: Response;

    try {
        response = await fetch(url("/api/notifications"), { headers: { Accept: "application/json" } });
    } catch {
        // Kein Netz, keine neuen Meldungen - beim nächsten Durchlauf wieder.
        return;
    }

    if (!response.ok) return;

    const data = (await response.json()) as { available: boolean; unread: number; notes: INote[] };

    notes = data.notes;
    unread = data.unread;

    paintBadge();
}

export async function postNotes(action: "read" | "clear"): Promise<void> {
    try {
        await fetch(url("/api/notifications"), {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ action }),
        });
    } catch {
        // Misslingt es, steht beim nächsten Abruf schlicht der alte Stand da.
    }
}

export function paintBadge(): void {
    const badge = maybe<HTMLElement>("#noteBadge");
    const dot = maybe<HTMLElement>("#profileDot");

    if (badge) {
        badge.textContent = String(unread);
        badge.hidden = unread === 0;
    }

    if (dot) dot.hidden = unread === 0;
}

// Symbol je Art der Meldung.
export const NOTE_ICONS: Record<INote["kind"], string> = {
    info: "#i-info",
    success: "#i-check",
    warn: "#i-warn",
    group: "#i-shield",
    account: "#i-gamepad",
};

export function paintNotes(): void {
    const list = maybe<HTMLElement>("#noteList");
    const clear = maybe<HTMLElement>("#clearNotes");

    if (!list) return;

    if (clear) clear.hidden = notes.length === 0;

    if (notes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "notes__none";
        empty.append(icon("#i-bell"), "Noch nichts passiert. Hier landen Meldungen, die dich betreffen.");

        list.replaceChildren(empty);
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const note of notes) {
        // Meldungen mit Ziel sind anklickbar, der Rest bleibt ein Kasten.
        const row = document.createElement(note.link ? "a" : "div");

        row.className = `note note--${note.kind}${note.read ? "" : " note--new"}`;

        if (note.link) (row as HTMLAnchorElement).href = note.link;

        const mark = document.createElement("span");
        mark.className = "note__mark";
        mark.appendChild(icon(NOTE_ICONS[note.kind] ?? "#i-info"));

        const text = document.createElement("div");
        const heading = document.createElement("b");
        heading.textContent = note.title;
        const body = document.createElement("p");
        body.textContent = note.body;
        const when = document.createElement("time");
        when.dateTime = note.at;
        when.textContent = ago(new Date(note.at).getTime());
        text.append(heading, body, when);

        row.append(mark, text);
        fragment.appendChild(row);
    }

    list.replaceChildren(fragment);
}

/**
 * Die Kennkarte auf der Einstellungen-Seite: Bild, Name, @-Name, Adresse, ID
 * und Gruppe. Alles aus /api/me, alles über textContent.
 *
 * Steht getrennt vom Nutzermenü, weil es diese Felder nur auf einer einzigen
 * Seite gibt - buildUserUI läuft dagegen überall und dürfte sie nicht suchen.
 */

/**
 * Alles gelesen. Wird beim Oeffnen des Postfachs gerufen.
 *
 * Der Zaehler liegt bewusst nicht als exportiertes let offen: dann muesste
 * jeder Aufrufer wissen, dass danach noch paintBadge() faellig ist. So steht
 * beides an einer Stelle und kann nicht auseinanderlaufen.
 */
export function markRead(): void {
    if (unread === 0) return;

    unread = 0;
    paintBadge();

    void postNotes("read");
}

/** Postfach leeren - im Browser und beim Bot. */
export function clearNotes(): void {
    notes = [];
    unread = 0;

    paintNotes();
    paintBadge();

    void postNotes("clear");
}

/** Ob ueberhaupt etwas Ungelesenes dasteht. */
export function hasUnread(): boolean {
    return unread > 0;
}
