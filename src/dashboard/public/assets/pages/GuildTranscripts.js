/**
 * Abschnitt: die Transcripts geschlossener Tickets eines Servers.
 *
 * Eine Liste, neueste zuerst, mit Suche und "Ältere laden". Angesehen wird ein
 * Transcript auf seiner eigenen Seite (/transcript/<ticket>) - die prüft selbst,
 * wer es sehen darf, und liefert auch die Datei zum Mitnehmen.
 */
import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { failureText } from "../core/Gallery.js";
import { toast } from "../core/Toast.js";
function el(tag, className = "", ...children) {
    const element = document.createElement(tag);
    if (className)
        element.className = className;
    element.append(...children);
    return element;
}
function ticketNumber(value) {
    return `#${String(value).padStart(4, "0")}`;
}
// Dieselbe Rechnung wie Duration() im Bot (src/builder/TranscriptHtml.ts).
function duration(ms) {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;
    if (days > 0)
        return `${days} Tag${days === 1 ? "" : "e"}${hours ? ` ${hours} Std.` : ""}`;
    if (hours > 0)
        return `${hours} Std.${rest ? ` ${rest} Min.` : ""}`;
    return `${rest} Min.`;
}
const WHEN = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
function avatar(person) {
    const box = el("span", "travatar");
    if (person.avatar && person.avatar.startsWith("https://"))
        box.style.backgroundImage = `url("${person.avatar.replace(/["\\]/g, "")}")`;
    else
        box.textContent = person.name.trim().slice(0, 1).toUpperCase() || "?";
    return box;
}
function row(entry, onDelete) {
    const page = `${BASE}/transcript/${entry.id}`;
    const title = el("div", "trrow__title", el("b", "", entry.option), el("span", `tagline${entry.contact === "modmail" ? " tagline--on" : ""}`, entry.contact === "modmail" ? "ModMail" : "Klassisch"));
    const who = el("div", "trrow__who", avatar(entry.opener), el("span", "", entry.opener.name), ...(entry.closer ? [el("span", "trrow__by", `geschlossen von ${entry.closer.name}`)] : []));
    const facts = [
        WHEN.format(entry.closedAt),
        duration(entry.closedAt - entry.openedAt),
        `${entry.messages} Nachricht${entry.messages === 1 ? "" : "en"}`,
        ...(entry.files ? [`${entry.files} ${entry.files === 1 ? "Anhang" : "Anhänge"}`] : []),
    ];
    const main = el("div", "trrow__main", title, who, el("div", "trrow__meta", facts.join(" · ")));
    if (entry.reason)
        main.append(el("div", "trrow__reason", `„${entry.reason}“`));
    const openLink = el("a", "btn btn--quiet", icon("#i-external"), "Öffnen");
    openLink.href = page;
    openLink.target = "_blank";
    openLink.rel = "noopener";
    openLink.setAttribute("aria-label", `Transcript ${ticketNumber(entry.number)} öffnen`);
    const download = el("a", "iconbtn", icon("#i-download"));
    download.href = `${page}?download=1`;
    download.title = "Als HTML-Datei herunterladen";
    download.setAttribute("aria-label", `Transcript ${ticketNumber(entry.number)} als HTML-Datei herunterladen`);
    // Zweimal klicken: weg ist weg - auch die gesicherten Anhänge.
    const remove = el("button", "iconbtn is-danger", icon("#i-trash"));
    const label = `Transcript ${ticketNumber(entry.number)} löschen`;
    let sure = null;
    remove.type = "button";
    remove.title = label;
    remove.setAttribute("aria-label", label);
    remove.addEventListener("click", async () => {
        if (!sure) {
            remove.classList.add("is-sure");
            remove.title = "Nochmal klicken – dann ist es weg";
            sure = setTimeout(() => {
                sure = null;
                remove.classList.remove("is-sure");
                remove.title = label;
            }, 4000);
            return;
        }
        clearTimeout(sure);
        remove.disabled = true;
        if (!(await onDelete(entry)))
            remove.disabled = false;
    });
    return el("article", "trrow", el("span", "trrow__num", ticketNumber(entry.number)), main, el("div", "trrow__act", openLink, download, remove));
}
function skeleton() {
    return Array.from({ length: 4 }, () => el("div", "trrow trrow--skel", el("span", "sb trskel__num"), el("span", "sb trskel__line"), el("span", "sb trskel__btn")));
}
export function renderTranscripts(guildId) {
    const list = need("#trList");
    const search = need("#trSearch");
    const count = need("#trCount");
    const more = need("#trMore");
    const note = need("#trNote");
    let entries = [];
    let hasMore = false;
    let enabled = true;
    let query = "";
    // Nur die Antwort auf die letzte Anfrage zählt - schnelles Tippen überholt sich sonst.
    let ticket = 0;
    let timer = null;
    function warn(text) {
        note.hidden = text === null;
        note.querySelector("span").textContent = text ?? "";
    }
    function empty() {
        if (query) {
            return el("div", "tkempty tkempty--big", icon("#i-search"), el("b", "", `Nichts gefunden für „${query}“.`), el("span", "", "Such nach der Nummer (#42), dem Namen oder der User-ID des Erstellers."));
        }
        const box = el("div", "tkempty tkempty--big", icon("#i-archive"), el("b", "", enabled ? "Noch keine Transcripts." : "Transcripts sind ausgeschaltet."), el("span", "", enabled
            ? "Sie entstehen, sobald ein Ticket geschlossen wird – samt Bildern und Anhängen."
            : "Einschalten geht im Ticket System unter Einrichtung › Nach dem Schließen."));
        if (!enabled) {
            const go = el("a", "btn btn--quiet", icon("#i-sliders"), "Zur Einrichtung");
            go.href = `${BASE}/guild/${guildId}/tickets#einrichtung`;
            box.append(go);
        }
        return box;
    }
    async function destroy(entry) {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/transcripts`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ action: "delete", id: entry.id }),
            });
            const failure = await failureText(response);
            if (failure !== null) {
                warn(failure);
                return false;
            }
        }
        catch {
            warn("Der Bot antwortet gerade nicht.");
            return false;
        }
        warn(null);
        entries = entries.filter((other) => other.id !== entry.id);
        paint();
        toast("info", "Transcript gelöscht", `${ticketNumber(entry.number)} ist samt Anhängen weg.`);
        return true;
    }
    function paint() {
        list.replaceChildren(...(entries.length ? entries.map((entry) => row(entry, destroy)) : [empty()]));
        count.textContent = entries.length ? `${entries.length}${hasMore ? "+" : ""} Transcript${entries.length === 1 ? "" : "s"}` : "";
        more.hidden = !hasMore;
    }
    async function load(reset) {
        const mine = ++ticket;
        const params = new URLSearchParams();
        if (query)
            params.set("q", query);
        if (!reset && entries.length)
            params.set("before", String(entries[entries.length - 1].id));
        if (reset)
            list.replaceChildren(...skeleton());
        more.disabled = true;
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/transcripts?${params}`, {
                headers: { Accept: "application/json" },
            });
            const failure = await failureText(response);
            if (mine !== ticket)
                return;
            if (failure !== null) {
                warn(failure);
                list.replaceChildren();
                return;
            }
            const data = (await response.json());
            if (mine !== ticket)
                return;
            warn(null);
            entries = reset ? data.transcripts : [...entries, ...data.transcripts];
            hasMore = data.more;
            enabled = data.enabled;
            paint();
        }
        catch {
            if (mine === ticket)
                warn("Der Bot antwortet gerade nicht.");
        }
        finally {
            more.disabled = false;
        }
    }
    search.addEventListener("input", () => {
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => {
            query = search.value.trim();
            void load(true);
        }, 250);
    });
    more.addEventListener("click", () => void load(false));
    void load(true);
}
