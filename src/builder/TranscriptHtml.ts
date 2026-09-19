/**
 * Ein Transcript als eine HTML-Seite im Discord-Look: Markdown, Erwähnungen,
 * Embeds, Anhänge und Components V2 (Container, Abschnitte, Galerien, Trenner,
 * Dateien, Knöpfe, Menüs). Ohne Skript und ohne fremde Schrift - die Seite
 * funktioniert als Datei genauso wie online.
 *
 * Alles aus einer Nachricht läuft durch Escape(); Links nur mit http(s).
 */

import { APIEmbed } from "discord.js";
import { TIME_ZONE } from "../services/RunnableService";
import { TicketNumber } from "../constants/Tickets";
import { AttachmentKey } from "../constants/Transcripts";
import { ITranscript, ITranscriptFile, ITranscriptMessage, ITranscriptUser } from "../interfaces/services/tickets/ITranscript";

export interface ITranscriptRenderOptions {
    /** Adresse eines gesicherten Anhangs - ein Pfad der Online-Ansicht oder eine data:-URI. */
    file: (stored: string) => string | null;
    /** Nur online: Rückweg ins Dashboard und der Download der Datei. */
    bar?: { back: string; download: string };
    /** In der großen Ansicht im Dashboard: ohne Leiste und Kopf - die stehen dort schon. */
    embed?: boolean;
    /** Live Tickets: die Discord-Links sind frisch - nichts ist "nicht gesichert". */
    live?: boolean;
}

interface IContext {
    transcript: ITranscript;
    options: ITranscriptRenderOptions;
    message: ITranscriptMessage | null;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function Escape(text: string): string {
    return text.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

const LINK = 'target="_blank" rel="noopener noreferrer nofollow"';

// Ein Link nach dem Escapen: & steht dort als &amp;, andere Entities beenden ihn.
const URL_TEXT = "https?:\\/\\/(?:[^\\s\\u0000&<>]|&amp;)+";

const STAMPS: Record<string, Intl.DateTimeFormatOptions> = {
    t: { timeStyle: "short" },
    T: { timeStyle: "medium" },
    d: { dateStyle: "short" },
    D: { dateStyle: "long" },
    f: { dateStyle: "long", timeStyle: "short" },
    F: { dateStyle: "full", timeStyle: "short" },
    // "vor 2 Stunden" wäre in einem Archiv bald falsch - hier steht das Datum.
    R: { dateStyle: "medium", timeStyle: "short" },
};

export function Stamp(ms: number, style = "f"): string {
    const date = new Date(ms);

    if (Number.isNaN(date.getTime())) return "unbekanntes Datum";

    return new Intl.DateTimeFormat("de-DE", { ...(STAMPS[style] ?? STAMPS.f), timeZone: TIME_ZONE }).format(date);
}

export function Duration(ms: number): string {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;

    if (days > 0) return `${days} Tag${days === 1 ? "" : "e"}${hours ? ` ${hours} Std.` : ""}`;
    if (hours > 0) return `${hours} Std.${rest ? ` ${rest} Min.` : ""}`;

    return `${rest} Min.`;
}

function Bytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace(".", ",")} KB`;

    return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function Hex(color: number | null | undefined): string | null {
    return typeof color === "number" && color > 0 ? `#${color.toString(16).padStart(6, "0")}` : null;
}

