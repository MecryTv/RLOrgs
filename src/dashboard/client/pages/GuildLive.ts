/**
 * Abschnitt: Live Tickets - offene Tickets mitlesen und direkt antworten.
 *
 * Links die offenen Tickets, rechts der Chat. Neues kommt als Server-Sent
 * Events; EventSource verbindet nach einem Abbruch selbst neu. Die Nachrichten
 * rendert der Bot - dieselbe Darstellung wie im Transcript. Sie stehen in einem
 * Shadow DOM, damit sich Dashboard und Discord-Look nicht die Stile verbiegen.
 *
 * Geladen wird erst, wenn Live Tickets oder Transcriptions das erste Mal offen
 * sind; die Verbindung bleibt danach stehen, damit Zähler und Ton weiterlaufen.
 * Ist ein Transcript fertig, sagt der Stream es der Liste unter Transcriptions
 * (Ereignis "live:transcript" am document).
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { failureText } from "../core/Gallery.js";
import { clickSound, tone } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { emojiNode, emojiPicker, IServerEmoji } from "../layout/EmojiPicker.js";
import { galleryUrl, pickImage } from "../layout/ImagePicker.js";

interface IPerson {
    id: string;
    name: string;
    avatar: string | null;
}

interface ILiveTicket {
    id: number;
    number: number;
    option: { id: string; name: string; emoji: string | null };
    contact: "direct" | "modmail";
    status: "open" | "frozen" | "closed";
    priority: "low" | "normal" | "high" | null;
    opener: IPerson;
    claimer: { id: string; name: string } | null;
    members: IPerson[];
    anonymous: string[];
    slowmode: number;
    reminderAt: number | null;
    createdAt: number;
    lastAt: number;
    messages: number;
    url: string | null;
}

interface ILiveMessage {
    id: string;
    at: number;
    author: string;
    reply: boolean;
    html: string;
    compact: string;
}

interface ILiveEvent extends ILiveMessage {
    ticketId: number;
    preview: string;
}

/** Eine Aktion aus dem Menü unter dem Ticket - nur, was der Server eingeschaltet hat. */
interface IAction {
    value: string;
    name: string;
    emoji: string | null;
    description: string;
}

interface IPayload {
    me: { id: string; manage: boolean };
    actions: IAction[];
    options: { id: string; name: string; emoji: string | null }[];
    slowmodes: { value: number; label: string }[];
    tickets: ILiveTicket[];
    emojis: IServerEmoji[];
    css: string;
}

export interface ILiveUser {
    id: string;
    name: string;
    avatar: string | null;
}

type Filter = "all" | "mine" | "open";

const PRIORITIES: [string, string, string][] = [
    ["low", "🟢", "Niedrig"],
    ["normal", "🟡", "Normal"],
    ["high", "🔴", "Hoch"],
];

const MAX_FILE = 8 * 1024 * 1024;
// Wie Discord: dieselbe Person innerhalb von sieben Minuten ohne neuen Kopf.
const GROUP_MS = 7 * 60_000;
const SOUND_KEY = "rlnexus.live.sound";

// Was der Chat über das Aussehen des Transcripts hinaus braucht.
const EXTRA_CSS =
    ".more{display:block;margin:10px auto 2px;padding:7px 14px;border:0;border-radius:6px;background:#2b2d31;color:#dbdee1;font:inherit;font-size:13px;cursor:pointer}" +
    ".more:hover{background:#35373c}.more[hidden]{display:none}.more:focus-visible{outline:2px solid #00afff;outline-offset:2px}";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (className) element.className = className;

    element.append(...children);

    return element;
}

function ticketNumber(value: number): string {
    return `#${String(value).padStart(4, "0")}`;
}

