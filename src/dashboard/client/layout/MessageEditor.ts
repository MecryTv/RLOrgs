/**
 * Der Nachrichten-Editor mit Live-Vorschau.
 *
 * Bearbeitet wird ein Dokument aus Bausteinen - dasselbe Format, das der Bot
 * sendet (src/interfaces/builder/IMessageDoc.ts). Die Vorschau zeichnet es im
 * Dashboard-Stil und nicht als Discord-Nachbau: sie soll zeigen, was drinsteht,
 * ohne so zu tun, als wäre sie Discord.
 */

import { icon } from "../core/Dom.js";
import { fill, IMAGE_PLACEHOLDERS, IPlaceholder, PLACEHOLDERS } from "../constants/Placeholders.js";
import { emojiNode, IServerEmoji } from "./EmojiPicker.js";
import { galleryUrl, pickImage } from "./ImagePicker.js";

export type IMessageBlock =
    | { type: "text"; body: string }
    | { type: "image"; images: string[] }
    | { type: "separator"; big?: boolean; line?: boolean }
    | { type: "section"; body: string; thumbnail: string };

export interface IMessageDoc {
    accent?: string;
    blocks: IMessageBlock[];
}

/** Dieselben Kosten wie im Bot (src/builder/MessageDoc.ts). */
const COST: Record<IMessageBlock["type"], number> = { text: 1, image: 1, separator: 1, section: 3 };

const BUDGET = 39;

const BLOCK_LABELS: Record<IMessageBlock["type"], string> = {
    text: "Text",
    image: "Bilder",
    separator: "Trenner",
    section: "Abschnitt mit Bild",
};

export interface IEditorContext {
    guildId: string;
    /** Werte der Platzhalter für die Vorschau. */
    values: Record<string, string>;
    /** Namen für Erwähnungen in der Vorschau. */
    roles?: Map<string, string>;
    channels?: Map<string, string>;
    /** Server-Emojis - damit <:name:id> in der Vorschau als Bild erscheint. */
    emojis?: IServerEmoji[];
    /** structural: der Editor wird neu gezeichnet (Baustein dazu, weg, verschoben). */
    onChange: (structural?: boolean) => void;
    /** Die Platzhalter dieser Nachricht - ohne Angabe die der Tickets. */
    placeholders?: IPlaceholder[];
    /** Was als Bild-Platzhalter angeboten wird - ohne Angabe die der Tickets. */
    imagePlaceholders?: string[];
}

export function docCost(doc: IMessageDoc): number {
    return doc.blocks.reduce((sum, block) => sum + COST[block.type], 0);
}

/* ----------------------------------------------------------
   Editor
   ---------------------------------------------------------- */
// Wohin ein Platzhalter eingesetzt wird: das zuletzt benutzte Textfeld.
let lastArea: HTMLTextAreaElement | null = null;

function area(value: string, onInput: (value: string) => void): HTMLTextAreaElement {
    const field = document.createElement("textarea");

    field.className = "text tkarea";
    field.rows = 4;
    field.value = value;
    field.addEventListener("focus", () => {
        lastArea = field;
    });
    field.addEventListener("input", () => onInput(field.value));

    return field;
}

function chip(label: string, onRemove: () => void): HTMLElement {
    const box = document.createElement("span");

    box.className = "tkchip";

    const text = document.createElement("span");

    text.textContent = label;

    const remove = document.createElement("button");

    remove.type = "button";
    remove.setAttribute("aria-label", `${label} entfernen`);
    remove.append(icon("#i-x"));
    remove.addEventListener("click", onRemove);

    box.append(text, remove);

    return box;
}