/** Eine Farbe nur, wenn sie wirklich eine ist - sie landet in einem style-Attribut. */
function SafeColor(value: string | null | undefined): string | null {
    return value && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function SafeUrl(value: unknown): string | null {
    return typeof value === "string" && /^https?:\/\//i.test(value) && URL.canParse(value) ? value : null;
}

// Für url('...') in einem style-Attribut: Anführungszeichen und Klammern beenden sonst die Adresse.
const CSS_URL: Record<string, string> = { "'": "%27", '"': "%22", "(": "%28", ")": "%29", "\\": "%5C", " ": "%20" };

function CssUrl(url: string): string {
    return Escape(url.replace(/['"()\\ ]/g, (character) => CSS_URL[character]));
}

function EmojiImage(id: string, name: string, animated: boolean): string {
    return `<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=48" alt=":${Escape(name)}:" title=":${Escape(name)}:" loading="lazy">`;
}

/* ----------------------------------------------------------
   Markdown
   ---------------------------------------------------------- */
function Restore(text: string, stash: string[]): string {
    let out = text;

    // Ein Link kann ein Emoji enthalten - also mehrmals, bis nichts mehr übrig ist.
    for (let round = 0; round < 4 && out.includes("\u0000"); round++) {
        out = out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => stash[Number(index)] ?? "");
    }

    return out;
}

function Inline(text: string, context: IContext): string {
    const stash: string[] = [];
    const keep = (html: string): string => `\u0000${stash.push(html) - 1}\u0000`;
    const { mentions } = context.transcript;

    // Code zuerst - darin gilt keine andere Regel.
    let out = text.replace(/(``?)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks: string, code: string) =>
        keep(`<code>${Escape(code)}</code>`)
    );

    out = Escape(out)
        .replace(/&lt;(a?):(\w{2,32}):(\d{17,20})&gt;/g, (_, animated: string, name: string, id: string) =>
            keep(EmojiImage(id, name, animated === "a"))
        )
        .replace(/&lt;@!?(\d{17,20})&gt;/g, (_, id: string) =>
            keep(`<span class="mention">@${Escape(mentions.users[id] ?? "unbekannt")}</span>`)
        )
        .replace(/&lt;@&amp;(\d{17,20})&gt;/g, (_, id: string) => {
            const role = mentions.roles[id];
            const color = SafeColor(role?.color);

            return keep(
                `<span class="mention"${color ? ` style="--role:${color}"` : ""}>@${Escape(role?.name ?? "unbekannte Rolle")}</span>`
            );
        })
        .replace(/&lt;#(\d{17,20})&gt;/g, (_, id: string) =>
            keep(`<span class="mention">#${Escape(mentions.channels[id] ?? "unbekannt")}</span>`)
        )
        .replace(/&lt;\/([\w-]{1,32}(?: [\w-]{1,32}){0,2}):\d{17,20}&gt;/g, (_, name: string) =>
            keep(`<span class="mention">/${name}</span>`)
        )
        .replace(/&lt;t:(-?\d{1,13})(?::([tTdDfFR]))?&gt;/g, (_, seconds: string, style?: string) =>
            keep(`<span class="stamp">${Escape(Stamp(Number(seconds) * 1000, style))}</span>`)
        )
        .replace(/(^|[^\w])@(everyone|here)\b/g, (_, before: string, who: string) => `${before}${keep(`<span class="mention">@${who}</span>`)}`)
        .replace(new RegExp(`\\[([^\\]\\n]{1,256})\\]\\((${URL_TEXT})\\)`, "g"), (_, label: string, url: string) =>
            keep(`<a href="${url}" ${LINK}>${label}</a>`)
        )
        .replace(new RegExp(`&lt;(${URL_TEXT})&gt;`, "g"), (_, url: string) => keep(`<a href="${url}" ${LINK}>${url}</a>`))
        .replace(new RegExp(URL_TEXT, "g"), (url: string) => {
            const trail = /[.,:;!?)\]*_~|]+$/.exec(url)?.[0] ?? "";
            const clean = url.slice(0, url.length - trail.length);

            return `${keep(`<a href="${clean}" ${LINK}>${clean}</a>`)}${trail}`;
        })
        .replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler" tabindex="0">$1</span>')
        .replace(/\*\*\*([\s\S]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__([\s\S]+?)__/g, "<u>$1</u>")
        .replace(/\*([^\s*](?:[\s\S]*?[^\s*])?)\*/g, "<em>$1</em>")
        .replace(/(^|[^\w])_([^\s_](?:[\s\S]*?[^\s_])?)_(?!\w)/g, "$1<em>$2</em>")
        .replace(/~~([\s\S]+?)~~/g, "<s>$1</s>");

    return Restore(out, stash);
}

function Blocks(text: string, context: IContext): string {
    if (!text) return "";

    const lines = text.split("\n");
    const out: string[] = [];
    let list: { tag: "ul" | "ol"; items: string[] } | null = null;
    let quote: string[] | null = null;

    const flushList = (): void => {
        if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${item}</li>`).join("")}</${list.tag}>`);

        list = null;
    };

    const flushQuote = (): void => {
        if (quote) out.push(`<blockquote>${Blocks(quote.join("\n"), context)}</blockquote>`);

        quote = null;
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];

        if (line.startsWith(">>> ")) {
            flushList();
            flushQuote();
            out.push(`<blockquote>${Blocks([line.slice(4), ...lines.slice(index + 1)].join("\n"), context)}</blockquote>`);

            return out.join("");
        }

        if (line.startsWith("> ") || line === ">") {
            flushList();
            (quote ??= []).push(line.slice(2));
            continue;
        }

        flushQuote();

        const item = /^\s*([-*]|\d{1,3}\.)\s+(.*)$/.exec(line);

        if (item) {
            const tag = /\d/.test(item[1]) ? "ol" : "ul";

            if (!list || list.tag !== tag) {
                flushList();
                list = { tag, items: [] };
            }

            list.items.push(Inline(item[2], context));
            continue;
        }

        flushList();

        const heading = /^(#{1,3}) (.+)$/.exec(line);

        if (heading) out.push(`<p class="h${heading[1].length}">${Inline(heading[2], context)}</p>`);
        else if (line.startsWith("-# ")) out.push(`<small>${Inline(line.slice(3), context)}</small>`);
        else if (line.trim() === "") out.push("<br>");
        else out.push(`<p>${Inline(line, context)}</p>`);
    }

    flushList();
    flushQuote();

    return out.join("");
}

/** Discord-Markdown als HTML. Codeblöcke zuerst, darin bleibt alles, wie es ist. */
export function Markdown(text: string, context: IContext): string {
    const parts: string[] = [];
    let last = 0;

    for (const match of text.matchAll(/```(?:([\w+-]{1,20})\n)?([\s\S]*?)```/g)) {
        parts.push(Blocks(text.slice(last, match.index), context));
        parts.push(`<pre><code>${Escape(match[2].replace(/^\n+|\n+$/g, ""))}</code></pre>`);
        last = match.index + match[0].length;
    }

    parts.push(Blocks(text.slice(last), context));

    return `<div class="md">${parts.join("")}</div>`;
}

/* ----------------------------------------------------------
   Medien
   ---------------------------------------------------------- */
const VIDEO = /\.(mp4|webm|mov)$/i;
const AUDIO = /\.(mp3|ogg|wav|m4a)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;

/**
 * Wohin ein Medium zeigt: der gesicherte Anhang, sonst die Adresse selbst. Ein
 * Discord-Anhang ohne Sicherung läuft ab - dann steht er trotzdem da, als Link.
 */
