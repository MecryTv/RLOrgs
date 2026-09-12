/** Das verknuepfte Epic-Konto: anzeigen, wechseln, im Notfall eintippen. */
import { icon, maybe } from "../core/Dom.js";
import { waitLabel } from "../core/Format.js";
import { platformIcon } from "../constants/Platforms.js";
import { toast } from "../core/Toast.js";
import { pullNotes } from "./Notes.js";
import { BASE, url } from "../core/Base.js";
/** Die eine Zeile: das Epic-Konto. */
export function accountRow(data) {
    const entry = data.account;
    const row = document.createElement("div");
    row.className = entry ? "acct acct--on" : "acct";
    const mark = document.createElement("span");
    mark.className = "acct__mark";
    const image = platformIcon("Epic Games");
    mark.append(image ?? icon("#i-gamepad"));
    const text = document.createElement("span");
    text.className = "acct__text";
    const name = document.createElement("b");
    name.textContent = "Epic Games";
    const meta = document.createElement("span");
    meta.textContent = entry
        ? (entry.name ?? entry.accountId)
        : "Rang, Karriere und Club aus Rocket League.";
    text.append(name, meta);
    row.append(mark, text);
    const back = encodeURIComponent(location.pathname);
    if (!entry) {
        if (data.epicLogin) {
            const login = document.createElement("a");
            login.className = "tagline tagline--on";
            login.textContent = "anmelden";
            login.href = `${BASE}/link/epic?return=${back}`;
            row.appendChild(login);
        }
        return row;
    }
    const state = document.createElement("span");
    state.className = "tagline tagline--on";
    state.textContent = entry.verified ? "geprüft" : "verbunden";
    row.appendChild(state);
    // Wechseln geht nur mit Login und nur nach Ablauf der Sperrfrist.
    if (!data.epicLogin)
        return row;
    const wait = data.cooldown && !data.cooldown.open ? data.cooldown.waitMs : 0;
    const change = document.createElement("a");
    change.className = "tagline";
    if (wait > 0) {
        change.textContent = `gesperrt (${waitLabel(wait)})`;
        change.setAttribute("aria-disabled", "true");
    }
    else {
        change.textContent = "wechseln";
        change.href = `${BASE}/link/epic?return=${back}`;
    }
    row.appendChild(change);
    return row;
}
/** Holt das Konto und malt die Zeile in den Einstellungen. */
export async function paintAccounts() {
    const list = maybe("#acctList");
    const hint = maybe("#acctHint");
    const fallback = maybe("#acctFallback");
    if (!list || !hint || !fallback)
        return;
    let response;
    try {
        response = await fetch(url("/api/accounts"), { headers: { Accept: "application/json" } });
    }
    catch {
        hint.textContent = "Der Bot antwortet gerade nicht.";
        return;
    }
    if (!response.ok) {
        hint.textContent = `Konto nicht ladbar (${response.status}).`;
        return;
    }
    const data = (await response.json());
    if (!data.ready) {
        list.replaceChildren();
        fallback.hidden = true;
        hint.textContent = data.hint ?? "Ohne Datenbank gibt es keine Verknüpfungen.";
        return;
    }
    list.replaceChildren(accountRow(data));
    // Ohne EPIC_CLIENT_ID gibt es keinen Login - dann bleibt der Name als
    // Notweg, und das wird auch so gesagt statt still weggelassen.
    fallback.hidden = data.epicLogin || data.account !== null;
    hint.textContent = data.epicLogin
        ? "Dein Rocket-League-Konto hängt an deinem Epic-Konto — auch wenn du über Steam, Xbox, PlayStation oder Switch spielst. Das Konto lässt sich nur alle 3 Tage wechseln."
        : "Der Epic-Login ist auf diesem Server nicht eingerichtet (EPIC_CLIENT_ID fehlt). Solange geht es nur über den Namen - der beweist nicht, dass das Konto dir gehört.";
}
/** Der Notweg ohne Epic-Login: Name eintippen, der Bot prüft ihn gegen Rocket League. */
export function bindAccountFallback() {
    const found = {
        input: maybe("#acctEpic"),
        save: maybe("#acctSave"),
        hint: maybe("#acctHint"),
    };
    if (!found.input || !found.save || !found.hint)
        return;
    // Festgehalten, weil die Verengung von oben in der inneren Funktion sonst
    // wieder verloren geht.
    const input = found.input;
    const save = found.save;
    const hint = found.hint;
    async function submit() {
        const value = input.value.trim();
        if (!value) {
            input.focus();
            return;
        }
        save.classList.add("is-off");
        hint.textContent = "Wird gegen Rocket League geprüft …";
        let response;
        try {
            response = await fetch(url("/api/account/epic"), {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ name: value }),
            });
        }
        catch {
            hint.textContent = "Der Bot antwortet gerade nicht.";
            save.classList.remove("is-off");
            return;
        }
        save.classList.remove("is-off");
        if (!response.ok) {
            const body = (await response.json().catch(() => ({})));
            hint.textContent = body.cooldown
                ? `Noch gesperrt - wieder möglich in ${waitLabel(body.cooldown.waitMs)}.`
                : [body.error, body.hint].filter(Boolean).join(" ") || `Fehler ${response.status}.`;
            return;
        }
        input.value = "";
        toast("info", "Konto verbunden", "Deine Ränge stehen im RL Tracker.");
        await paintAccounts();
        void pullNotes();
    }
    save.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            void submit();
        }
    });
}
/**
 * Der Rücksprung von Epic landet mit ?epic=... in der Adresszeile. Daraus wird
 * ein Hinweis - und der Parameter verschwindet wieder, damit ein F5 ihn nicht
 * ein zweites Mal zeigt.
 */
export const EPIC_RESULTS = {
    ok: ["Konto verknüpft", "Dein Epic-Konto hängt jetzt an deinem Profil."],
    refreshed: ["Konto aufgefrischt", "Die verknüpften Plattformen sind wieder aktuell."],
    denied: ["Abgebrochen", "Die Anmeldung bei Epic wurde abgelehnt."],
    state: ["Anmeldung verfallen", "Der Rücksprung passte nicht zu diesem Browser. Versuch es noch einmal."],
    exchange: ["Epic hat abgelehnt", "Der Code war nicht mehr gültig. Versuch es noch einmal."],
    cooldown: ["Noch gesperrt", "Das Epic-Konto lässt sich nur alle 3 Tage wechseln."],
    norl: ["Kein Rocket League", "Dieses Epic-Konto hat Rocket League nie gestartet."],
    primedown: ["Rocket League antwortet nicht", "Die Verknüpfung wurde nicht gespeichert. Versuch es später."],
    noprime: ["Tracking nicht eingerichtet", "Auf diesem Server lässt sich das Konto gerade nicht prüfen."],
    unconfigured: ["Epic-Login nicht eingerichtet", "EPIC_CLIENT_ID und EPIC_CLIENT_SECRET fehlen in der .env."],
    nodb: ["Keine Datenbank", "Verknüpfungen brauchen die Datenbank."],
};
export function reportEpicReturn() {
    const status = new URLSearchParams(location.search).get("epic");
    if (!status)
        return;
    const url = new URL(location.href);
    url.searchParams.delete("epic");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    const found = EPIC_RESULTS[status];
    if (found)
        toast("info", found[0], found[1]);
    void pullNotes();
}