function short(source: string): string {
    if (source.startsWith("{")) return source;
    if (source.startsWith("https://")) return source.replace(/^https:\/\//, "").slice(0, 40);

    return source.split("/").slice(1).join("/");
}

function blockCard(doc: IMessageDoc, index: number, context: IEditorContext): HTMLElement {
    const block = doc.blocks[index];
    const card = document.createElement("div");

    card.className = "tkblock";

    const head = document.createElement("div");

    head.className = "tkblock__head";

    const name = document.createElement("b");

    name.textContent = BLOCK_LABELS[block.type];

    const tools = document.createElement("div");

    const move = (delta: number, symbol: string, label: string) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "iconbtn";
        button.title = label;
        button.setAttribute("aria-label", label);
        button.disabled = index + delta < 0 || index + delta >= doc.blocks.length;
        button.append(icon(symbol));
        button.addEventListener("click", () => {
            const [moved] = doc.blocks.splice(index, 1);

            doc.blocks.splice(index + delta, 0, moved);
            context.onChange(true);
        });

        return button;
    };

    const remove = document.createElement("button");

    remove.type = "button";
    remove.className = "iconbtn is-danger";
    remove.title = "Baustein löschen";
    remove.setAttribute("aria-label", "Baustein löschen");
    remove.append(icon("#i-trash"));
    remove.addEventListener("click", () => {
        doc.blocks.splice(index, 1);
        context.onChange(true);
    });

    tools.append(move(-1, "#i-up", "Nach oben"), move(1, "#i-down", "Nach unten"), remove);
    head.append(name, tools);
    card.append(head);

    if (block.type === "text") {
        card.append(area(block.body, (value) => {
            block.body = value;
            context.onChange();
        }));
    }

    if (block.type === "section") {
        card.append(area(block.body, (value) => {
            block.body = value;
            context.onChange();
        }));

        const row = document.createElement("div");

        row.className = "tkchips";

        if (block.thumbnail) {
            row.append(
                chip(short(block.thumbnail), () => {
                    block.thumbnail = "";
                    context.onChange(true);
                })
            );
        }

        const choose = document.createElement("button");

        choose.type = "button";
        choose.className = "btn btn--quiet";
        choose.append(icon("#i-image"), document.createTextNode(block.thumbnail ? "Bild tauschen" : "Bild wählen"));
        choose.addEventListener("click", async () => {
            const source = await pickImage(context.guildId, context.imagePlaceholders ?? IMAGE_PLACEHOLDERS);

            if (!source) return;

            block.thumbnail = source;
            context.onChange(true);
        });

        row.append(choose);
        card.append(row);
    }

    if (block.type === "image") {
        const row = document.createElement("div");

        row.className = "tkchips";

        for (const [position, source] of block.images.entries()) {
            row.append(
                chip(short(source), () => {
                    block.images.splice(position, 1);
                    context.onChange(true);
                })
            );
        }

        const add = document.createElement("button");

        add.type = "button";
        add.className = "btn btn--quiet";
        add.disabled = block.images.length >= 10;
        add.append(icon("#i-plus"), document.createTextNode("Bild hinzufügen"));
        add.addEventListener("click", async () => {
            const source = await pickImage(context.guildId, context.imagePlaceholders ?? IMAGE_PLACEHOLDERS);

            if (!source) return;

            block.images.push(source);
            context.onChange(true);
        });

        row.append(add);
        card.append(row);
    }

    if (block.type === "separator") {
        const row = document.createElement("div");

        row.className = "tkrow";

        const line = toggle("Linie zeigen", block.line !== false, (on) => {
            block.line = on;
            context.onChange();
        });

        const big = toggle("Großer Abstand", block.big === true, (on) => {
            block.big = on;
            context.onChange();
        });

        row.append(line, big);
        card.append(row);
    }

    return card;
}

function toggle(label: string, on: boolean, onChange: (on: boolean) => void): HTMLElement {
    const box = document.createElement("label");

    box.className = "tktoggle";

    const input = document.createElement("input");

    input.type = "checkbox";
    input.className = "switch";
    input.checked = on;
    input.addEventListener("change", () => onChange(input.checked));

    const text = document.createElement("span");

    text.textContent = label;
    box.append(input, text);

    return box;
}