function Media(url: string | undefined, context: IContext): string | null {
    if (!url) return null;

    let source = url;

    if (source.startsWith("attachment://")) {
        const name = source.slice("attachment://".length);
        const file = context.message?.files.find((entry) => entry.name === name);

        if (!file) return null;

        source = file.url;
    }

    const key = AttachmentKey(source);
    const stored = key ? context.transcript.media[key] : undefined;

    if (stored) return context.options.file(stored);

    return SafeUrl(source);
}

/** Welche Art ein Medium ist - am gesicherten Namen, sonst an der Adresse. */
function KindOf(url: string, type?: string | null): "image" | "video" | "audio" | "file" {
    if (type?.startsWith("image/")) return "image";
    if (type?.startsWith("video/")) return "video";
    if (type?.startsWith("audio/")) return "audio";

    const path = url.startsWith("data:") ? url.slice(5, url.indexOf(";")) : url.split("?")[0];

    if (IMAGE.test(path) || path.startsWith("image/")) return "image";
    if (VIDEO.test(path) || path.startsWith("video/")) return "video";
    if (AUDIO.test(path) || path.startsWith("audio/")) return "audio";

    return "file";
}

function Visual(url: string, kind: "image" | "video", alt: string, className = ""): string {
    const cls = className ? ` class="${className}"` : "";

    if (kind === "video") return `<video${cls} src="${Escape(url)}" controls preload="metadata"></video>`;

    const image = `<img${cls} src="${Escape(url)}" alt="${Escape(alt)}" loading="lazy">`;

    // Eine data:-URI lässt kein Browser als neuen Tab öffnen - dann ohne Link.
    return url.startsWith("data:") ? image : `<a href="${Escape(url)}" ${LINK}>${image}</a>`;
}

const FILE_ICON =
    '<svg class="file__icon" viewBox="0 0 30 40" aria-hidden="true"><path d="M2 0h18l10 10v28a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z" fill="#5865f2"/><path d="M20 0v8a2 2 0 0 0 2 2h8z" fill="#8a94f7"/></svg>';

/** Ein Discord-Anhang, den der Bot nicht sichern konnte - sein Link läuft bald ab. */
function Unsaved(url: string, context: IContext): boolean {
    if (context.options.live) return false;

    const key = AttachmentKey(url);

    return key !== null && !context.transcript.media[key];
}

function FileCard(file: ITranscriptFile | null, url: string | null, name: string, spoiler = false, unsaved = false): string {
    const label = Escape(name);
    const notes = [file ? Bytes(file.size) : "", unsaved || !url ? "nicht gesichert" : ""].filter(Boolean).join(" · ");
    const title = url ? `<a href="${Escape(url)}" ${LINK} download>${label}</a>` : `<span>${label}</span>`;

    return `<div class="file${spoiler ? " is-spoiler" : ""}">${FILE_ICON}<div><b>${title}</b>${notes ? `<small>${notes}</small>` : ""}</div></div>`;
}

function Attachment(file: ITranscriptFile, context: IContext): string {
    // Ohne Kopie wäre das Bild nach einem Tag ein kaputtes Symbol - lieber ehrlich als Karte.
    if (Unsaved(file.url, context)) return FileCard(file, SafeUrl(file.url), file.name, file.spoiler, true);

    const url = Media(file.url, context);
    const kind = url ? KindOf(url, file.type) : "file";
    const spoiler = file.spoiler ? " is-spoiler" : "";

    if (url && (kind === "image" || kind === "video")) {
        return `<div class="attach__item${spoiler}">${Visual(url, kind, file.description ?? file.name)}</div>`;
    }

    if (url && kind === "audio") {
        return `<div class="attach__item">${FileCard(file, url, file.name)}<audio src="${Escape(url)}" controls preload="none"></audio></div>`;
    }

    return FileCard(file, url, file.name, file.spoiler);
}

/* ----------------------------------------------------------
   Embeds
   ---------------------------------------------------------- */
function Embed(embed: APIEmbed, context: IContext): string {
    const color = Hex(embed.color) ?? "#1e1f22";
    const parts: string[] = [];

    if (embed.author?.name) {
        const icon = SafeUrl(embed.author.proxy_icon_url ?? embed.author.icon_url);
        const url = SafeUrl(embed.author.url);
        const name = Escape(embed.author.name);

        parts.push(
            `<div class="embed__author">${icon ? `<img src="${Escape(icon)}" alt="" loading="lazy">` : ""}${url ? `<a href="${Escape(url)}" ${LINK}>${name}</a>` : name}</div>`
        );
    }

    if (embed.title) {
        const url = SafeUrl(embed.url);
        const title = Inline(embed.title, context);

        parts.push(`<div class="embed__title">${url ? `<a href="${Escape(url)}" ${LINK}>${title}</a>` : title}</div>`);
    }

    if (embed.description) parts.push(`<div class="embed__desc">${Markdown(embed.description, context)}</div>`);

    if (embed.fields?.length) {
        parts.push(
            `<div class="embed__fields">${embed.fields
                .map(
                    (field) =>
                        `<div class="embed__field${field.inline ? " is-inline" : ""}"><b>${Inline(field.name, context)}</b>${Markdown(field.value, context)}</div>`
                )
                .join("")}</div>`
        );
    }

    const image = Media(embed.image?.proxy_url ?? embed.image?.url, context);

    if (image) parts.push(Visual(image, "image", "", "embed__image"));

    if (embed.footer?.text || embed.timestamp) {
        const icon = SafeUrl(embed.footer?.proxy_icon_url ?? embed.footer?.icon_url);
        const text = [embed.footer?.text ? Escape(embed.footer.text) : "", embed.timestamp ? Stamp(Date.parse(embed.timestamp)) : ""]
            .filter(Boolean)
            .join(" • ");

        parts.push(`<div class="embed__footer">${icon ? `<img src="${Escape(icon)}" alt="" loading="lazy">` : ""}${text}</div>`);
    }

    const thumbnail = Media(embed.thumbnail?.proxy_url ?? embed.thumbnail?.url, context);

    return `<div class="embed" style="--c:${color}"><div class="embed__body">${parts.join("")}</div>${thumbnail ? `<img class="embed__thumb" src="${Escape(thumbnail)}" alt="" loading="lazy">` : ""}</div>`;
}

