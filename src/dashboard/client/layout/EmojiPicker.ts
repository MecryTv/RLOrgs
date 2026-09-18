/**
 * Emoji-Auswahl mit Bildern: die Emojis des Servers so, wie Discord sie zeigt,
 * dazu gängige Standard-Emojis und ein Feld für jedes andere.
 *
 * Ein natives Popover (popover="auto"): Klick daneben und Escape schließen es
 * vom Browser aus. Gespeichert wird, was der Bot erwartet - "🎫" oder "<:name:id>".
 */

import { icon } from "../core/Dom.js";

export interface IServerEmoji {
    id: string;
    name: string;
    animated: boolean;
    url: string;
}

// Emoji und Suchwörter - was auf einem Ticket-Panel vorkommt.
const STANDARD: [string, string][] = [
    ["🎫", "ticket support"], ["📩", "nachricht eingang"], ["📬", "dm post briefkasten"], ["💬", "chat sprechblase frage"],
    ["❓", "frage hilfe"], ["❗", "wichtig ausrufezeichen"], ["🆘", "hilfe notfall sos"], ["🙋", "melden frage hand"],
    ["🛠️", "technik werkzeug"], ["⚙️", "einstellungen zahnrad"], ["🔧", "werkzeug fix"], ["🐛", "bug fehler"],
    ["🚨", "alarm meldung report"], ["⚠️", "warnung"], ["🛡️", "schutz moderation"], ["🚫", "verboten sperre"],
    ["🔒", "schloss privat"], ["🔑", "schlüssel zugang"], ["📝", "bewerbung notiz formular"], ["📋", "liste klemmbrett"],
    ["📄", "dokument seite"], ["📌", "pin wichtig"], ["📎", "anhang"], ["📅", "termin kalender"],
    ["⏰", "wecker zeit"], ["⏱️", "zeit stoppuhr"], ["✅", "haken erledigt ok"], ["❌", "kreuz nein"],
    ["⭐", "stern"], ["🌟", "stern glanz"], ["💎", "premium diamant"], ["👑", "krone vip"],
    ["🏆", "pokal turnier"], ["🥇", "gold erster sieg"], ["🎮", "spiel gaming controller"], ["🕹️", "joystick"],
    ["⚽", "fußball ball"], ["🚗", "auto rocket league"], ["🏎️", "rennwagen"], ["🔥", "feuer"],
    ["⚡", "blitz schnell"], ["💡", "idee vorschlag"], ["🎉", "feier event party"], ["🎁", "geschenk gewinnspiel"],
    ["🤝", "partner kooperation"], ["💼", "business job"], ["💰", "geld zahlung"], ["💳", "karte zahlung kauf"],
    ["🛒", "shop kauf"], ["📢", "ankündigung"], ["📣", "megafon"], ["👥", "team gruppe"],
    ["👤", "person user"], ["🤖", "bot"], ["🎥", "video stream"], ["📺", "stream tv"],
    ["🎵", "musik"], ["🌐", "web internet"], ["🔗", "link"], ["🧾", "rechnung"],
    ["📦", "paket lieferung"], ["🗳️", "abstimmung wahl"], ["⚖️", "recht beschwerde"], ["🧹", "aufräumen"],
    ["❤️", "herz rot"], ["💙", "herz blau"], ["💚", "herz grün"], ["💜", "herz lila"],
    ["🟢", "grün punkt"], ["🟡", "gelb punkt"], ["🔴", "rot punkt"], ["🔵", "blau punkt"],
];

const CUSTOM = /^<(a?):(\w{2,32}):(\d{17,20})>$/;

/** Die Adresse eines Server-Emojis - aus der Liste des Servers, sonst vom CDN. */
function emojiUrl(id: string, animated: boolean, emojis: IServerEmoji[]): string {
    return emojis.find((entry) => entry.id === id)?.url || `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=64`;
}