/** Zeichnet den Editor neu. Der Aufrufer hält das Dokument und ruft nach jeder Änderung. */
export function renderEditor(host: HTMLElement, doc: IMessageDoc, context: IEditorContext): void {
    const bar = document.createElement("div");

    bar.className = "tktools";

    const color = document.createElement("input");

    color.type = "color";
    color.className = "tkcolor";
    color.value = doc.accent ?? "#ff1e2d";
    color.title = "Farbe des Balkens";
    color.setAttribute("aria-label", "Akzentfarbe");
    color.addEventListener("input", () => {
        doc.accent = color.value;
        context.onChange();
    });

    const placeholders = document.createElement("select");

    placeholders.className = "pick";
    placeholders.setAttribute("aria-label", "Platzhalter einfügen");

    const first = document.createElement("option");

    first.textContent = "Platzhalter einfügen …";
    first.value = "";
    placeholders.append(first);

    for (const entry of context.placeholders ?? PLACEHOLDERS) {
        const option = document.createElement("option");

        option.value = `{${entry.key}}`;
        option.textContent = `${entry.label} · {${entry.key}}`;
        placeholders.append(option);
    }

    placeholders.addEventListener("change", () => {
        const value = placeholders.value;

        placeholders.value = "";

        if (!value || !lastArea) return;

        const start = lastArea.selectionStart ?? lastArea.value.length;
        const end = lastArea.selectionEnd ?? start;

        lastArea.value = `${lastArea.value.slice(0, start)}${value}${lastArea.value.slice(end)}`;
        lastArea.dispatchEvent(new Event("input"));
        lastArea.focus();
        lastArea.setSelectionRange(start + value.length, start + value.length);
    });

    bar.append(color, placeholders);

    for (const [type, label] of Object.entries(BLOCK_LABELS) as [IMessageBlock["type"], string][]) {
        const add = document.createElement("button");

        add.type = "button";
        add.className = "btn btn--quiet";
        add.append(icon("#i-plus"), document.createTextNode(label));
        add.addEventListener("click", () => {
            const fresh: IMessageBlock =
                type === "text"
                    ? { type: "text", body: "" }
                    : type === "image"
                      ? { type: "image", images: [] }
                      : type === "separator"
                        ? { type: "separator", line: true }
                        : { type: "section", body: "", thumbnail: "" };

            doc.blocks.push(fresh);
            context.onChange(true);
        });

        bar.append(add);
    }

    const list = document.createElement("div");

    list.className = "tkblocks";

    for (let index = 0; index < doc.blocks.length; index++) list.append(blockCard(doc, index, context));

    if (doc.blocks.length === 0) {
        const empty = document.createElement("p");

        empty.className = "hintline";
        empty.textContent = "Noch kein Baustein – ohne Text bleibt die Nachricht leer.";
        list.append(empty);
    }

    const cost = document.createElement("p");
    const used = docCost(doc);

    cost.className = "hintline";
    cost.textContent = `${used} von ${BUDGET} Bausteinen belegt${used > BUDGET - 6 ? " – für Knöpfe und Menü sollte Platz bleiben." : "."}`;

    host.replaceChildren(bar, list, cost);
}

/* ----------------------------------------------------------
   Vorschau
   ---------------------------------------------------------- */