function ago(ms: number): string {
    const minutes = Math.round((Date.now() - ms) / 60_000);

    if (minutes < 1) return "gerade";
    if (minutes < 60) return `vor ${minutes} Min.`;

    const hours = Math.round(minutes / 60);

    if (hours < 24) return `vor ${hours} Std.`;

    return new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

const WHEN = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

// Für <input type="datetime-local">: Ortszeit ohne Sekunden.
function localInput(ms: number): string {
    return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

// Die eigenen Knöpfe stehen im Kopf - im Menü nur der Rest.
const HEAD_ACTIONS = new Set(["claim", "unclaim", "priority", "close"]);

function bytes(size: number): string {
    return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function avatar(person: { name: string; avatar: string | null }): HTMLElement {
    const box = el("span", "travatar");

    if (person.avatar?.startsWith("https://")) box.style.backgroundImage = `url("${person.avatar.replace(/["\\]/g, "")}")`;
    else box.textContent = person.name.trim().slice(0, 1).toUpperCase() || "?";

    return box;
}

/**
 * Das HTML kommt vom Bot, und TranscriptHtml escapt jeden Text darin. Trotzdem
 * fliegt raus, was in einer Nachricht nie vorkommt: Skripte, Event-Handler,
 * Links mit fremden Protokollen.
 */
function parse(html: string): DocumentFragment {
    const template = document.createElement("template");

    template.innerHTML = html;

    for (const node of template.content.querySelectorAll("script, style, iframe, object, embed, form, link, meta, base")) node.remove();

    for (const node of template.content.querySelectorAll("*")) {
        for (const attribute of [...node.attributes]) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim().toLowerCase();
            const foreign = (name === "href" || name === "src") && !/^(https?:|#|\/(?!\/))/.test(value);

            if (name.startsWith("on") || name === "srcdoc" || foreign) node.removeAttribute(attribute.name);
        }
    }

    return template.content;
}

function readSound(): boolean {
    try {
        return localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
        return true;
    }
}

function saveSound(on: boolean): void {
    try {
        localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
        // Ohne Speicher gilt der Schalter nur bis zum Neuladen.
    }
}

// Zwei Töne aufwärts - freundlich, aber nicht zu überhören.
function chime(): void {
    tone(880, 0.12, 0.05, "sine");
    window.setTimeout(() => tone(1175, 0.18, 0.04, "sine"), 120);
}

export function renderLive(guildId: string, user: ILiveUser): void {
    const section = need<HTMLElement>("#live-tickets");
    const host = need<HTMLElement>("#ltBody");
    const note = need<HTMLElement>("#ltNote");
    const api = `${BASE}/api/guild/${encodeURIComponent(guildId)}/live`;

    let data: IPayload | null = null;
    const tickets = new Map<number, ILiveTicket>();
    const unread = new Map<number, number>();
    const previews = new Map<number, string>();
    const drafts = new Map<number, string>();
    let current: number | null = null;
    // Das Ticket, das gerade offen war, als es geschlossen wurde - für den Hinweis im Chat.
    let ended: ILiveTicket | null = null;
    let filter: Filter = "all";
    let query = "";
    let sound = readSound();
    let broken = false;
    let baseTitle = document.title;

    // Chat
    let lastAuthor: string | null = null;
    let lastAt = 0;
    let oldest: string | null = null;
    let pinned = true;
    let follow = 0;
    let fresh = 0;
    let files: File[] = [];
    let pictures: string[] = [];
    let sending = false;
    // Die offene Leiste unter dem Kopf: Schließen, Verschieben, Notiz ...
    let panel: string | null = null;

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    /* ------------------------------------------------------------
       Gerüst
       ------------------------------------------------------------ */
    const status = el("span", "ltlive", "Verbinde …");
    const soundButton = el("button", "iconbtn", icon("#i-bell"));
    const search = el("input", "text ltsearch");
    const filters = el("div", "seg ltfilter");
    const items = el("div", "ltitems");
    const list = el(
        "aside",
        "lt__list",
        el("div", "lt__head", status, soundButton),
        el("div", "lt__tools", filters, search),
        items
    );

    soundButton.type = "button";
    search.type = "search";
    search.placeholder = "Nummer, Name, Thema";
    search.setAttribute("aria-label", "Offene Tickets durchsuchen");
    items.setAttribute("role", "list");
    list.setAttribute("aria-label", "Offene Tickets");

    const head = el("header", "ltchat__head");
    const actBar = el("div", "ltact");
    const logHost = el("div", "ltlog");
    const shadow = logHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    const moreButton = el("button", "more", "Ältere Nachrichten laden");
    const log = el("div", "log");
    const freshButton = el("button", "ltfresh", icon("#i-down"), el("span", "", "Neue Nachrichten"));
    const input = el("textarea", "text ltcompose__input");
    const counter = el("span", "ltcompose__count");
    const fileInput = el("input");
    const attach = el("button", "iconbtn", icon("#i-upload"));
    const galleryButton = el("button", "iconbtn", icon("#i-image"));
    const sendButton = el("button", "btn btn--primary ltcompose__send", icon("#i-arrow"), el("span", "", "Senden"));
    const chips = el("div", "ltcompose__files");
    const tools = el("div", "ltcompose__tools", attach, galleryButton);
    const composer = el(
        "div",
        "ltcompose",
        chips,
        el("div", "ltcompose__row", tools, input, sendButton),
        el("p", "ltcompose__hint", "Enter sendet, Shift+Enter macht eine neue Zeile. In Discord steht dein Name mit „via Dashboard“.", counter)
    );
    const empty = el("div", "ltempty");
    const chat = el("section", "lt__chat", empty, head, actBar, logHost, freshButton, composer);

    moreButton.type = "button";
    moreButton.hidden = true;
    shadow.append(style, moreButton, log);
    logHost.setAttribute("role", "log");
    logHost.setAttribute("aria-live", "polite");
    logHost.setAttribute("aria-label", "Verlauf des Tickets");
    freshButton.type = "button";
    freshButton.hidden = true;
    input.rows = 1;
    input.maxLength = 2000;
    input.setAttribute("aria-label", "Nachricht");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.hidden = true;
    attach.type = "button";
    attach.title = "Datei anhängen";
    attach.setAttribute("aria-label", "Datei anhängen");
    galleryButton.type = "button";
    galleryButton.title = "Bild aus der Galerie";
    galleryButton.setAttribute("aria-label", "Bild aus der Galerie");
    sendButton.type = "button";
    actBar.hidden = true;
    composer.append(fileInput);
    chat.setAttribute("aria-label", "Ticket-Chat");

    /* ------------------------------------------------------------
       Liste
       ------------------------------------------------------------ */
    function paintStatus(): void {
        status.textContent = broken ? "Verbindung weg – verbinde neu …" : "Live";
        status.classList.toggle("is-off", broken);
        soundButton.setAttribute("aria-pressed", String(sound));
        soundButton.setAttribute("aria-label", sound ? "Ton bei neuen Tickets: an" : "Ton bei neuen Tickets: aus");
        soundButton.title = sound ? "Ton bei neuen Tickets: an" : "Ton bei neuen Tickets: aus";
    }

    function visible(): ILiveTicket[] {
        const text = query.toLowerCase().replace("#", "");

        return [...tickets.values()]
            .filter((ticket) =>
                filter === "mine" ? ticket.claimer?.id === data?.me.id : filter === "open" ? ticket.claimer === null : true
            )
            .filter(
                (ticket) =>
                    !text ||
                    String(ticket.number).includes(text.replace(/^0+/, "") || "0") ||
                    ticket.opener.name.toLowerCase().includes(text) ||
                    ticket.opener.id === text ||
                    ticket.option.name.toLowerCase().includes(text)
            )
            .sort((a, b) => b.lastAt - a.lastAt);
    }

    function paintFilters(): void {
        const all = [...tickets.values()];
        const counts: Record<Filter, number> = {
            all: all.length,
            mine: all.filter((ticket) => ticket.claimer?.id === data?.me.id).length,
            open: all.filter((ticket) => ticket.claimer === null).length,
        };

        filters.replaceChildren(
            ...(
                [
                    ["all", "Alle"],
                    ["mine", "Meine"],
                    ["open", "Frei"],
                ] as [Filter, string][]
            ).map(([value, label]) => {
                const button = el("button", "", `${label} ${counts[value]}`);

                button.type = "button";
                button.title =
                    value === "all" ? "Alle offenen Tickets" : value === "mine" ? "Die du übernommen hast" : "Noch von niemandem übernommen";
                button.setAttribute("aria-pressed", String(value === filter));
                button.addEventListener("click", () => {
                    filter = value;
                    paintList();
                });

                return button;
            })
        );
    }

    function item(ticket: ILiveTicket): HTMLElement {
        const count = unread.get(ticket.id) ?? 0;
        const button = el("button", `ltitem${ticket.id === current ? " is-on" : ""}${count ? " is-unread" : ""}`);
        const chipsRow = el("span", "ltitem__chips");

        if (ticket.priority) {
            const priority = PRIORITIES.find(([value]) => value === ticket.priority)!;

            chipsRow.append(el("span", "ltchip", `${priority[1]} ${priority[2]}`));
        }

        chipsRow.append(el("span", `ltchip${ticket.claimer ? " is-claimed" : " is-free"}`, ticket.claimer ? `✅ ${ticket.claimer.name}` : "⏳ frei"));

        if (ticket.status === "frozen") chipsRow.append(el("span", "ltchip", "❄️ eingefroren"));

        const preview = previews.get(ticket.id);

        button.type = "button";
        button.setAttribute("role", "listitem");
        button.setAttribute("aria-current", String(ticket.id === current));
        button.append(
            avatar(ticket.opener),
            el(
                "span",
                "ltitem__main",
                el(
                    "span",
                    "ltitem__top",
                    el("b", "", ticketNumber(ticket.number)),
                    el(
                        "span",
                        "ltitem__option",
                        ...(ticket.option.emoji ? [emojiNode(ticket.option.emoji, data?.emojis ?? [], "tkemoji")] : []),
                        ticket.option.name
                    )
                ),
                el("span", "ltitem__who", ticket.opener.name),
                ...(preview ? [el("span", "ltitem__preview", preview)] : []),
                chipsRow
            ),
            el("span", "ltitem__side", el("time", "", ago(ticket.lastAt)), ...(count ? [el("span", "ltitem__badge", String(count))] : []))
        );
        button.setAttribute(
            "aria-label",
            `${ticketNumber(ticket.number)} ${ticket.option.name}, ${ticket.opener.name}${count ? `, ${count} neue Nachrichten` : ""}`
        );
        button.addEventListener("click", () => void select(ticket.id));

        return button;
    }

    function paintList(): void {
        paintFilters();

        const shown = visible();

        if (shown.length === 0) {
            items.replaceChildren(
                el(
                    "p",
                    "ltitems__empty",
                    tickets.size === 0 ? "Gerade ist kein Ticket offen." : "Kein Ticket passt zu Filter und Suche."
                )
            );

            return;
        }

        items.replaceChildren(...shown.map(item));
    }

    function paintTitle(): void {
        const total = [...unread.values()].reduce((sum, count) => sum + count, 0);

        document.title = total ? `(${total}) ${baseTitle}` : baseTitle;
    }

    /* ------------------------------------------------------------
       Chat
       ------------------------------------------------------------ */
    function paintEmpty(): void {
        empty.replaceChildren(
            icon(ended ? "#i-archive" : "#i-message"),
            el("b", "", ended ? `Ticket ${ticketNumber(ended.number)} ist geschlossen.` : "Wähl links ein Ticket."),
            el(
                "span",
                "",
                ended
                    ? "Der Verlauf steht gleich unter Transcriptions – sofern der Server Transcripts speichert."
                    : "Der Verlauf läuft hier live mit, und du antwortest direkt von hier."
            )
        );

        empty.hidden = current !== null;
        head.hidden = current === null;
        logHost.hidden = current === null;
        composer.hidden = current === null;
        freshButton.hidden = current === null || fresh === 0;
        actBar.hidden = current === null || panel === null;
    }

    function action(label: string, className: string, run: () => unknown): HTMLButtonElement {
        const button = el("button", className, label);

        button.type = "button";
        button.addEventListener("click", () => void run());

        return button;
    }

    function paintHead(): void {
        const ticket = current !== null ? tickets.get(current) : undefined;

        if (!ticket || !data) {
            head.replaceChildren();

            return;
        }

        const mine = ticket.claimer?.id === data.me.id;
        const back = el("button", "iconbtn ltchat__back", icon("#i-arrow"));

        back.type = "button";
        back.setAttribute("aria-label", "Zurück zur Liste");
        back.addEventListener("click", () => host.classList.remove("is-chat"));

        const title = el(
            "div",
            "ltchat__title",
            el("b", "", `${ticketNumber(ticket.number)} · ${ticket.option.name}`),
            el(
                "span",
                "",
                `${ticket.opener.name} · ${ticket.contact === "modmail" ? "ModMail" : "im Server"} · offen ${ago(ticket.createdAt)}${ticket.status === "frozen" ? " · ❄️ eingefroren" : ""}`
            )
        );

        const actions = el("div", "ltchat__actions");

        if (!ticket.claimer) {
            actions.append(action("Übernehmen", "btn btn--quiet", () => run({ action: "claim" }, "Du bearbeitest das Ticket.")));
        } else if (mine || data.me.manage) {
            actions.append(action("Zurückgeben", "btn btn--quiet", () => run({ action: "unclaim" }, "Das Ticket ist wieder frei.")));
        } else {
            actions.append(el("span", "ltchip is-claimed", `✅ ${ticket.claimer.name}`));
        }

        if (has("priority")) {
            const priority = el("select", "pick ltprio", el("option", "", "Priorität …"));

            (priority.firstElementChild as HTMLOptionElement).value = "";
            (priority.firstElementChild as HTMLOptionElement).disabled = true;

            for (const [value, emoji, label] of PRIORITIES) {
                const option = el("option", "", `${emoji} ${label}`);

                option.value = value;
                priority.append(option);
            }

            priority.value = ticket.priority ?? "";
            priority.setAttribute("aria-label", "Priorität");
            priority.addEventListener("change", () => void run({ action: "priority", priority: priority.value }, "Priorität gesetzt."));
            actions.append(priority);
        }

        if (ticket.url) {
            const discord = el("a", "iconbtn", icon("#i-external"));

            discord.href = ticket.url;
            discord.target = "_blank";
            discord.rel = "noopener";
            discord.title = "In Discord öffnen";
            discord.setAttribute("aria-label", "In Discord öffnen");
            actions.append(discord);
        }

        const extra = data.actions.filter((entry) => !HEAD_ACTIONS.has(entry.value));

        if (extra.length) {
            const menu = el("select", "pick ltmenu", el("option", "", "⚙️ Aktion …"));

            (menu.firstElementChild as HTMLOptionElement).value = "";

            for (const entry of extra) {
                const name =
                    entry.value === "freeze" && ticket.status === "frozen"
                        ? "Ticket auftauen"
                        : entry.value === "anonymous_mode"
                          ? `${entry.name}: ${ticket.anonymous.includes(data.me.id) ? "an" : "aus"}`
                          : entry.name;
                const option = el("option", "", `${entry.emoji ? `${entry.emoji} ` : ""}${name}`);

                option.value = entry.value;
                option.title = entry.description;
                menu.append(option);
            }

            menu.value = "";
            menu.setAttribute("aria-label", "Weitere Aktionen");
            menu.addEventListener("change", () => {
                const value = menu.value;

                menu.value = "";
                void choose(value);
            });
            actions.append(menu);
        }

        actions.append(action("Schließen", "btn btn--quiet is-danger", () => openPanel("close")));

        head.replaceChildren(back, title, actions);
    }

    function has(value: string): boolean {
        return data?.actions.some((entry) => entry.value === value) ?? false;
    }

    /** Einfrieren und der anonyme Modus schalten sofort - alles andere fragt erst in der Leiste nach. */
    async function choose(value: string): Promise<void> {
        if (value === "freeze") {
            await run<{ frozen?: boolean }>({ action: "freeze" }, (answer) => (answer.frozen ? "Das Ticket ist eingefroren." : "Das Ticket ist wieder offen."));
        } else if (value === "anonymous_mode") {
            await run<{ anonymous?: boolean }>({ action: "anonymous_mode" }, (answer) =>
                answer.anonymous ? "Anonymer Modus an – du schreibst unter dem Team-Alias." : "Anonymer Modus aus – du schreibst wieder unter deinem Namen."
            );
        } else {
            openPanel(value);
        }
    }

    function openPanel(kind: string | null): void {
        panel = kind !== null && panel === kind ? null : kind;
        paintPanel();
    }

    function control<K extends "input" | "select" | "textarea">(tag: K, label: string): HTMLElementTagNameMap[K] {
        const element = el(tag, tag === "select" ? "pick ltact__grow" : "text ltact__grow");

        element.setAttribute("aria-label", label);

        return element;
    }

    function personButton(person: IPerson, pick: () => Promise<unknown>): HTMLButtonElement {
        const button = el("button", "ltperson", avatar(person), el("span", "", person.name));

        button.type = "button";
        button.addEventListener("click", async () => {
            button.disabled = true;

            if (!(await pick())) button.disabled = false;
        });

        return button;
    }

    /** Die Leiste unter dem Kopf - für jede Aktion, die vorher etwas wissen will. */
    function paintPanel(): void {
        const ticket = current !== null ? tickets.get(current) : undefined;
        const kind = panel;

        actBar.hidden = kind === null || !ticket || !data;
        actBar.classList.toggle("is-danger", kind === "close" || kind === "blacklist");

        if (kind === null || !ticket || !data) {
            actBar.replaceChildren();

            return;
        }

        const id = ticket.id;
        const label = (text: string): HTMLElement => el("b", "ltact__label", text);
        const note = (text: string): HTMLElement => el("span", "ltact__note", text);
        const cancel = action(kind === "tldr_summary" || kind === "media_vault" ? "Ausblenden" : "Abbrechen", "btn btn--quiet", () => openPanel(null));
        // Nach dem Erfolg geht die Leiste zu; ein Fehler steht oben im Hinweis.
        const submit = (text: string, body: () => Record<string, unknown> | null, done: string, danger = false): HTMLButtonElement => {
            const button = action(text, `btn btn--quiet${danger ? " is-danger is-sure" : ""}`, async () => {
                const payload = body();

                if (!payload) return;

                button.disabled = true;

                if (await run(payload, done)) openPanel(null);
                else button.disabled = false;
            });

            return button;
        };
        const keys = (element: HTMLElement, confirm: HTMLButtonElement | null): void => {
            element.addEventListener("keydown", (event) => {
                if (event.key === "Escape") cancel.click();
                if (event.key === "Enter" && confirm && !(element instanceof HTMLTextAreaElement)) confirm.click();
            });
        };

        switch (kind) {
            case "close":
            case "blacklist": {
                const closing = kind === "close";
                const reason = control("input", closing ? "Grund fürs Schließen" : "Grund der Sperre");

                reason.type = "text";
                reason.maxLength = 300;
                reason.placeholder = closing
                    ? "Grund (optional) – steht im Ticket und im Transcript"
                    : "Grund (optional) – der User kann hier danach keine Tickets mehr öffnen";

                const confirm = submit(
                    closing ? "Ticket schließen" : "Sperren und schließen",
                    () => ({ action: kind, reason: reason.value.trim() }),
                    closing ? "Das Ticket wird geschlossen." : "Der User ist gesperrt, das Ticket wird geschlossen.",
                    true
                );

                keys(reason, confirm);
                actBar.replaceChildren(icon("#i-warn"), reason, confirm, cancel);
                reason.focus();

                return;
            }

            case "transfer": {
                const target = control("select", "Neues Thema");

                for (const option of data.options.filter((entry) => entry.id !== ticket.option.id)) {
                    const entry = el("option", "", `${option.emoji && !option.emoji.startsWith("<") ? `${option.emoji} ` : ""}${option.name}`);

                    entry.value = option.id;
                    target.append(entry);
                }

                if (target.options.length === 0) {
                    actBar.replaceChildren(label("Verschieben"), note("Es gibt kein anderes Thema."), cancel);

                    return;
                }

                const confirm = submit("Verschieben", () => ({ action: "transfer", option: target.value }), "Das Ticket ist verschoben.");

                keys(target, null);
                actBar.replaceChildren(label("Verschieben nach"), target, confirm, cancel);
                target.focus();

                return;
            }

            case "slowmode": {
                const step = control("select", "Slowmode");

                for (const entry of data.slowmodes) {
                    const option = el("option", "", entry.label);

                    option.value = String(entry.value);
                    step.append(option);
                }

                step.value = String(ticket.slowmode);

                const confirm = submit("Setzen", () => ({ action: "slowmode", seconds: Number(step.value) }), "Der Slowmode ist gesetzt.");

                keys(step, null);
                actBar.replaceChildren(label("Slowmode"), step, confirm, cancel);
                step.focus();

                return;
            }

            case "staff_note": {
                const text = control("textarea", "Team-Notiz");

                text.rows = 2;
                text.maxLength = 1000;
                text.placeholder = "Nur fürs Team – der User sieht sie nie";

                const confirm = submit(
                    "Notiz speichern",
                    () => (text.value.trim() ? { action: "staff_note", text: text.value.trim() } : null),
                    "Notiz gespeichert – nur das Team sieht sie."
                );

                keys(text, confirm);
                actBar.replaceChildren(label("Notiz"), text, confirm, cancel);
                text.focus();

                return;
            }

            case "schedule_meeting": {
                const when = control("input", "Datum und Uhrzeit");
                const text = control("input", "Worum es geht");

                when.type = "datetime-local";
                when.min = localInput(Date.now() + 60_000);
                when.value = localInput(ticket.reminderAt && ticket.reminderAt > Date.now() ? ticket.reminderAt : (Math.floor(Date.now() / 3_600_000) + 2) * 3_600_000);
                text.type = "text";
                text.maxLength = 300;
                text.placeholder = "Worum es geht (optional)";

                const confirm = submit(
                    "Termin setzen",
                    () => {
                        const at = new Date(when.value).getTime();

                        if (Number.isFinite(at)) return { action: "schedule_meeting", at, text: text.value.trim() };

                        when.focus();

                        return null;
                    },
                    "Der Termin steht."
                );

                keys(when, confirm);
                keys(text, confirm);
                actBar.replaceChildren(label("Termin"), when, text, confirm, cancel);
                when.focus();

                return;
            }

            case "add_user": {
                const query = control("input", "User suchen");
                const results = el("div", "ltact__list");
                let timer = 0;
                let asked = 0;

                query.type = "search";
                query.placeholder = "Name oder User-ID …";
                query.addEventListener("input", () => {
                    window.clearTimeout(timer);
                    timer = window.setTimeout(async () => {
                        const mine = ++asked;
                        const text = query.value.trim();

                        if (!text) {
                            results.replaceChildren();

                            return;
                        }

                        const answer = await post<{ members?: IPerson[] }>(id, { action: "members", query: text });

                        if (mine !== asked || panel !== "add_user" || current !== id) return;

                        const found = answer?.members ?? [];

                        results.replaceChildren(
                            ...(found.length
                                ? found.map((person) =>
                                      personButton(person, async () => {
                                          const done = await run({ action: "add_user", user: person.id }, `${person.name} ist jetzt im Ticket.`);

                                          if (done) openPanel(null);

                                          return done;
                                      })
                                  )
                                : [note("Niemand gefunden – oder schon im Ticket.")])
                        );
                    }, 250);
                });

                keys(query, null);
                actBar.replaceChildren(label("Hinzufügen"), query, cancel, results);
                query.focus();

                return;
            }

            case "remove_user": {
                const list = el(
                    "div",
                    "ltact__list",
                    ...(ticket.members.length
                        ? ticket.members.map((person) =>
                              personButton(person, async () => {
                                  const done = await run({ action: "remove_user", user: person.id }, `${person.name} ist nicht mehr im Ticket.`);

                                  if (done) openPanel(null);

                                  return done;
                              })
                          )
                        : [note("Außer dem Ersteller ist niemand im Ticket.")])
                );

                actBar.replaceChildren(label("Entfernen"), cancel, list);

                return;
            }

            case "tldr_summary": {
                const priority = PRIORITIES.find(([value]) => value === ticket.priority);
                const slowmode = data.slowmodes.find((entry) => entry.value === ticket.slowmode);
                const facts: [string, string][] = [
                    ["Ersteller", ticket.opener.name],
                    ["Offen seit", `${WHEN.format(ticket.createdAt)} (${ago(ticket.createdAt)})`],
                    ["Priorität", priority ? `${priority[1]} ${priority[2]}` : "keine"],
                    ["Bearbeiter", ticket.claimer?.name ?? "niemand"],
                    ["Status", ticket.status === "frozen" ? "❄️ eingefroren" : "offen"],
                    ["Nachrichten", String(ticket.messages)],
                    ["Weitere User", ticket.members.map((person) => person.name).join(", ") || "keine"],
                    ...(ticket.slowmode && slowmode ? ([["Slowmode", slowmode.label]] as [string, string][]) : []),
                    ...(ticket.reminderAt ? ([["Termin", WHEN.format(ticket.reminderAt)]] as [string, string][]) : []),
                ];
                const notes = el("div", "ltnotes", note("Team-Notizen laden …"));

                actBar.replaceChildren(
                    label(`Zusammenfassung ${ticketNumber(ticket.number)}`),
                    cancel,
                    el("dl", "ltfacts", ...facts.flatMap(([term, value]) => [el("dt", "", term), el("dd", "", value)])),
                    notes
                );

                void post<{ notes?: { by: string; at: number; text: string }[] }>(id, { action: "tldr_summary" }).then((answer) => {
                    if (panel !== "tldr_summary" || current !== id) return;

                    const entries = answer?.notes ?? [];

                    notes.replaceChildren(
                        el("b", "", "📝 Team-Notizen"),
                        ...(entries.length
                            ? entries.map((entry) => el("p", "", el("time", "", WHEN.format(entry.at)), ` ${entry.by}: ${entry.text}`))
                            : [note("Noch keine.")])
                    );
                });

                return;
            }

            case "media_vault": {
                const grid = el("div", "ltvault", note("Dateien laden …"));

                actBar.replaceChildren(label("Medien-Tresor"), cancel, grid);

                void post<{ items?: { url: string; name: string; image: boolean }[] }>(id, { action: "media_vault" }).then((answer) => {
                    if (panel !== "media_vault" || current !== id) return;

                    const found = (answer?.items ?? []).filter((entry) => entry.url.startsWith("https://"));

                    grid.replaceChildren(
                        ...(found.length
                            ? found.map((entry) => {
                                  const link = el("a", `ltvault__item${entry.image ? " is-image" : ""}`);

                                  link.href = entry.url;
                                  link.target = "_blank";
                                  link.rel = "noopener";
                                  link.title = entry.name;

                                  if (entry.image) {
                                      const image = el("img");

                                      image.src = entry.url;
                                      image.alt = entry.name;
                                      image.loading = "lazy";
                                      link.append(image);
                                  } else {
                                      link.append(icon("#i-download"), el("span", "", entry.name));
                                  }

                                  return link;
                              })
                            : [note("In diesem Ticket wurde noch nichts hochgeladen.")])
                    );
                });

                return;
            }

            default:
                panel = null;
                actBar.hidden = true;
                actBar.replaceChildren();
        }
    }

    function scrollToBottom(): void {
        logHost.scrollTop = logHost.scrollHeight;
        fresh = 0;
        freshButton.hidden = true;
    }

    function insert(messages: ILiveMessage[], where: "start" | "end"): void {
        const fragment = document.createDocumentFragment();

        for (const message of messages) {
            if (!shadow.getElementById(`m-${message.id}`)) fragment.append(parse(message.html));
        }

        if (where === "start") log.prepend(fragment);
        else log.append(fragment);

        if (messages.length === 0) return;

        if (where === "start" || oldest === null) oldest = messages[0].id;

        if (where === "end") {
            const last = messages[messages.length - 1];

            lastAuthor = last.author;
            lastAt = last.at;
        }
    }

    function append(message: ILiveEvent): void {
        if (shadow.getElementById(`m-${message.id}`)) return;

        const grouped = !message.reply && lastAuthor === message.author && message.at - lastAt < GROUP_MS;

        log.append(parse(grouped ? message.compact : message.html));
        lastAuthor = message.author;
        lastAt = message.at;

        if (pinned || Date.now() < follow) scrollToBottom();
        else {
            fresh++;
            freshButton.hidden = false;
            freshButton.lastElementChild!.textContent = fresh === 1 ? "1 neue Nachricht" : `${fresh} neue Nachrichten`;
        }
    }

    async function request<T>(url: string, init?: RequestInit): Promise<T | null> {
        try {
            const response = await fetch(url, {
                ...init,
                headers: { Accept: "application/json", ...(init?.headers as Record<string, string> | undefined) },
            });
            const failure = await failureText(response);

            if (failure !== null) {
                warn(failure);

                return null;
            }

            warn(null);

            return (await response.json().catch(() => ({}))) as T;
        } catch {
            warn("Der Bot antwortet gerade nicht.");

            return null;
        }
    }

    async function post<T>(id: number, body: Record<string, unknown>): Promise<T | null> {
        return request<T>(`${api}/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    /** Eine Aktion am offenen Ticket, mit Rückmeldung. null: es hat nicht geklappt (der Grund steht oben). */
    async function run<T = Record<string, unknown>>(body: Record<string, unknown>, done: string | ((answer: T) => string)): Promise<T | null> {
        if (current === null) return null;

        clickSound("primary");

        const answer = await post<T>(current, body);

        if (answer === null) return null;

        toast("info", "Erledigt", typeof done === "string" ? done : done(answer));

        return answer;
    }

    async function loadHistory(id: number): Promise<void> {
        log.replaceChildren();
        moreButton.hidden = true;
        lastAuthor = null;
        lastAt = 0;
        oldest = null;
        fresh = 0;

        const result = await request<{ messages: ILiveMessage[]; more: boolean }>(`${api}/${id}`);

        if (!result || current !== id) return;

        insert(result.messages, "end");
        moreButton.hidden = !result.more;
        scrollToBottom();
    }

    async function select(id: number): Promise<void> {
        if (current !== null) drafts.set(current, input.value);

        current = id;
        ended = null;
        panel = null;
        files = [];
        pictures = [];
        input.value = drafts.get(id) ?? "";
        unread.delete(id);
        host.classList.add("is-chat");

        paintTitle();
        paintList();
        paintHead();
        paintPanel();
        paintEmpty();
        paintFiles();
        grow();

        await loadHistory(id);
    }

    moreButton.addEventListener("click", async () => {
        if (current === null || !oldest) return;

        const id = current;
        const height = logHost.scrollHeight;

        moreButton.disabled = true;

        const result = await request<{ messages: ILiveMessage[]; more: boolean }>(`${api}/${id}?before=${encodeURIComponent(oldest)}`);

        moreButton.disabled = false;

        if (!result || current !== id) return;

        insert(result.messages, "start");
        moreButton.hidden = !result.more;
        // Der Blick bleibt, wo er war - die älteren Nachrichten wachsen nach oben.
        logHost.scrollTop += logHost.scrollHeight - height;
    });

    logHost.addEventListener("scroll", () => {
        pinned = logHost.scrollHeight - logHost.scrollTop - logHost.clientHeight < 80;

        if (pinned && fresh) {
            fresh = 0;
            freshButton.hidden = true;
        }
    });

    // Bilder laden nach - wer unten war, soll unten bleiben.
    shadow.addEventListener("load", () => pinned && scrollToBottom(), true);
    freshButton.addEventListener("click", scrollToBottom);

    /* ------------------------------------------------------------
       Schreiben
       ------------------------------------------------------------ */
    function grow(): void {
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
        counter.textContent = input.value.length > 1800 ? `${input.value.length} / 2000` : "";
    }

    function paintFiles(): void {
        const entries: HTMLElement[] = [];

        files.forEach((file, index) => {
            const remove = el("button", "", icon("#i-x"));

            remove.type = "button";
            remove.setAttribute("aria-label", `${file.name} entfernen`);
            remove.addEventListener("click", () => {
                files.splice(index, 1);
                paintFiles();
            });
            entries.push(el("span", "tkchip", el("span", "", `📎 ${file.name} · ${bytes(file.size)}`), remove));
        });

        pictures.forEach((id, index) => {
            const remove = el("button", "", icon("#i-x"));
            const url = galleryUrl(guildId, id);
            const label = id.split("/").pop() ?? id;

            remove.type = "button";
            remove.setAttribute("aria-label", `${label} entfernen`);
            remove.addEventListener("click", () => {
                pictures.splice(index, 1);
                paintFiles();
            });

            const chip = el("span", "tkchip");

            if (url) {
                const image = el("img", "ltcompose__thumb");

                image.src = url;
                image.alt = "";
                chip.append(image);
            }

            chip.append(el("span", "", label), remove);
            entries.push(chip);
        });

        chips.replaceChildren(...entries);
        chips.hidden = entries.length === 0;
    }

    function insertText(text: string): void {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;

        input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`.slice(0, 2000);
        input.focus();
        input.selectionStart = input.selectionEnd = Math.min(start + text.length, input.value.length);
        grow();
    }

    async function upload(id: number, file: File): Promise<boolean> {
        const result = await request(`${api}/${id}/file?name=${encodeURIComponent(file.name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: file,
        });

        return result !== null;
    }

    async function send(): Promise<void> {
        if (sending || current === null) return;

        const id = current;
        const text = input.value.trim();

        if (!text && files.length === 0 && pictures.length === 0) return;

        sending = true;
        sendButton.disabled = true;
        clickSound("primary");

        try {
            // Dateien zuerst, je eine Nachricht - danach der Text mit den Bildern aus der Galerie.
            for (const file of [...files]) {
                if (!(await upload(id, file))) return;

                files = files.filter((entry) => entry !== file);
                paintFiles();
            }

            if (text || pictures.length) {
                const result = await request(`${api}/${id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "send", content: text, gallery: pictures }),
                });

                if (result === null) return;

                if (current === id) {
                    input.value = "";
                    pictures = [];
                    paintFiles();
                    grow();
                }

                drafts.delete(id);
            }

            follow = Date.now() + 6000;
            scrollToBottom();
        } finally {
            sending = false;
            sendButton.disabled = false;
        }
    }

    input.addEventListener("input", grow);
    input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

        event.preventDefault();
        void send();
    });
    sendButton.addEventListener("click", () => void send());
    attach.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
        const chosen = [...(fileInput.files ?? [])];

        fileInput.value = "";

        const large = chosen.filter((file) => file.size > MAX_FILE);

        files = [...files, ...chosen.filter((file) => file.size <= MAX_FILE)].slice(0, 10);
        warn(large.length ? `Zu groß (höchstens 8 MB): ${large.map((file) => file.name).join(", ")}` : null);
        paintFiles();
    });
    galleryButton.addEventListener("click", async () => {
        const picked = await pickImage(guildId);

        if (!picked) return;

        // Eine Adresse geht als Link in den Text, eine Galerie-ID als Anhang.
        if (picked.startsWith("https://")) insertText(`${input.value && !input.value.endsWith(" ") ? " " : ""}${picked}`);
        else if (pictures.length < 10 && !pictures.includes(picked)) pictures.push(picked);

        paintFiles();
    });
    soundButton.addEventListener("click", () => {
        sound = !sound;
        saveSound(sound);
        paintStatus();

        if (sound) chime();
    });
    search.addEventListener("input", () => {
        query = search.value.trim();
        paintList();
    });

    /* ------------------------------------------------------------
       Live
       ------------------------------------------------------------ */
    function onTicket(ticket: ILiveTicket & { closed?: boolean }): void {
        if (ticket.closed) {
            if (current === ticket.id) {
                ended = tickets.get(ticket.id) ?? null;
                current = null;
                panel = null;
                paintPanel();
                paintEmpty();
            }

            tickets.delete(ticket.id);
            unread.delete(ticket.id);
            paintTitle();
            paintList();

            return;
        }

        const known = tickets.has(ticket.id);

        tickets.set(ticket.id, ticket);

        if (!known && sound) chime();

        paintList();

        if (current === ticket.id) paintHead();
    }

    function onMessage(message: ILiveEvent): void {
        const ticket = tickets.get(message.ticketId);

        if (ticket) ticket.lastAt = Math.max(ticket.lastAt, message.at);
        if (message.preview) previews.set(message.ticketId, message.preview);

        if (message.ticketId === current) append(message);

        if (message.ticketId !== current || document.hidden) {
            unread.set(message.ticketId, (unread.get(message.ticketId) ?? 0) + 1);
            paintTitle();
        }

        paintList();
    }

    function onEdit(message: ILiveEvent): void {
        const existing = shadow.getElementById(`m-${message.id}`);

        if (message.ticketId !== current || !existing) return;

        existing.replaceWith(parse(existing.classList.contains("msg--head") ? message.html : message.compact));
    }

    function onRemove(message: { ticketId: number; id: string }): void {
        if (message.ticketId === current) shadow.getElementById(`m-${message.id}`)?.remove();
    }

    // Nach einer Lücke im Stream fehlt, was dazwischen kam - also neu laden.
    async function resync(): Promise<void> {
        const payload = await request<IPayload>(api);

        if (!payload) return;

        data = payload;
        tickets.clear();

        for (const ticket of payload.tickets) tickets.set(ticket.id, ticket);

        paintList();

        if (current !== null && tickets.has(current)) {
            paintHead();
            await loadHistory(current);
        }
    }

    function connect(): void {
        const source = new EventSource(`${api}/stream`);
        const on = <T>(event: string, handle: (value: T) => void): void =>
            source.addEventListener(event, (message) => handle(JSON.parse((message as MessageEvent<string>).data) as T));

        on("ready", () => {
            if (broken) {
                void resync();
                document.dispatchEvent(new CustomEvent("live:transcript"));
            }

            broken = false;
            paintStatus();
        });
        on("transcript", (value: { id: number; number: number }) => document.dispatchEvent(new CustomEvent("live:transcript", { detail: value })));
        on("ticket", onTicket);
        on("message", onMessage);
        on("edit", onEdit);
        on("remove", onRemove);

        source.addEventListener("error", () => {
            broken = true;
            paintStatus();

            // Nach einem 401, 403 oder 429 gibt EventSource auf - dann selbst, in Ruhe.
            if (source.readyState === EventSource.CLOSED) window.setTimeout(connect, 10_000);
        });
    }

    async function start(): Promise<void> {
        baseTitle = document.title;
        host.replaceChildren(list, chat);
        paintStatus();
        paintEmpty();

        const payload = await request<IPayload>(api);

        if (!payload) return;

        data = payload;
        style.textContent = payload.css + EXTRA_CSS;

        for (const ticket of payload.tickets) tickets.set(ticket.id, ticket);

        tools.append(
            emojiPicker({ value: null, emojis: payload.emojis, label: "Emoji einfügen", onPick: (value) => value && insertText(value), insert: true })
        );
        input.placeholder = `Antwort als ${user.name} …`;

        paintList();
        connect();

        // Die Zeiten in der Liste ("vor 3 Min.") altern mit.
        window.setInterval(paintList, 60_000);
    }

    document.addEventListener("visibilitychange", () => {
        if (document.hidden || current === null || !unread.has(current)) return;

        unread.delete(current);
        paintTitle();
        paintList();
    });

    // Auch unter Transcriptions: dann kommen neue Transcripts ohne Neuladen dazu.
    const sections = [section, document.querySelector<HTMLElement>("#transcriptions")].filter((entry): entry is HTMLElement => entry !== null);
    let started = false;
    const begin = (): void => {
        if (started || sections.every((entry) => entry.hidden)) return;

        started = true;
        void start();
    };

    for (const entry of sections) new MutationObserver(begin).observe(entry, { attributes: true, attributeFilter: ["hidden"] });

    begin();
}