/** Ein Emoji zum Anzeigen: Bild für Server-Emojis, sonst das Zeichen selbst. */
export function emojiNode(value: string | null, emojis: IServerEmoji[], className = "emojiimg"): Node {
    const custom = value ? CUSTOM.exec(value) : null;

    if (custom) {
        const image = document.createElement("img");

        image.className = className;
        image.src = emojiUrl(custom[3], custom[1] === "a", emojis);
        image.alt = `:${custom[2]}:`;
        image.title = `:${custom[2]}:`;
        image.loading = "lazy";
        image.decoding = "async";

        return image;
    }

    const text = document.createElement("span");

    text.className = "emojichar";
    text.textContent = value ?? "";

    return text;
}

function labelOf(value: string | null): string {
    const custom = value ? CUSTOM.exec(value) : null;

    return custom ? `:${custom[2]}:` : (value ?? "keins");
}

// Ein Popover für die ganze Seite - es wandert zum Knopf, der es öffnet.
let pop: HTMLDivElement | null = null;
let anchor: HTMLElement | null = null;

function popover(): HTMLDivElement {
    if (pop) return pop;

    const panel = document.createElement("div");

    panel.className = "emojipop";
    panel.popover = "auto";
    panel.tabIndex = -1;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Emoji wählen");
    document.body.append(panel);

    // Es liegt fest im Fenster - beim Scrollen wandert es mit seinem Knopf mit.
    // Schließen wäre auf dem Handy falsch: die Tastatur scrollt dort beim Tippen.
    const follow = (): void => {
        if (anchor && panel.matches(":popover-open")) place(panel, anchor);
    };

    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow);

    // Escape oder Klick daneben: der Fokus gehört zurück an den Knopf, nicht ins Nichts.
    panel.addEventListener("toggle", (event) => {
        const closed = (event as Event & { newState?: string }).newState === "closed";

        if (closed && (document.activeElement === document.body || panel.contains(document.activeElement))) anchor?.focus();
    });

    pop = panel;

    return panel;
}

