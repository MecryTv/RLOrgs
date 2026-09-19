/**
 * Abschnitt: die Transcripts geschlossener Tickets eines Servers.
 *
 * Eine Liste, neueste zuerst, mit Suche und "Ältere laden". Ein Klick auf eine
 * Zeile öffnet das Transcript groß im Dashboard: die Seite /transcript/<ticket>
 * eingebettet, ohne ihren eigenen Kopf - der steht im Dialog. Dieselbe Seite
 * gibt es im neuen Tab und als Datei zum Mitnehmen; sie prüft selbst, wer sie
 * sehen darf.
 *
 * Neu geladen wird still, wenn der Abschnitt wieder aufgeht und wenn der Stream
 * von Live Tickets ein fertiges Transcript meldet ("live:transcript").
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { failureText } from "../core/Gallery.js";
import { toast } from "../core/Toast.js";

interface IPerson {
    id: string;
    name: string;
    avatar: string | null;
}

interface IEntry {
    id: number;
    number: number;
    /** Kürzel des Themas (SUP) - fehlt bei Transcripts von vor den Kürzeln. */
    code: string | null;
    /** Die feste ID des Erstellers ohne "U-". */
    userCode: string | null;
    /** Tickets des Erstellers auf diesem Server. */
    openerTickets: number;
    option: string;
    contact: "direct" | "modmail";
    opener: IPerson;
    claimer: IPerson | null;
    closer: IPerson | null;
    reason: string | null;
    openedAt: number;
    closedAt: number;
    messages: number;
    files: number;
    participants?: IPerson[];
}

interface IPayload {
    transcripts: IEntry[];
    more: boolean;
    enabled: boolean;
    /** Löschen darf nur, wer den Server verwalten darf - Supporter lesen. */
    canDelete: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (className) element.className = className;

    element.append(...children);

    return element;
}

// Wie TicketNumber() im Bot: SUP-5, ältere Tickets ohne Kürzel #5.
function ticketId(entry: IEntry): string {
    return entry.code ? `${entry.code}-${entry.number}` : `#${entry.number}`;
}

/** Die Ticket-ID als Marke: das Kürzel leise, die Nummer laut. */
function idChip(entry: IEntry): HTMLElement {
    return el("span", "tid", el("i", "", entry.code ? `${entry.code}-` : "#"), String(entry.number));
}

// Dieselbe Rechnung wie Duration() im Bot (src/builder/TranscriptHtml.ts).
function duration(ms: number): string {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;

    if (days > 0) return `${days} Tag${days === 1 ? "" : "e"}${hours ? ` ${hours} Std.` : ""}`;
    if (hours > 0) return `${hours} Std.${rest ? ` ${rest} Min.` : ""}`;

    return `${rest} Min.`;
}

const WHEN = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function avatar(person: IPerson): HTMLElement {
    const box = el("span", "travatar");

    if (person.avatar && person.avatar.startsWith("https://")) box.style.backgroundImage = `url("${person.avatar.replace(/["\\]/g, "")}")`;
    else box.textContent = person.name.trim().slice(0, 1).toUpperCase() || "?";

    return box;
}

function tickets(count: number): string {
    return `${count} Ticket${count === 1 ? "" : "s"}`;
}

// Zweimal klicken: weg ist weg - auch die gesicherten Anhänge.
function removeButton(entry: IEntry, onDelete: (entry: IEntry) => Promise<boolean>): HTMLButtonElement {
    const remove = el("button", "iconbtn is-danger", icon("#i-trash"));
    const label = `Transcript ${ticketId(entry)} löschen`;
    let sure: ReturnType<typeof setTimeout> | null = null;

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

        if (!(await onDelete(entry))) remove.disabled = false;
    });

    return remove;
}