const INLINE = /(\*\*.+?\*\*|__.+?__|\*.+?\*|~~.+?~~|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|<a?:\w{2,32}:\d{17,20}>|<@&?\d+>|<#\d+>|<t:\d+(?::[tTdDfFR])?>)/g;

function mention(token: string, context: IEditorContext): HTMLElement {
    const pill = document.createElement("span");

    pill.className = "tkmention";

    if (token.startsWith("<@&")) {
        const id = token.slice(3, -1);

        pill.textContent = `@${context.roles?.get(id) ?? "Rolle"}`;
    } else if (token.startsWith("<@")) {
        const id = token.slice(2, -1);

        pill.textContent = `@${context.values["user.name"] && id === context.values["user.id"] ? context.values["user.name"] : "User"}`;
    } else {
        const id = token.slice(2, -1);

        pill.textContent = `#${context.channels?.get(id) ?? "kanal"}`;
    }

    return pill;
}

function inline(text: string, host: HTMLElement, context: IEditorContext): void {
    for (const part of text.split(INLINE)) {
        if (!part) continue;

        if (/^<a?:\w{2,32}:\d{17,20}>$/.test(part)) {
            host.append(emojiNode(part, context.emojis ?? [], "tkemoji"));
            continue;
        }

        if (part.startsWith("<@") || part.startsWith("<#")) {
            host.append(mention(part, context));
            continue;
        }

        if (part.startsWith("<t:")) {
            const seconds = Number(part.slice(3).split(":")[0]);
            const stamp = document.createElement("span");

            stamp.className = "tkmention";
            stamp.textContent = new Date(seconds * 1000).toLocaleString("de-DE");
            host.append(stamp);
            continue;
        }

        const wrap = (tag: string, inner: string) => {
            const element = document.createElement(tag);

            inline(inner, element, context);
            host.append(element);
        };

        if (part.startsWith("**") && part.endsWith("**")) wrap("strong", part.slice(2, -2));
        else if (part.startsWith("__") && part.endsWith("__")) wrap("u", part.slice(2, -2));
        else if (part.startsWith("*") && part.endsWith("*")) wrap("em", part.slice(1, -1));
        else if (part.startsWith("~~") && part.endsWith("~~")) wrap("s", part.slice(2, -2));
        else if (part.startsWith("`") && part.endsWith("`")) {
            const code = document.createElement("code");

            code.textContent = part.slice(1, -1);
            host.append(code);
        } else if (part.startsWith("[")) {
            const label = part.slice(1, part.indexOf("]"));
            const link = document.createElement("span");

            link.className = "tklink";
            link.textContent = label;
            host.append(link);
        } else host.append(document.createTextNode(part));
    }
}

function markdown(text: string, context: IEditorContext): DocumentFragment {
    const fragment = document.createDocumentFragment();
    let list: HTMLUListElement | null = null;

    for (const raw of text.split("\n")) {
        const line = raw.trimEnd();

        if (/^[-*] /.test(line)) {
            list ??= document.createElement("ul");

            const item = document.createElement("li");

            inline(line.slice(2), item, context);
            list.append(item);

            if (!list.parentNode) fragment.append(list);

            continue;
        }

        list = null;

        if (!line) continue;

        const heading = /^(#{1,3}) /.exec(line);
        const element = document.createElement(
            line.startsWith("-# ") ? "small" : heading ? `h${Math.min(Number(heading[1].length) + 1, 4)}` : "p"
        );

        element.className = line.startsWith("-# ") ? "tkprev__small" : "tkprev__line";
        inline(line.replace(/^(#{1,3}|-#) /, ""), element, context);
        fragment.append(element);
    }

    return fragment;
}

function image(source: string, context: IEditorContext, className: string): HTMLElement {
    const filled = source.startsWith("{") ? fill(source, context.values) : source;
    const url = filled.startsWith("https://") ? filled : galleryUrl(context.guildId, filled);

    if (!url) {
        const missing = document.createElement("span");

        missing.className = "tkmissing";
        missing.textContent = source.startsWith("{") ? source : "Bild nicht gefunden";

        return missing;
    }

    const picture = document.createElement("img");

    picture.className = className;
    picture.loading = "lazy";
    picture.alt = "";
    picture.src = url;

    return picture;
}

/** Zeichnet die Vorschau. extra hängt darunter, etwa das Aktions-Menü. */
export function renderPreview(host: HTMLElement, doc: IMessageDoc, context: IEditorContext, extra?: Node): void {
    const card = document.createElement("div");

    card.className = "tkprev";
    card.style.setProperty("--accent", doc.accent ?? "#4b5563");

    for (const block of doc.blocks) {
        if (block.type === "text") {
            const body = document.createElement("div");

            body.append(markdown(fill(block.body, context.values), context));
            card.append(body);
        }

        if (block.type === "separator") {
            const line = document.createElement("div");

            line.className = `tkprev__sep${block.big ? " is-big" : ""}${block.line === false ? " is-blank" : ""}`;
            card.append(line);
        }

        if (block.type === "image") {
            const grid = document.createElement("div");

            grid.className = "tkprev__gallery";

            for (const source of block.images) grid.append(image(source, context, "tkprev__image"));

            card.append(grid);
        }

        if (block.type === "section") {
            const section = document.createElement("div");

            section.className = "tkprev__section";

            const body = document.createElement("div");

            body.append(markdown(fill(block.body, context.values), context));
            section.append(body, image(block.thumbnail, context, "tkprev__thumb"));
            card.append(section);
        }
    }

    if (doc.blocks.length === 0) {
        const empty = document.createElement("p");

        empty.className = "hintline";
        empty.textContent = "Leere Nachricht – der Bot schickt dann nur einen kurzen Platzhalter.";
        card.append(empty);
    }

    if (extra) card.append(extra);

    host.replaceChildren(card);
}
