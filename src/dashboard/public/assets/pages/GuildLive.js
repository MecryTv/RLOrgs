/**
 * Abschnitt: Live Tickets - offene Tickets mitlesen und direkt antworten.
 *
 * Links die offenen Tickets, rechts der Chat. Neues kommt als Server-Sent
 * Events; EventSource verbindet nach einem Abbruch selbst neu. Die Nachrichten
 * rendert der Bot - dieselbe Darstellung wie im Transcript. Sie stehen in einem
 * Shadow DOM, damit sich Dashboard und Discord-Look nicht die Stile verbiegen.
 *
 * Geladen wird erst, wenn der Abschnitt das erste Mal offen ist; die
 * Verbindung bleibt danach stehen, damit Zähler und Ton weiterlaufen.
 */
import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { failureText } from "../core/Gallery.js";
import { clickSound, tone } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { emojiNode, emojiPicker } from "../layout/EmojiPicker.js";
import { galleryUrl, pickImage } from "../layout/ImagePicker.js";
const PRIORITIES = [
    ["low", "🟢", "Niedrig"],
    ["normal", "🟡", "Normal"],
    ["high", "🔴", "Hoch"],
];
const MAX_FILE = 8 * 1024 * 1024;
// Wie Discord: dieselbe Person innerhalb von sieben Minuten ohne neuen Kopf.
const GROUP_MS = 7 * 60_000;
const SOUND_KEY = "rlnexus.live.sound";
// Was der Chat über das Aussehen des Transcripts hinaus braucht.
const EXTRA_CSS = ".more{display:block;margin:10px auto 2px;padding:7px 14px;border:0;border-radius:6px;background:#2b2d31;color:#dbdee1;font:inherit;font-size:13px;cursor:pointer}" +
    ".more:hover{background:#35373c}.more[hidden]{display:none}.more:focus-visible{outline:2px solid #00afff;outline-offset:2px}";
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
function ago(ms) {
    const minutes = Math.round((Date.now() - ms) / 60_000);
    if (minutes < 1)
        return "gerade";
    if (minutes < 60)
        return `vor ${minutes} Min.`;
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return `vor ${hours} Std.`;
    return new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
function bytes(size) {
    return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
function avatar(person) {
    const box = el("span", "travatar");
    if (person.avatar?.startsWith("https://"))
        box.style.backgroundImage = `url("${person.avatar.replace(/["\\]/g, "")}")`;
    else
        box.textContent = person.name.trim().slice(0, 1).toUpperCase() || "?";
    return box;
}
/**
 * Das HTML kommt vom Bot, und TranscriptHtml escapt jeden Text darin. Trotzdem
 * fliegt raus, was in einer Nachricht nie vorkommt: Skripte, Event-Handler,
 * Links mit fremden Protokollen.
 */
function parse(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const node of template.content.querySelectorAll("script, style, iframe, object, embed, form, link, meta, base"))
        node.remove();
    for (const node of template.content.querySelectorAll("*")) {
        for (const attribute of [...node.attributes]) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim().toLowerCase();
            const foreign = (name === "href" || name === "src") && !/^(https?:|#|\/(?!\/))/.test(value);
            if (name.startsWith("on") || name === "srcdoc" || foreign)
                node.removeAttribute(attribute.name);
        }
    }
    return template.content;
}
function readSound() {
    try {
        return localStorage.getItem(SOUND_KEY) !== "off";
    }
    catch {
        return true;
    }
}
function saveSound(on) {
    try {
        localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    }
    catch {
        // Ohne Speicher gilt der Schalter nur bis zum Neuladen.
    }
}
// Zwei Töne aufwärts - freundlich, aber nicht zu überhören.
function chime() {
    tone(880, 0.12, 0.05, "sine");
    window.setTimeout(() => tone(1175, 0.18, 0.04, "sine"), 120);
}
export function renderLive(guildId, user) {
    const section = need("#live-tickets");
    const host = need("#ltBody");
    const note = need("#ltNote");
    const api = `${BASE}/api/guild/${encodeURIComponent(guildId)}/live`;
    let data = null;
    const tickets = new Map();
    const unread = new Map();
    const previews = new Map();
    const drafts = new Map();
    let current = null;
    // Das Ticket, das gerade offen war, als es geschlossen wurde - für den Hinweis im Chat.
    let ended = null;
    let filter = "all";
    let query = "";
    let sound = readSound();
    let broken = false;
    let baseTitle = document.title;
    // Chat
    let lastAuthor = null;
    let lastAt = 0;
    let oldest = null;
    let pinned = true;
    let follow = 0;
    let fresh = 0;
    let files = [];
    let pictures = [];
    let sending = false;
    let closing = false;
    function warn(text) {
        note.hidden = text === null;
        note.querySelector("span").textContent = text ?? "";
    }
    /* ------------------------------------------------------------
       Gerüst
       ------------------------------------------------------------ */
    const status = el("span", "ltlive", "Verbinde …");
    const soundButton = el("button", "iconbtn", icon("#i-bell"));
    const search = el("input", "text ltsearch");
    const filters = el("div", "seg ltfilter");
    const items = el("div", "ltitems");
    const list = el("aside", "lt__list", el("div", "lt__head", status, soundButton), el("div", "lt__tools", filters, search), items);
    soundButton.type = "button";
    search.type = "search";
    search.placeholder = "Nummer, Name, Thema";
    search.setAttribute("aria-label", "Offene Tickets durchsuchen");
    items.setAttribute("role", "list");
    list.setAttribute("aria-label", "Offene Tickets");
    const head = el("header", "ltchat__head");
    const closeBar = el("div", "ltclose");
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
    const composer = el("div", "ltcompose", chips, el("div", "ltcompose__row", tools, input, sendButton), el("p", "ltcompose__hint", "Enter sendet, Shift+Enter macht eine neue Zeile. In Discord steht dein Name mit „via Dashboard“.", counter));
    const empty = el("div", "ltempty");
    const chat = el("section", "lt__chat", empty, head, closeBar, logHost, freshButton, composer);
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
    closeBar.hidden = true;
    composer.append(fileInput);
    chat.setAttribute("aria-label", "Ticket-Chat");
    /* ------------------------------------------------------------
       Liste
       ------------------------------------------------------------ */
    function paintStatus() {
        status.textContent = broken ? "Verbindung weg – verbinde neu …" : "Live";
        status.classList.toggle("is-off", broken);
        soundButton.setAttribute("aria-pressed", String(sound));
        soundButton.setAttribute("aria-label", sound ? "Ton bei neuen Tickets: an" : "Ton bei neuen Tickets: aus");
        soundButton.title = sound ? "Ton bei neuen Tickets: an" : "Ton bei neuen Tickets: aus";
    }
    function visible() {
        const text = query.toLowerCase().replace("#", "");
        return [...tickets.values()]
            .filter((ticket) => filter === "mine" ? ticket.claimer?.id === data?.me.id : filter === "open" ? ticket.claimer === null : true)
            .filter((ticket) => !text ||
            String(ticket.number).includes(text.replace(/^0+/, "") || "0") ||
            ticket.opener.name.toLowerCase().includes(text) ||
            ticket.opener.id === text ||
            ticket.option.name.toLowerCase().includes(text))
            .sort((a, b) => b.lastAt - a.lastAt);
    }
    function paintFilters() {
        const all = [...tickets.values()];
        const counts = {
            all: all.length,
            mine: all.filter((ticket) => ticket.claimer?.id === data?.me.id).length,
            open: all.filter((ticket) => ticket.claimer === null).length,
        };
        filters.replaceChildren(...[
            ["all", "Alle"],
            ["mine", "Meine"],
            ["open", "Frei"],
        ].map(([value, label]) => {
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
        }));
    }
    function item(ticket) {
        const count = unread.get(ticket.id) ?? 0;
        const button = el("button", `ltitem${ticket.id === current ? " is-on" : ""}${count ? " is-unread" : ""}`);
        const chipsRow = el("span", "ltitem__chips");
        if (ticket.priority) {
            const priority = PRIORITIES.find(([value]) => value === ticket.priority);
            chipsRow.append(el("span", "ltchip", `${priority[1]} ${priority[2]}`));
        }
        chipsRow.append(el("span", `ltchip${ticket.claimer ? " is-claimed" : " is-free"}`, ticket.claimer ? `✅ ${ticket.claimer.name}` : "⏳ frei"));
        if (ticket.status === "frozen")
            chipsRow.append(el("span", "ltchip", "❄️ eingefroren"));
        const preview = previews.get(ticket.id);
        button.type = "button";
        button.setAttribute("role", "listitem");
        button.setAttribute("aria-current", String(ticket.id === current));
        button.append(avatar(ticket.opener), el("span", "ltitem__main", el("span", "ltitem__top", el("b", "", ticketNumber(ticket.number)), el("span", "ltitem__option", ...(ticket.option.emoji ? [emojiNode(ticket.option.emoji, data?.emojis ?? [], "tkemoji")] : []), ticket.option.name)), el("span", "ltitem__who", ticket.opener.name), ...(preview ? [el("span", "ltitem__preview", preview)] : []), chipsRow), el("span", "ltitem__side", el("time", "", ago(ticket.lastAt)), ...(count ? [el("span", "ltitem__badge", String(count))] : [])));
        button.setAttribute("aria-label", `${ticketNumber(ticket.number)} ${ticket.option.name}, ${ticket.opener.name}${count ? `, ${count} neue Nachrichten` : ""}`);
        button.addEventListener("click", () => void select(ticket.id));
        return button;
    }
    function paintList() {
        paintFilters();
        const shown = visible();
        if (shown.length === 0) {
            items.replaceChildren(el("p", "ltitems__empty", tickets.size === 0 ? "Gerade ist kein Ticket offen." : "Kein Ticket passt zu Filter und Suche."));
            return;
        }
        items.replaceChildren(...shown.map(item));
    }
    function paintTitle() {
        const total = [...unread.values()].reduce((sum, count) => sum + count, 0);
        document.title = total ? `(${total}) ${baseTitle}` : baseTitle;
    }
    /* ------------------------------------------------------------
       Chat
       ------------------------------------------------------------ */
    function paintEmpty() {
        empty.replaceChildren(icon(ended ? "#i-archive" : "#i-message"), el("b", "", ended ? `Ticket ${ticketNumber(ended.number)} ist geschlossen.` : "Wähl links ein Ticket."), el("span", "", ended
            ? "Der Verlauf steht gleich unter Transcriptions – sofern der Server Transcripts speichert."
            : "Der Verlauf läuft hier live mit, und du antwortest direkt von hier."));
        empty.hidden = current !== null;
        head.hidden = current === null;
        logHost.hidden = current === null;
        composer.hidden = current === null;
        freshButton.hidden = current === null || fresh === 0;
        closeBar.hidden = current === null || !closing;
    }
    function action(label, className, run) {
        const button = el("button", className, label);
        button.type = "button";
        button.addEventListener("click", () => void run());
        return button;
    }
    function paintHead() {
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
        const title = el("div", "ltchat__title", el("b", "", `${ticketNumber(ticket.number)} · ${ticket.option.name}`), el("span", "", `${ticket.opener.name} · ${ticket.contact === "modmail" ? "ModMail" : "im Server"} · offen ${ago(ticket.createdAt)}${ticket.status === "frozen" ? " · ❄️ eingefroren" : ""}`));
        const actions = el("div", "ltchat__actions");
        if (!ticket.claimer) {
            actions.append(action("Übernehmen", "btn btn--quiet", () => run({ action: "claim" }, "Du bearbeitest das Ticket.")));
        }
        else if (mine || data.me.manage) {
            actions.append(action("Zurückgeben", "btn btn--quiet", () => run({ action: "unclaim" }, "Das Ticket ist wieder frei.")));
        }
        else {
            actions.append(el("span", "ltchip is-claimed", `✅ ${ticket.claimer.name}`));
        }
        if (data.priority) {
            const priority = el("select", "pick ltprio", el("option", "", "Priorität …"));
            priority.firstElementChild.value = "";
            priority.firstElementChild.disabled = true;
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
        actions.append(action("Schließen", "btn btn--quiet is-danger", () => {
            closing = !closing;
            paintClose();
        }));
        head.replaceChildren(back, title, actions);
    }
    function paintClose() {
        closeBar.hidden = !closing || current === null;
        if (closeBar.hidden)
            return;
        const reason = el("input", "text ltclose__reason");
        reason.type = "text";
        reason.maxLength = 300;
        reason.placeholder = "Grund (optional) – steht im Ticket und im Transcript";
        reason.setAttribute("aria-label", "Grund fürs Schließen");
        const confirm = action("Ticket schließen", "btn btn--quiet is-danger is-sure", async () => {
            confirm.disabled = true;
            if (await run({ action: "close", reason: reason.value.trim() }, "Das Ticket wird geschlossen.")) {
                closing = false;
                paintClose();
            }
            else
                confirm.disabled = false;
        });
        const cancel = action("Abbrechen", "btn btn--quiet", () => {
            closing = false;
            paintClose();
        });
        reason.addEventListener("keydown", (event) => {
            if (event.key === "Enter")
                confirm.click();
            if (event.key === "Escape")
                cancel.click();
        });
        closeBar.replaceChildren(icon("#i-warn"), reason, confirm, cancel);
        reason.focus();
    }
    function scrollToBottom() {
        logHost.scrollTop = logHost.scrollHeight;
        fresh = 0;
        freshButton.hidden = true;
    }
    function insert(messages, where) {
        const fragment = document.createDocumentFragment();
        for (const message of messages) {
            if (!shadow.getElementById(`m-${message.id}`))
                fragment.append(parse(message.html));
        }
        if (where === "start")
            log.prepend(fragment);
        else
            log.append(fragment);
        if (messages.length === 0)
            return;
        if (where === "start" || oldest === null)
            oldest = messages[0].id;
        if (where === "end") {
            const last = messages[messages.length - 1];
            lastAuthor = last.author;
            lastAt = last.at;
        }
    }
    function append(message) {
        if (shadow.getElementById(`m-${message.id}`))
            return;
        const grouped = !message.reply && lastAuthor === message.author && message.at - lastAt < GROUP_MS;
        log.append(parse(grouped ? message.compact : message.html));
        lastAuthor = message.author;
        lastAt = message.at;
        if (pinned || Date.now() < follow)
            scrollToBottom();
        else {
            fresh++;
            freshButton.hidden = false;
            freshButton.lastElementChild.textContent = fresh === 1 ? "1 neue Nachricht" : `${fresh} neue Nachrichten`;
        }
    }
    async function request(url, init) {
        try {
            const response = await fetch(url, {
                ...init,
                headers: { Accept: "application/json", ...init?.headers },
            });
            const failure = await failureText(response);
            if (failure !== null) {
                warn(failure);
                return null;
            }
            warn(null);
            return (await response.json().catch(() => ({})));
        }
        catch {
            warn("Der Bot antwortet gerade nicht.");
            return null;
        }
    }
    async function run(body, done) {
        if (current === null)
            return false;
        clickSound("primary");
        const result = await request(`${api}/${current}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (result === null)
            return false;
        toast("info", "Erledigt", done);
        return true;
    }
    async function loadHistory(id) {
        log.replaceChildren();
        moreButton.hidden = true;
        lastAuthor = null;
        lastAt = 0;
        oldest = null;
        fresh = 0;
        const result = await request(`${api}/${id}`);
        if (!result || current !== id)
            return;
        insert(result.messages, "end");
        moreButton.hidden = !result.more;
        scrollToBottom();
    }
    async function select(id) {
        if (current !== null)
            drafts.set(current, input.value);
        current = id;
        ended = null;
        closing = false;
        files = [];
        pictures = [];
        input.value = drafts.get(id) ?? "";
        unread.delete(id);
        host.classList.add("is-chat");
        paintTitle();
        paintList();
        paintHead();
        paintEmpty();
        paintFiles();
        grow();
        await loadHistory(id);
    }
    moreButton.addEventListener("click", async () => {
        if (current === null || !oldest)
            return;
        const id = current;
        const height = logHost.scrollHeight;
        moreButton.disabled = true;
        const result = await request(`${api}/${id}?before=${encodeURIComponent(oldest)}`);
        moreButton.disabled = false;
        if (!result || current !== id)
            return;
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
    function grow() {
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
        counter.textContent = input.value.length > 1800 ? `${input.value.length} / 2000` : "";
    }
    function paintFiles() {
        const entries = [];
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
    function insertText(text) {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`.slice(0, 2000);
        input.focus();
        input.selectionStart = input.selectionEnd = Math.min(start + text.length, input.value.length);
        grow();
    }
    async function upload(id, file) {
        const result = await request(`${api}/${id}/file?name=${encodeURIComponent(file.name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: file,
        });
        return result !== null;
    }
    async function send() {
        if (sending || current === null)
            return;
        const id = current;
        const text = input.value.trim();
        if (!text && files.length === 0 && pictures.length === 0)
            return;
        sending = true;
        sendButton.disabled = true;
        clickSound("primary");
        try {
            // Dateien zuerst, je eine Nachricht - danach der Text mit den Bildern aus der Galerie.
            for (const file of [...files]) {
                if (!(await upload(id, file)))
                    return;
                files = files.filter((entry) => entry !== file);
                paintFiles();
            }
            if (text || pictures.length) {
                const result = await request(`${api}/${id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "send", content: text, gallery: pictures }),
                });
                if (result === null)
                    return;
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
        }
        finally {
            sending = false;
            sendButton.disabled = false;
        }
    }
    input.addEventListener("input", grow);
    input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing)
            return;
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
        if (!picked)
            return;
        // Eine Adresse geht als Link in den Text, eine Galerie-ID als Anhang.
        if (picked.startsWith("https://"))
            insertText(`${input.value && !input.value.endsWith(" ") ? " " : ""}${picked}`);
        else if (pictures.length < 10 && !pictures.includes(picked))
            pictures.push(picked);
        paintFiles();
    });
    soundButton.addEventListener("click", () => {
        sound = !sound;
        saveSound(sound);
        paintStatus();
        if (sound)
            chime();
    });
    search.addEventListener("input", () => {
        query = search.value.trim();
        paintList();
    });
    /* ------------------------------------------------------------
       Live
       ------------------------------------------------------------ */
    function onTicket(ticket) {
        if (ticket.closed) {
            if (current === ticket.id) {
                ended = tickets.get(ticket.id) ?? null;
                current = null;
                closing = false;
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
        if (!known && sound)
            chime();
        paintList();
        if (current === ticket.id)
            paintHead();
    }
    function onMessage(message) {
        const ticket = tickets.get(message.ticketId);
        if (ticket)
            ticket.lastAt = Math.max(ticket.lastAt, message.at);
        if (message.preview)
            previews.set(message.ticketId, message.preview);
        if (message.ticketId === current)
            append(message);
        if (message.ticketId !== current || document.hidden) {
            unread.set(message.ticketId, (unread.get(message.ticketId) ?? 0) + 1);
            paintTitle();
        }
        paintList();
    }
    function onEdit(message) {
        const existing = shadow.getElementById(`m-${message.id}`);
        if (message.ticketId !== current || !existing)
            return;
        existing.replaceWith(parse(existing.classList.contains("msg--head") ? message.html : message.compact));
    }
    function onRemove(message) {
        if (message.ticketId === current)
            shadow.getElementById(`m-${message.id}`)?.remove();
    }
    // Nach einer Lücke im Stream fehlt, was dazwischen kam - also neu laden.
    async function resync() {
        const payload = await request(api);
        if (!payload)
            return;
        data = payload;
        tickets.clear();
        for (const ticket of payload.tickets)
            tickets.set(ticket.id, ticket);
        paintList();
        if (current !== null && tickets.has(current)) {
            paintHead();
            await loadHistory(current);
        }
    }
    function connect() {
        const source = new EventSource(`${api}/stream`);
        const on = (event, handle) => source.addEventListener(event, (message) => handle(JSON.parse(message.data)));
        on("ready", () => {
            if (broken)
                void resync();
            broken = false;
            paintStatus();
        });
        on("ticket", onTicket);
        on("message", onMessage);
        on("edit", onEdit);
        on("remove", onRemove);
        source.addEventListener("error", () => {
            broken = true;
            paintStatus();
            // Nach einem 401, 403 oder 429 gibt EventSource auf - dann selbst, in Ruhe.
            if (source.readyState === EventSource.CLOSED)
                window.setTimeout(connect, 10_000);
        });
    }
    async function start() {
        baseTitle = document.title;
        host.replaceChildren(list, chat);
        paintStatus();
        paintEmpty();
        const payload = await request(api);
        if (!payload)
            return;
        data = payload;
        style.textContent = payload.css + EXTRA_CSS;
        for (const ticket of payload.tickets)
            tickets.set(ticket.id, ticket);
        tools.append(emojiPicker({ value: null, emojis: payload.emojis, label: "Emoji einfügen", onPick: (value) => value && insertText(value), insert: true }));
        input.placeholder = `Antwort als ${user.name} …`;
        paintList();
        connect();
        // Die Zeiten in der Liste ("vor 3 Min.") altern mit.
        window.setInterval(paintList, 60_000);
    }
    document.addEventListener("visibilitychange", () => {
        if (document.hidden || current === null || !unread.has(current))
            return;
        unread.delete(current);
        paintTitle();
        paintList();
    });
    let started = false;
    const begin = () => {
        if (started || section.hidden)
            return;
        started = true;
        void start();
    };
    new MutationObserver(begin).observe(section, { attributes: true, attributeFilter: ["hidden"] });
    begin();
}