/* ----------------------------------------------------------
   Komponenten - klassische Reihen und Components V2
   ---------------------------------------------------------- */
type Raw = Record<string, unknown>;

function Emoji(raw: unknown): string {
    const emoji = raw as { id?: string | null; name?: string | null; animated?: boolean } | undefined;

    if (!emoji) return "";
    if (emoji.id && /^\d{17,20}$/.test(emoji.id)) return EmojiImage(emoji.id, emoji.name ?? "emoji", Boolean(emoji.animated));

    return emoji.name ? `<span class="uemoji">${Escape(emoji.name)}</span>` : "";
}

function Button(raw: Raw): string {
    const style = Number(raw.style ?? 2);
    const label = typeof raw.label === "string" ? Escape(raw.label) : "";
    const disabled = raw.disabled ? " is-disabled" : "";
    const inner = `${Emoji(raw.emoji)}${label ? `<span>${label}</span>` : ""}`;
    const url = style === 5 ? SafeUrl(raw.url) : null;

    if (url) return `<a class="btn btn--5${disabled}" href="${Escape(url)}" ${LINK}>${inner}<span class="btn__out">↗</span></a>`;

    return `<span class="btn btn--${style}${disabled}">${inner}</span>`;
}

function Select(raw: Raw): string {
    const options = Array.isArray(raw.options) ? (raw.options as Raw[]) : [];
    const chosen = options.find((option) => option.default);
    const placeholder = chosen
        ? `${Emoji(chosen.emoji)}${Escape(String(chosen.label ?? ""))}`
        : Escape(typeof raw.placeholder === "string" ? raw.placeholder : "Auswählen …");
    const box = `<div class="select${raw.disabled ? " is-disabled" : ""}"><span>${placeholder}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg></div>`;

    if (options.length === 0) return box;

    // Im Archiv lässt sich nichts auswählen - aber sehen, was zur Wahl stand.
    return `<details class="choices"><summary>${box}</summary><ul>${options
        .map(
            (option) =>
                `<li>${Emoji(option.emoji)}<span><b>${Escape(String(option.label ?? ""))}</b>${
                    typeof option.description === "string" ? `<small>${Escape(option.description)}</small>` : ""
                }</span></li>`
        )
        .join("")}</ul></details>`;
}

function Gallery(raw: Raw, context: IContext): string {
    const items = (Array.isArray(raw.items) ? (raw.items as Raw[]) : []).slice(0, 10);
    const tiles = items
        .map((item) => {
            const media = item.media as { url?: string; content_type?: string } | undefined;
            const url = Media(media?.url, context);

            if (!url) return "";

            const kind = KindOf(url, media?.content_type);
            const alt = typeof item.description === "string" ? item.description : "";

            return `<div class="gallery__item${item.spoiler ? " is-spoiler" : ""}">${kind === "video" ? Visual(url, "video", alt) : Visual(url, "image", alt)}</div>`;
        })
        .filter(Boolean);

    return tiles.length ? `<div class="gallery gallery--${Math.min(tiles.length, 5)}">${tiles.join("")}</div>` : "";
}

function Component(raw: Raw, context: IContext): string {
    const children = (key = "components"): string =>
        (Array.isArray(raw[key]) ? (raw[key] as Raw[]) : []).map((child) => Component(child, context)).join("");

    switch (Number(raw.type)) {
        case 1:
            return `<div class="row">${children()}</div>`;
        case 2:
            return Button(raw);
        case 3:
        case 5:
        case 6:
        case 7:
        case 8:
            return Select(raw);
        case 9: {
            const accessory = raw.accessory as Raw | undefined;

            return `<div class="section"><div class="section__text">${children()}</div>${
                accessory ? `<div class="section__acc">${Component(accessory, context)}</div>` : ""
            }</div>`;
        }
        case 10:
            return typeof raw.content === "string" ? Markdown(raw.content, context) : "";
        case 11: {
            const media = raw.media as { url?: string } | undefined;
            const url = Media(media?.url, context);

            return url
                ? `<div class="thumb${raw.spoiler ? " is-spoiler" : ""}">${Visual(url, "image", typeof raw.description === "string" ? raw.description : "")}</div>`
                : "";
        }
        case 12:
            return Gallery(raw, context);
        case 13: {
            const reference = (raw.file as { url?: string } | undefined)?.url ?? "";
            const name = reference.startsWith("attachment://") ? reference.slice(13) : (reference.split("?")[0].split("/").pop() ?? "Datei");
            const file = context.message?.files.find((entry) => entry.name === name) ?? null;
            const unsaved = Unsaved(file?.url ?? reference, context);

            return FileCard(file, Media(reference, context), name, Boolean(raw.spoiler), unsaved);
        }
        case 14:
            return `<hr class="sep${Number(raw.spacing) === 2 ? " sep--large" : ""}${raw.divider === false ? " is-blank" : ""}">`;
        case 17: {
            const color = Hex(raw.accent_color as number | null | undefined);

            return `<div class="container${raw.spoiler ? " is-spoiler" : ""}"${color ? ` style="--c:${color}"` : ""}>${children()}</div>`;
        }
        default:
            return "";
    }
}