/** Neuer Tab und Download - in der Zeile wie im Dialog. */
function links(entry: IEntry): HTMLElement[] {
    const page = `${BASE}/transcript/${entry.id}`;
    const tab = el("a", "iconbtn", icon("#i-external"));
    const download = el("a", "iconbtn", icon("#i-download"));

    tab.href = page;
    tab.target = "_blank";
    tab.rel = "noopener";
    tab.title = "In neuem Tab öffnen";
    tab.setAttribute("aria-label", `Transcript ${ticketId(entry)} in neuem Tab öffnen`);

    download.href = `${page}?download=1`;
    download.title = "Als HTML-Datei herunterladen";
    download.setAttribute("aria-label", `Transcript ${ticketId(entry)} als HTML-Datei herunterladen`);

    return [tab, download];
}

function skeleton(): HTMLElement[] {
    return Array.from({ length: 4 }, () => el("div", "trrow trrow--skel", el("span", "sb trskel__num"), el("span", "sb trskel__line"), el("span", "sb trskel__btn")));
}

export function renderTranscripts(guildId: string): void {
    const section = need<HTMLElement>("#transcriptions");
    const list = need<HTMLElement>("#trList");
    const search = need<HTMLInputElement>("#trSearch");
    const count = need<HTMLElement>("#trCount");
    const more = need<HTMLButtonElement>("#trMore");
    const note = need<HTMLElement>("#trNote");

    let entries: IEntry[] = [];
    let hasMore = false;
    let enabled = true;
    let canDelete = false;
    let query = "";
    // Nur die Antwort auf die letzte Anfrage zählt - schnelles Tippen überholt sich sonst.
    let ticket = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    /* ------------------------------------------------------------
       Die große Ansicht
       ------------------------------------------------------------ */
    const viewTitle = el("h2", "", "");
    const viewSub = el("p", "", "");
    const viewId = el("span", "trview__id");
    const viewAct = el("div", "trview__act");
    const viewFacts = el("dl", "trview__facts");
    const frame = el("iframe", "trview__frame");
    const stage = el(
        "div",
        "trview__stage",
        el("div", "trview__load", ...Array.from({ length: 6 }, (_, index) => el("span", `sb trview__bar${index % 3 === 0 ? " is-head" : ""}`))),
        frame
    );
    const close = el("button", "iconbtn modal__x", icon("#i-x"));
    const dialog = el(
        "dialog",
        "modal trview",
        el("div", "modal__head trview__head", viewId, el("div", "trview__title", viewTitle, viewSub), viewAct, close),
        viewFacts,
        stage
    );

    viewTitle.id = "trViewTitle";
    dialog.setAttribute("aria-labelledby", "trViewTitle");
    close.type = "button";
    close.autofocus = true;
    close.setAttribute("aria-label", "Schließen");
    // Das Transcript hat keine Skripte (eigene CSP) - same-origin braucht es für die gesicherten Anhänge.
    frame.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    frame.addEventListener("load", () => {
        if (frame.getAttribute("src") !== "about:blank") stage.classList.add("is-ready");
    });
    // Am body, nicht in der Sektion: die kann versteckt werden, während der Dialog offen ist.
    document.body.append(dialog);

    // Zu ist zu: das Transcript fliegt raus, Videos darin laufen nicht weiter.
    // Direkt hier und nicht erst im close-Event - das feuert nicht in jedem Browser.
    function hide(): void {
        frame.src = "about:blank";
        stage.classList.remove("is-ready");

        if (dialog.open) dialog.close();
    }

    close.addEventListener("click", hide);
    // Ein Klick neben den Dialog schließt ihn wie Escape.
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) hide();
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        event.preventDefault();
        hide();
    });
    dialog.addEventListener("close", () => {
        if (frame.getAttribute("src") !== "about:blank") hide();
    });

    function fact(term: string, value: (Node | string)[], wide = false): HTMLElement {
        return el("div", wide ? "trfact is-wide" : "trfact", el("dt", "", term), el("dd", "", ...value));
    }

    function person(entry: IPerson | null, fallback: string): (Node | string)[] {
        return entry ? [avatar(entry), el("span", "", entry.name)] : [fallback];
    }

    function view(entry: IEntry): void {
        const opener: (Node | string)[] = person(entry.opener, "–");

        if (entry.userCode) opener.push(userButton(entry, true));

        viewId.replaceChildren(idChip(entry));
        viewTitle.textContent = entry.option;
        viewSub.textContent = `${entry.contact === "modmail" ? "ModMail" : "Klassisch"} · geschlossen ${WHEN.format(entry.closedAt)}`;
        viewAct.replaceChildren(
            ...links(entry),
            ...(canDelete
                ? [
                      removeButton(entry, async (target) => {
                          const done = await destroy(target);

                          if (done) hide();

                          return done;
                      }),
                  ]
                : [])
        );

        const participants = (entry.participants ?? []).filter((other) => other.id !== entry.opener.id);

        viewFacts.replaceChildren(
            fact("Ersteller", opener),
            fact("Bearbeiter", person(entry.claimer, "niemand")),
            fact("Geschlossen von", person(entry.closer, "unbekannt")),
            fact("Offen", [`${duration(entry.closedAt - entry.openedAt)} · ab ${WHEN.format(entry.openedAt)}`]),
            fact("Verlauf", [
                `${entry.messages} Nachricht${entry.messages === 1 ? "" : "en"} · ${entry.files} ${entry.files === 1 ? "Anhang" : "Anhänge"}`,
            ]),
            ...(participants.length ? [fact("Beteiligt", [participants.map((other) => other.name).join(", ")])] : []),
            ...(entry.reason ? [fact("Grund", [`„${entry.reason}“`], true)] : [])
        );

        stage.classList.remove("is-ready");
        frame.title = `Transcript ${ticketId(entry)}`;
        frame.src = `${BASE}/transcript/${entry.id}?embed=1`;
        dialog.showModal();
    }

    /** U-7K3F als Knopf: zeigt alle Transcripts dieses Users. */
    function userButton(entry: IEntry, inDialog = false): HTMLButtonElement {
        const code = `U-${entry.userCode}`;
        const button = el("button", "uid", code);

        button.type = "button";
        button.title = `Alle Tickets von ${code} zeigen`;
        button.setAttribute("aria-label", `Alle Tickets von ${entry.opener.name} (${code}) zeigen`);
        button.addEventListener("click", () => {
            if (inDialog) hide();

            search.value = code;
            query = code;
            void load(true);
        });

        return button;
    }

    /* ------------------------------------------------------------
       Liste
       ------------------------------------------------------------ */
    function row(entry: IEntry): HTMLElement {
        const title = el(
            "div",
            "trrow__title",
            el("b", "", entry.option),
            el("span", `tagline${entry.contact === "modmail" ? " tagline--on" : ""}`, entry.contact === "modmail" ? "ModMail" : "Klassisch")
        );

        const who = el(
            "div",
            "trrow__who",
            avatar(entry.opener),
            el("span", "trrow__name", entry.opener.name),
            ...(entry.userCode ? [userButton(entry)] : []),
            el("span", "trrow__count", tickets(entry.openerTickets)),
            ...(entry.closer ? [el("span", "trrow__by", `geschlossen von ${entry.closer.name}`)] : [])
        );

        const facts = [
            WHEN.format(entry.closedAt),
            duration(entry.closedAt - entry.openedAt),
            `${entry.messages} Nachricht${entry.messages === 1 ? "" : "en"}`,
            ...(entry.files ? [`${entry.files} ${entry.files === 1 ? "Anhang" : "Anhänge"}`] : []),
        ];

        const main = el("div", "trrow__main", title, who, el("div", "trrow__meta", facts.join(" · ")));

        if (entry.reason) main.append(el("div", "trrow__reason", `„${entry.reason}“`));

        const open = el("button", "btn btn--quiet", icon("#i-eye"), "Ansehen");

        open.type = "button";
        open.setAttribute("aria-label", `Transcript ${ticketId(entry)} ansehen`);
        open.addEventListener("click", () => view(entry));

        const actions = el("div", "trrow__act", open, ...links(entry));

        if (canDelete) actions.append(removeButton(entry, destroy));

        const article = el("article", "trrow", idChip(entry), main, actions);

        // Die ganze Zeile öffnet - nur ihre eigenen Knöpfe und Links nicht.
        article.addEventListener("click", (event) => {
            if (!(event.target as HTMLElement).closest("a, button")) view(entry);
        });

        return article;
    }

    function empty(): HTMLElement {
        if (query) {
            return el(
                "div",
                "tkempty tkempty--big",
                icon("#i-search"),
                el("b", "", `Nichts gefunden für „${query}“.`),
                el("span", "", "Such nach der Ticket-ID (SUP-42), der User-ID (U-7K3F), dem Namen oder der Discord-ID des Erstellers.")
            );
        }

        const box = el(
            "div",
            "tkempty tkempty--big",
            icon("#i-archive"),
            el("b", "", enabled ? "Noch keine Transcripts." : "Transcripts sind ausgeschaltet."),
            el(
                "span",
                "",
                enabled
                    ? "Sie entstehen, sobald ein Ticket geschlossen wird – samt Bildern und Anhängen."
                    : canDelete
                      ? "Einschalten geht im Ticket System unter Einrichtung › Nach dem Schließen."
                      : "Einschalten kann, wer den Server verwaltet."
            )
        );

        if (!enabled && canDelete) {
            const go = el("a", "btn btn--quiet", icon("#i-sliders"), "Zur Einrichtung");

            go.href = `${BASE}/guild/${guildId}/tickets#einrichtung`;
            box.append(go);
        }

        return box;
    }

    async function destroy(entry: IEntry): Promise<boolean> {
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
        } catch {
            warn("Der Bot antwortet gerade nicht.");

            return false;
        }

        warn(null);
        entries = entries.filter((other) => other.id !== entry.id);
        paint();
        toast("info", "Transcript gelöscht", `${ticketId(entry)} ist samt Anhängen weg.`);

        return true;
    }

    function paint(): void {
        list.replaceChildren(...(entries.length ? entries.map(row) : [empty()]));
        count.textContent = entries.length ? `${entries.length}${hasMore ? "+" : ""} Transcript${entries.length === 1 ? "" : "s"}` : "";
        more.hidden = !hasMore;
    }

    async function load(reset: boolean, quiet = false): Promise<void> {
        const mine = ++ticket;
        const params = new URLSearchParams();

        if (query) params.set("q", query);
        if (!reset && entries.length) params.set("before", String(entries[entries.length - 1].id));

        if (reset && !quiet) list.replaceChildren(...skeleton());

        more.disabled = true;

        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/transcripts?${params}`, {
                headers: { Accept: "application/json" },
            });
            const failure = await failureText(response);

            if (mine !== ticket) return;

            if (failure !== null) {
                warn(failure);
                list.replaceChildren();

                return;
            }

            const data = (await response.json()) as IPayload;

            if (mine !== ticket) return;

            warn(null);
            entries = reset ? data.transcripts : [...entries, ...data.transcripts];
            hasMore = data.more;
            enabled = data.enabled;
            canDelete = data.canDelete;
            paint();
        } catch {
            if (mine === ticket) warn("Der Bot antwortet gerade nicht.");
        } finally {
            more.disabled = false;
        }
    }

    search.addEventListener("input", () => {
        if (timer) clearTimeout(timer);

        timer = setTimeout(() => {
            query = search.value.trim();
            void load(true);
        }, 250);
    });

    more.addEventListener("click", () => void load(false));

    // Ein Ticket ist gerade zu gegangen - sein Transcript steht jetzt oben.
    document.addEventListener("live:transcript", () => void load(true, true));

    let shown = !section.hidden;

    new MutationObserver(() => {
        if (!section.hidden && !shown) void load(true, true);

        shown = !section.hidden;
    }).observe(section, { attributes: true, attributeFilter: ["hidden"] });

    void load(true);
}