/** Unter den Knopf, bei zu wenig Platz darüber - nie aus dem Fenster heraus. */
function place(panel: HTMLElement, anchor: HTMLElement): void {
    const box = anchor.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const height = panel.offsetHeight;
    const below = box.bottom + 8;
    const top = below + height > window.innerHeight - 8 && box.top - 8 - height > 8 ? box.top - 8 - height : below;

    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, top)}px`;
}

/** Pfeiltasten im Raster: links, rechts und eine Zeile hoch oder runter. */
function arrows(grid: HTMLElement): void {
    grid.addEventListener("keydown", (event) => {
        const cells = [...grid.querySelectorAll<HTMLButtonElement>("button")];
        const index = cells.indexOf(document.activeElement as HTMLButtonElement);

        if (index < 0) return;

        const columns = Math.max(1, Math.round(grid.clientWidth / (cells[0]?.offsetWidth || 44)));
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];

        if (step === undefined) return;

        event.preventDefault();
        cells[Math.max(0, Math.min(cells.length - 1, index + step))]?.focus();
    });
}

export interface IEmojiPickerOptions {
    value: string | null;
    emojis: IServerEmoji[];
    /** Wofür das Emoji ist - für Vorleser: "Emoji für Support". */
    label: string;
    onPick: (value: string | null) => void;
}

/** Der Knopf mit dem gewählten Emoji. Ein Klick öffnet die Auswahl. */
export function emojiPicker(options: IEmojiPickerOptions): HTMLButtonElement {
    let value = options.value;
    const button = document.createElement("button");

    button.type = "button";
    button.className = "emojibtn";
    button.setAttribute("aria-haspopup", "dialog");

    function show(): void {
        button.replaceChildren(value ? emojiNode(value, options.emojis) : icon("#i-smile"));
        button.setAttribute("aria-label", `${options.label}: ${labelOf(value)} – ändern`);
        button.title = value ? `${labelOf(value)} – ändern` : "Emoji wählen";
    }

    function choose(next: string | null): void {
        value = next;
        show();
        options.onPick(next);
        pop?.hidePopover();
        button.focus();
    }

    button.addEventListener("click", () => {
        const panel = popover();

        if (panel.matches(":popover-open") && panel.dataset.owner === button.dataset.owner) {
            panel.hidePopover();

            return;
        }

        button.dataset.owner ??= String(Math.random());
        panel.dataset.owner = button.dataset.owner;
        anchor = button;
        panel.replaceChildren(...content(options.emojis, value, choose));
        panel.showPopover();
        place(panel, button);

        // Mit Maus direkt ins Suchfeld; auf dem Handy nicht - sonst springt die Tastatur auf.
        if (matchMedia("(pointer: fine)").matches) panel.querySelector<HTMLInputElement>("input")?.focus();
        else panel.focus();
    });

    show();

    return button;
}

function content(emojis: IServerEmoji[], current: string | null, choose: (value: string | null) => void): HTMLElement[] {
    let mode: "server" | "standard" = emojis.length > 0 ? "server" : "standard";

    const search = document.createElement("input");

    search.type = "search";
    search.className = "text emojipop__search";
    search.placeholder = "Emoji suchen …";
    search.setAttribute("aria-label", "Emoji suchen");

    const tabs = document.createElement("div");

    tabs.className = "seg emojipop__tabs";
    tabs.setAttribute("role", "group");
    tabs.hidden = emojis.length === 0;

    const grid = document.createElement("div");

    grid.className = "emojigrid";
    arrows(grid);

    const empty = document.createElement("p");

    empty.className = "emojipop__empty";

    function cell(value: string, name: string, node: Node): HTMLButtonElement {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "emojicell";
        button.title = name;
        button.setAttribute("aria-label", name);
        button.setAttribute("aria-pressed", String(value === current));
        button.append(node);
        button.addEventListener("click", () => choose(value));

        return button;
    }

    function paint(): void {
        const query = search.value.trim().toLowerCase().replace(/:/g, "");

        for (const tab of tabs.querySelectorAll("button")) tab.setAttribute("aria-pressed", String(tab.dataset.mode === mode));

        const cells =
            mode === "server"
                ? emojis
                      .filter((entry) => !query || entry.name.toLowerCase().includes(query))
                      .map((entry) => {
                          const value = `<${entry.animated ? "a" : ""}:${entry.name}:${entry.id}>`;

                          return cell(value, `:${entry.name}:`, emojiNode(value, emojis));
                      })
                : STANDARD.filter(([emoji, words]) => !query || words.includes(query) || emoji === query).map(([emoji, words]) =>
                      cell(emoji, words.split(" ")[0], emojiNode(emoji, emojis))
                  );

        grid.replaceChildren(...cells);
        empty.hidden = cells.length > 0;
        empty.textContent =
            mode === "server" ? "Kein Server-Emoji mit diesem Namen – schau unter Standard." : "Nichts gefunden – füg unten ein eigenes Emoji ein.";
    }

    for (const [key, label] of [
        ["server", `Server (${emojis.length})`],
        ["standard", "Standard"],
    ] as const) {
        const tab = document.createElement("button");

        tab.type = "button";
        tab.dataset.mode = key;
        tab.textContent = label;
        tab.addEventListener("click", () => {
            mode = key;
            paint();
        });
        tabs.append(tab);
    }

    search.addEventListener("input", paint);
    search.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown") return;

        event.preventDefault();
        grid.querySelector<HTMLButtonElement>("button")?.focus();
    });

    // Jedes andere Unicode-Emoji: einfügen und übernehmen. Der Bot prüft es beim Speichern.
    const own = document.createElement("input");

    own.type = "text";
    own.className = "text emojipop__own";
    own.maxLength = 16;
    own.placeholder = "Anderes Emoji einfügen";
    own.setAttribute("aria-label", "Anderes Emoji einfügen");

    const take = document.createElement("button");

    take.type = "button";
    take.className = "btn btn--quiet emojipop__take";
    take.textContent = "Übernehmen";
    take.addEventListener("click", () => {
        const text = own.value.trim();

        if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)) choose(text);
        else own.focus();
    });
    own.addEventListener("keydown", (event) => {
        if (event.key === "Enter") take.click();
    });

    const none = document.createElement("button");

    none.type = "button";
    none.className = "emojipop__none";
    none.append(icon("#i-x"), document.createTextNode("Ohne Emoji"));
    none.addEventListener("click", () => choose(null));

    const foot = document.createElement("div");

    foot.className = "emojipop__foot";
    foot.append(own, take, none);

    paint();

    return [search, tabs, grid, empty, foot];
}