/* ----------------------------------------------------------
   Nachrichten
   ---------------------------------------------------------- */
function Initials(name: string): string {
    return Escape(
        name
            .split(/\s+/)
            .map((part) => part[0] ?? "")
            .join("")
            .slice(0, 2)
            .toUpperCase() || "?"
    );
}

function Avatar(user: ITranscriptUser, className = "av"): string {
    const url = SafeUrl(user.avatar);

    return `<span class="${className}"${url ? ` style="background-image:url('${CssUrl(url)}')"` : ""} aria-hidden="true">${url ? "" : Initials(user.name)}</span>`;
}

function Name(user: ITranscriptUser): string {
    const color = SafeColor(user.color);

    // Wie Discords BOT-Marke: wer zum Team gehört und wer nicht, auf einen Blick.
    const tag = user.bot
        ? '<span class="tag">BOT</span>'
        : user.team === true
          ? '<span class="tag tag--team">TEAM</span>'
          : user.team === false
            ? '<span class="tag tag--user">USER</span>'
            : "";

    return `<b class="name"${color ? ` style="color:${color}"` : ""} title="${Escape(user.id)}">${Escape(user.name)}</b>${tag}`;
}

// Nur Emojis und höchstens 30 davon - dann zeigt Discord sie groß.
function OnlyEmoji(content: string): boolean {
    const custom = content.match(/<a?:\w{2,32}:\d{17,20}>/g) ?? [];
    const rest = content.replace(/<a?:\w{2,32}:\d{17,20}>/g, "").replace(/\s+/g, "");

    return (
        content.trim().length > 0 &&
        custom.length <= 30 &&
        /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0F|\u200D|\u20E3|[#*0-9])*$/u.test(rest) &&
        !/^[#*0-9]+$/.test(rest)
    );
}

const SYSTEM: Record<number, string> = {
    6: "📌 {name} hat eine Nachricht angepinnt.",
    7: "👋 {name} ist dem Server beigetreten.",
    18: "🧵 {name} hat einen Thread gestartet.",
};

function Reply(message: ITranscriptMessage, context: IContext): string {
    const original = context.transcript.messages.find((entry) => entry.id === message.reply);

    if (!original) {
        const gone = context.options.live ? "Antwort auf eine ältere Nachricht" : "Die Originalnachricht ist nicht mehr da.";

        return `<div class="reply"><span class="reply__gone">${gone}</span></div>`;
    }

    const text = original.content
        ? Escape(original.content.replace(/\s+/g, " ").slice(0, 120))
        : original.files.length || original.components.length || original.embeds.length
          ? "<i>Anhang oder Karte</i>"
          : "";

    return `<a class="reply" href="#m-${original.id}">${Avatar(original.author, "av av--tiny")}${Name(original.author)}<span>${text}</span></a>`;
}

function Message(message: ITranscriptMessage, previous: ITranscriptMessage | null, context: IContext): string {
    const scoped: IContext = { ...context, message };
    const system = SYSTEM[message.type];

    if (system) {
        return `<div class="msg msg--system" id="m-${message.id}"><span class="msg__gutter"></span><div class="system">${system.replace(
            "{name}",
            `<b>${Escape(message.author.name)}</b>`
        )} <time>${Stamp(message.at)}</time></div></div>`;
    }

    // Wie Discord: dieselbe Person innerhalb von sieben Minuten ohne neuen Kopf.
    const grouped =
        previous !== null &&
        !SYSTEM[previous.type] &&
        !message.reply &&
        previous.author.id === message.author.id &&
        previous.author.name === message.author.name &&
        message.at - previous.at < 7 * 60_000;

    const body: string[] = [];

    if (message.content) {
        body.push(OnlyEmoji(message.content) ? `<div class="jumbo">${Markdown(message.content, scoped)}</div>` : Markdown(message.content, scoped));
    }

    if (message.edited) body.push(`<span class="edited" title="${Stamp(message.edited)}">(bearbeitet)</span>`);

    const v2 = message.components.some((component) => [9, 10, 12, 13, 14, 17].includes(Number((component as Raw).type)));
    const components = message.components.map((component) => Component(component as Raw, scoped)).join("");

    if (components) body.push(`<div class="${v2 ? "v2" : "rows"}">${components}</div>`);

    for (const embed of message.embeds) body.push(Embed(embed, scoped));

    // Dateien, die Components V2 schon zeigt, nicht noch einmal darunter.
    const shown = JSON.stringify(message.components);
    const files = message.files.filter((file) => !shown.includes(`attachment://${file.name}`) && !shown.includes(AttachmentKey(file.url) ?? "\u0000"));

    if (files.length) body.push(`<div class="attach">${files.map((file) => Attachment(file, scoped)).join("")}</div>`);

    for (const sticker of message.stickers) {
        const url = SafeUrl(sticker.url);

        body.push(url ? `<img class="sticker" src="${Escape(url)}" alt="${Escape(sticker.name)}" title="${Escape(sticker.name)}" loading="lazy">` : "");
    }

    if (message.reactions.length) {
        body.push(
            `<div class="reactions">${message.reactions
                .map((reaction) => {
                    const custom = /^<(a?):(\w{2,32}):(\d{17,20})>$/.exec(reaction.emoji);
                    const emoji = custom ? EmojiImage(custom[3], custom[2], custom[1] === "a") : `<span class="uemoji">${Escape(reaction.emoji)}</span>`;

                    return `<span class="reaction">${emoji}<b>${reaction.count}</b></span>`;
                })
                .join("")}</div>`
        );
    }

    const head = grouped
        ? `<span class="msg__gutter"><time class="msg__hover">${Stamp(message.at, "t")}</time></span>`
        : `<span class="msg__gutter">${Avatar(message.author)}</span>`;

    const top = grouped ? "" : `<div class="msg__top">${Name(message.author)}<time>${Stamp(message.at)}</time></div>`;
    const reply = message.reply ? Reply(message, scoped) : "";

    return `<div class="msg${grouped ? "" : " msg--head"}" id="m-${message.id}">${reply ? `<span class="msg__gutter"></span>${reply}` : ""}${head}<div class="msg__body">${top}${body.join("")}</div></div>`;
}

/* ----------------------------------------------------------
   Seite
   ---------------------------------------------------------- */
function Fact(label: string, value: string): string {
    return `<div class="fact"><b>${label}</b><span>${value}</span></div>`;
}

function Person(user: ITranscriptUser | null, fallback: string): string {
    return user ? `<span class="person">${Avatar(user, "av av--small")}${Escape(user.name)}</span>` : fallback;
}

export interface ILiveRender {
    id: string;
    html: string;
    /** Dieselbe Nachricht ohne Kopf - wenn davor dieselbe Person schrieb. */
    compact: string;
}

/**
 * Für Live Tickets: Nachrichten einzeln als HTML, gruppiert wie im Transcript.
 * compact ist dieselbe Nachricht ohne Kopf; welche passt, weiß erst das
 * Dashboard, das die Nachricht davor kennt. references: Nachrichten, auf die
 * geantwortet wird, ohne selbst dazuzugehören.
 */
export function RenderLive(
    messages: ITranscriptMessage[],
    mentions: ITranscript["mentions"],
    references: ITranscriptMessage[] = []
): ILiveRender[] {
    // Gebraucht werden hier nur Erwähnungen, Anhänge und die Nachrichten für Antworten.
    const transcript = { mentions, media: {}, messages: [...references, ...messages] } as unknown as ITranscript;
    const context: IContext = { transcript, options: { file: () => null, live: true }, message: null };
    let previous: ITranscriptMessage | null = null;

    return messages.map((message) => {
        const html = Message(message, previous, context);
        const compact = Message(message, { ...message, id: "", type: 0, at: message.at - 1 }, context);

        previous = message;

        return { id: message.id, html, compact };
    });
}

export function RenderTranscript(transcript: ITranscript, options: ITranscriptRenderOptions): string {
    const context: IContext = { transcript, options, message: null };
    const { meta, guild } = transcript;
    const number = TicketNumber(transcript.number, transcript.code);
    const icon = SafeUrl(guild.icon);

    const messages: string[] = [];
    let previous: ITranscriptMessage | null = null;

    for (const message of transcript.messages) {
        messages.push(Message(message, previous, context));
        previous = message;
    }

    const participants = meta.participants
        .slice(0, 12)
        .map((user) => `<span title="${Escape(user.name)}">${Avatar(user, "av av--small")}</span>`)
        .join("");

    const bar = options.bar
        ? `<nav class="bar"><a href="${Escape(options.bar.back)}">← Zurück zum Dashboard</a><a class="bar__dl" href="${Escape(options.bar.download)}">HTML herunterladen</a></nav>`
        : "";

    return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; media-src 'self' https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Ticket ${number} · ${Escape(guild.name)}</title>
<style>${CSS}</style>
</head>
<body>
${options.embed ? "" : bar}
${options.embed ? "" : `<header class="head">
<div class="head__in">
<div class="guild"><span class="guild__icon"${icon ? ` style="background-image:url('${CssUrl(icon)}')"` : ""}>${icon ? "" : Initials(guild.name)}</span><div><h1>Ticket ${number} · ${Escape(meta.option)}</h1><p>${Escape(guild.name)} · #${Escape(transcript.channel.name)} · ${meta.contact === "modmail" ? "ModMail" : "Klassisch"}</p></div></div>
<div class="facts">
${Fact("Ersteller", `${Person(meta.opener, "–")}${meta.openerCode ? ` · U-${Escape(meta.openerCode)}` : ""}`)}
${Fact("Bearbeiter", Person(meta.claimer, "niemand"))}
${Fact("Geschlossen von", Person(meta.closer, "unbekannt"))}
${Fact("Grund", meta.reason ? Escape(meta.reason) : "–")}
${Fact("Geöffnet", Stamp(meta.openedAt))}
${Fact("Geschlossen", Stamp(meta.closedAt))}
${Fact("Dauer", Duration(meta.closedAt - meta.openedAt))}
${Fact("Nachrichten", `${meta.messages} · ${meta.files} ${meta.files === 1 ? "Anhang" : "Anhänge"}`)}
</div>
${participants ? `<div class="people"><b>Beteiligt</b><span>${participants}</span></div>` : ""}
</div>
</header>`}
<main class="log">
${transcript.truncated ? `<p class="note">Das Ticket hatte mehr Nachrichten, als ein Transcript fasst – die ältesten fehlen.</p>` : ""}
${messages.join("\n")}
</main>
<footer class="foot">Transcript von RL Nexus · erstellt ${Stamp(meta.closedAt)} · Anhänge, die der Bot nicht sichern konnte, sind als „nicht gesichert“ markiert.</footer>
</body>
</html>`;
}

const CSS = `
:root{color-scheme:dark;--bg:#313338;--bg2:#2b2d31;--bg3:#1e1f22;--text:#dbdee1;--muted:#949ba4;--head:#f2f3f5;--link:#00a8fc;--line:#3f4147;--mention:#c9cdfb;--mentionbg:rgba(88,101,242,.3);--brand:#ff1e2d}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.375 "gg sans","Noto Sans","Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
.bar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;gap:12px;padding:10px 16px;background:var(--bg3);border-bottom:1px solid #000;font-size:14px;font-weight:600}
.bar a{color:var(--head)}.bar__dl{padding:6px 12px;border-radius:6px;background:var(--brand);color:#fff!important}
.head{background:var(--bg2);border-bottom:1px solid var(--bg3);border-top:3px solid var(--brand)}
.head__in{max-width:1100px;margin:0 auto;padding:24px 16px;display:grid;gap:16px}
.guild{display:flex;align-items:center;gap:14px}
.guild__icon{flex:none;width:52px;height:52px;border-radius:16px;background:#5865f2 center/cover;display:grid;place-items:center;font-weight:700;color:#fff}
.guild h1{margin:0;font-size:22px;line-height:1.2;color:var(--head)}
.guild p{margin:4px 0 0;color:var(--muted);font-size:14px}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.fact{background:var(--bg);border-radius:8px;padding:10px 12px;min-width:0}
.fact b{display:block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.fact span{color:var(--head);font-size:14px;overflow-wrap:anywhere}
.person{display:inline-flex;align-items:center;gap:6px}
.people{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.people span{display:flex;gap:4px;flex-wrap:wrap}
.av{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#5865f2 center/cover no-repeat;color:#fff;font-size:15px;font-weight:600}
.av--small{width:22px;height:22px;font-size:10px}.av--tiny{width:16px;height:16px;font-size:8px}
.log{max-width:1100px;margin:0 auto;padding:12px 0 40px}
.note{margin:8px 16px;padding:10px 12px;border-radius:8px;background:rgba(240,178,50,.12);color:#f0b232;font-size:14px}
.msg{display:grid;grid-template-columns:72px minmax(0,1fr);padding:2px 16px 2px 0}
.msg:hover{background:rgba(0,0,0,.08)}
.msg--head{margin-top:16px}
.msg__gutter{display:flex;justify-content:center;padding-top:2px}
.msg__hover{visibility:hidden;font-size:11px;color:var(--muted);padding-top:3px}
.msg:hover .msg__hover{visibility:visible}
.msg__top{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 8px}
.msg__top time{font-size:12px;color:var(--muted)}
.name{color:var(--head);font-weight:600}
.tag{margin-left:4px;padding:1px 5px;border-radius:4px;background:#5865f2;color:#fff;font-size:10px;font-weight:700;vertical-align:1px}
.tag--team{background:#00afff;color:#04121a}.tag--user{background:#4e5058}
.msg__body{min-width:0;overflow-wrap:anywhere}
.msg--system{margin-top:8px}.system{color:var(--muted);font-size:14px}.system b{color:var(--head)}.system time{font-size:12px;margin-left:4px}
.reply{grid-column:2;display:flex;align-items:center;gap:6px;margin:4px 0 2px;font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden}
.reply span{overflow:hidden;text-overflow:ellipsis}.reply:hover{text-decoration:none;color:var(--text)}
.reply__gone{font-style:italic}
.edited{font-size:11px;color:var(--muted);margin-left:4px}
.md p{margin:0}.md small{display:block;font-size:13px;color:var(--muted)}
.md .h1{font-size:24px;font-weight:700;color:var(--head);margin:8px 0 4px;line-height:1.25}
.md .h2{font-size:20px;font-weight:700;color:var(--head);margin:8px 0 4px;line-height:1.25}
.md .h3{font-size:16px;font-weight:700;color:var(--head);margin:8px 0 4px}
.md ul,.md ol{margin:4px 0;padding-left:24px}
.md blockquote{margin:2px 0;padding:0 0 0 12px;border-left:4px solid #4e5058}
.md strong{color:var(--head)}
code{font-family:Consolas,"Andale Mono WT",Menlo,monospace;font-size:.875em;background:var(--bg3);padding:.15em .3em;border-radius:4px}
pre{margin:6px 0;padding:8px 10px;max-width:100%;overflow-x:auto;background:var(--bg2);border:1px solid var(--bg3);border-radius:6px}
pre code{background:none;padding:0;font-size:14px;white-space:pre}
.mention{padding:0 2px;border-radius:3px;background:var(--mentionbg);color:var(--role,var(--mention));font-weight:500}
.stamp{padding:0 2px;border-radius:3px;background:rgba(255,255,255,.06)}
.spoiler{border-radius:3px;background:var(--bg3);color:transparent;cursor:pointer}
.spoiler:hover,.spoiler:focus{background:rgba(255,255,255,.1);color:inherit;outline:none}
.is-spoiler{filter:blur(24px);transition:filter .2s}.is-spoiler:hover,.is-spoiler:focus-within{filter:none}
.emoji{width:22px;height:22px;object-fit:contain;vertical-align:-5px}
.jumbo .emoji{width:48px;height:48px}.jumbo .uemoji,.jumbo p{font-size:44px;line-height:1.1}
.rows{display:grid;gap:8px;margin-top:6px}
.v2{display:grid;gap:8px;max-width:640px;margin-top:4px}
.container{display:grid;gap:8px;padding:16px;border-radius:8px;background:var(--bg2);border:1px solid rgba(255,255,255,.04);box-shadow:inset 4px 0 0 var(--c,transparent)}
.container[style]{padding-left:20px}
.section{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start}
.section__acc{display:flex;align-items:flex-start}
.thumb img{display:block;width:85px;height:85px;object-fit:cover;border-radius:8px}
.gallery{display:grid;gap:4px;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:170px;border-radius:8px;overflow:hidden;max-width:520px}
.gallery--1{grid-template-columns:1fr;grid-auto-rows:auto}.gallery--3 .gallery__item:first-child{grid-row:span 2}
.gallery--5{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:140px}
.gallery__item{min-height:0;background:var(--bg3)}.gallery__item a{display:block;height:100%}
.gallery img,.gallery video{display:block;width:100%;height:100%;object-fit:cover}
.gallery--1 img,.gallery--1 video{height:auto;max-height:350px;object-fit:contain}
.sep{margin:4px 0;border:0;border-top:1px solid var(--line)}.sep--large{margin:12px 0}.sep.is-blank{border-color:transparent}
.row{display:flex;flex-wrap:wrap;gap:8px}
.btn{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:2px 16px;border-radius:8px;background:#4e5058;color:#fff;font-size:14px;font-weight:500;line-height:1.2}
.btn--1{background:#5865f2}.btn--3{background:#248046}.btn--4{background:#da373c}.btn--6{background:linear-gradient(90deg,#8547c6,#b845c1)}
a.btn:hover{text-decoration:none;filter:brightness(1.1)}.btn__out{opacity:.8}
.btn.is-disabled,.select.is-disabled{opacity:.5}
.btn .emoji{width:18px;height:18px;vertical-align:0}
.select{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px;width:100%;max-width:420px;padding:8px 12px;border-radius:8px;background:var(--bg3);border:1px solid var(--bg3);color:var(--muted);font-size:14px}
.select svg{width:20px;height:20px;flex:none}
.select .emoji{width:18px;height:18px;margin-right:6px}
.choices summary{list-style:none;cursor:pointer}.choices summary::-webkit-details-marker{display:none}
.choices ul{list-style:none;margin:4px 0 0;padding:4px;max-width:420px;border-radius:8px;background:var(--bg3)}
.choices li{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-radius:4px;font-size:14px}
.choices li b{display:block;color:var(--head);font-weight:500}.choices li small{display:block;color:var(--muted)}
.embed{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 16px;max-width:520px;margin-top:4px;padding:8px 16px 16px 12px;border-radius:4px;background:var(--bg2);border-left:4px solid var(--c)}
.embed__author{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:14px;font-weight:600;color:var(--head)}
.embed__author img,.embed__footer img{width:20px;height:20px;border-radius:50%}
.embed__title{margin-top:8px;font-weight:600;color:var(--head)}
.embed__desc{margin-top:8px;font-size:14px}
.embed__fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}
.embed__field{grid-column:1/-1;font-size:14px}.embed__field.is-inline{grid-column:auto}
.embed__field b{display:block;margin-bottom:2px;color:var(--head)}
.embed__image{display:block;max-width:100%;margin-top:16px;border-radius:4px}
.embed__thumb{grid-column:2;grid-row:1;max-width:80px;max-height:80px;margin-top:8px;border-radius:4px}
.embed__footer{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted)}
.attach{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-top:4px}
.attach__item img,.attach__item video{display:block;max-width:min(420px,100%);max-height:350px;border-radius:8px}
.attach__item audio{display:block;margin-top:4px;max-width:420px;width:100%}
.file{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center;width:min(432px,100%);padding:12px;border-radius:8px;background:var(--bg2);border:1px solid var(--bg3)}
.file__icon{width:30px;height:40px}
.file b{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500}
.file small{display:block;color:var(--muted);font-size:12px}
.sticker{display:block;width:160px;height:160px;object-fit:contain;margin-top:4px}
.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.reaction{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:8px;background:var(--bg2);border:1px solid var(--bg3);font-size:14px}
.reaction .emoji{width:16px;height:16px;vertical-align:0}.reaction b{color:var(--muted);font-weight:600}
.foot{max-width:1100px;margin:0 auto;padding:20px 16px 40px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media (max-width:640px){.msg{grid-template-columns:56px minmax(0,1fr);padding-right:8px}.av{width:34px;height:34px}.av--small{width:22px;height:22px}.av--tiny{width:16px;height:16px}.facts{grid-template-columns:repeat(2,minmax(0,1fr))}.embed__fields{grid-template-columns:1fr}.embed__field.is-inline{grid-column:1/-1}.section{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media print{.bar{display:none}body{background:#fff;color:#111}.head,.container,.embed,.file,pre{background:#f4f4f5;color:#111}.msg:hover{background:none}.is-spoiler{filter:none}}
`;

/**
 * Dasselbe Aussehen für den Chat in Live Tickets. Dort steht es in einem Shadow
 * DOM: :root gibt es darin nicht, body und html auch nicht - aus ihnen wird :host.
 */
export const LIVE_CSS = CSS.replace(":root{", ":host{display:block;")
    .replace(/^html\{.*\}$/m, "")
    .replace(/^body\{(.*)\}$/m, ":host{$1}")
    .replace(".log{max-width:1100px;margin:0 auto;padding:12px 0 40px}", ".log{padding:8px 0 12px}");
