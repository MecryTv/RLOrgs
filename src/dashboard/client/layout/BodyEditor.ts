/**
 * Der Inhalts-Editor: Art wählen, Inhalt bauen, Vorschau daneben.
 *
 * Dieselbe Sache für Custom Message (Nachrichten und Stichwörter) und für das
 * Welcome System. Drei Arten kennt er selbst - Karte im Components-V2-Stil,
 * Embed und normale Nachricht. Eine vierte darf die Seite mitbringen: die
 * gezeichnete Begrüßungskarte baut ihr Formular und ihre Vorschau selbst.
 */

import { icon } from "../core/Dom.js";
import { fill } from "../constants/Placeholders.js";
import { button, el, row, select, toggle } from "../core/Ui.js";
import { IEditorContext, IMessageDoc, renderEditor, renderPreview } from "./MessageEditor.js";

export interface IEmbed {
    title: string | null;
    description: string | null;
    color: string | null;
    url: string | null;
    image: string | null;
    thumbnail: string | null;
    author: { name: string; icon: string | null } | null;
    footer: { text: string; icon: string | null } | null;
    timestamp: boolean;
    fields: { name: string; value: string; inline: boolean }[];
}

/** Was jede Nachricht gemeinsam hat. */
export interface IBody {
    kind: string;
    content: string;
    embed: IEmbed | null;
    doc: IMessageDoc;
}

export interface IBodyOptions {
    /** Die Arten zur Auswahl: Wert und Beschriftung. */
    kinds: Record<string, string>;
    /** Der Editor-Zusammenhang (Platzhalter, Rollen, Kanäle, Emojis). */
    context: () => IEditorContext;
    /** Eine leere Vorlage für ein neues Embed. */
    defaultEmbed: () => IEmbed;
    /** Etwas hat sich geändert. */
    touch: () => void;
    /** Was unter der Vorschau noch steht - etwa die Knöpfe. */
    extras?: () => Node | null;
    /** Eine eigene Art mit eigenem Formular und eigener Vorschau. */
    custom?: { kind: string; form: (refresh: () => void) => HTMLElement; preview: () => Node | null };
    /** Überschrift über dem Editor. */
    title?: string;
    /** Was unter dem Auswahlfeld steht. */
    hint?: string;
}

export interface IBodyEditor {
    node: HTMLElement;
    /** Zeichnet nur die Vorschau neu. */
    refresh: () => void;
    /** Zeichnet Formular und Vorschau neu - nach einem Wechsel der Art. */
    redraw: () => void;
}

/** Die Felder eines Embeds - Name, Wert, nebeneinander. */
function fieldList(embed: IEmbed, touch: () => void, refresh: () => void): HTMLElement {
    const box = el("div", "cmfields");
    const draw = (): void => {
        box.replaceChildren();

        for (const field of embed.fields) {
            const name = el("input", "text cmfield__name");
            const value = el("input", "text");
            const remove = button("btn btn--quiet btn--icon", icon("#i-x"));

            name.type = "text";
            name.value = field.name;
            name.maxLength = 256;
            name.placeholder = "Name";
            name.setAttribute("aria-label", "Name des Feldes");
            name.addEventListener("input", () => {
                field.name = name.value;
                touch();
                refresh();
            });

            value.type = "text";
            value.value = field.value;
            value.maxLength = 1024;
            value.placeholder = "Wert";
            value.setAttribute("aria-label", "Wert des Feldes");
            value.addEventListener("input", () => {
                field.value = value.value;
                touch();
                refresh();
            });

            remove.title = "Feld entfernen";
            remove.addEventListener("click", () => {
                embed.fields.splice(embed.fields.indexOf(field), 1);
                touch();
                draw();
                refresh();
            });

            box.append(
                el(
                    "div",
                    "cmfield",
                    name,
                    value,
                    el("label", "snitem__switch", toggle(field.inline, "Nebeneinander", (on) => {
                        field.inline = on;
                        touch();
                        refresh();
                    }), el("span", "", "nebeneinander")),
                    remove
                )
            );
        }

        const add = button("btn btn--quiet", icon("#i-plus"), "Feld hinzufügen");

        add.disabled = embed.fields.length >= 10;
        add.addEventListener("click", () => {
            embed.fields.push({ name: "Feld", value: "Wert", inline: false });
            touch();
            draw();
            refresh();
        });

        box.append(add);
    };

    draw();

    return row("Felder", "Bis zu zehn – gut für Listen", box);
}

/** Das Embed, wie Discord es zeigt. */
export function embedPreview(embed: IEmbed, values: Record<string, string> = {}): HTMLElement {
    const box = el("div", "cmembed");
    const text = (value: string): string => fill(value, values);

    box.style.setProperty("--embed", embed.color ?? "#00afff");

    if (embed.author?.name) box.append(el("div", "cmembed__author", text(embed.author.name)));
    if (embed.title) box.append(el("div", "cmembed__title", text(embed.title)));
    if (embed.description) box.append(el("div", "cmembed__text", text(embed.description)));

    if (embed.fields.length) {
        const grid = el("div", "cmembed__fields");

        for (const field of embed.fields) {
            grid.append(el("div", `cmembed__field${field.inline ? " is-inline" : ""}`, el("b", "", text(field.name)), el("span", "", text(field.value))));
        }

        box.append(grid);
    }

    if (embed.image) {
        const image = el("img", "cmembed__image");

        image.src = embed.image;
        image.alt = "";
        box.append(image);
    }

    if (embed.footer?.text || embed.timestamp) {
        box.append(el("div", "cmembed__footer", [embed.footer?.text ? text(embed.footer.text) : null, embed.timestamp ? "heute um 20:00" : null].filter(Boolean).join(" · ")));
    }

    return box;
}

export function bodyEditor(entry: IBody, options: IBodyOptions): IBodyEditor {
    const { context, touch } = options;
    const editorHost = el("div", "");
    const fields = el("div", "cmembed__form");
    const preview = el("div", "tkprev");
    const extra = (): Node | null => options.extras?.() ?? null;

    const paintPreview = (): void => {
        if (entry.kind === options.custom?.kind) {
            const own = options.custom.preview();

            preview.replaceChildren(...(own ? [own] : [el("span", "tkempty", "Noch keine Vorschau.")]));

            return;
        }

        if (entry.kind === "v2") {
            renderPreview(preview, entry.doc, context(), extra() ?? undefined);

            return;
        }

        const parts: Node[] = [];
        const values = context().values;

        if (entry.content.trim()) parts.push(el("p", "cmtext", fill(entry.content, values)));
        if (entry.kind === "embed" && entry.embed) parts.push(embedPreview(entry.embed, values));

        const tail = extra();

        if (tail) parts.push(tail);

        preview.replaceChildren(...(parts.length ? parts : [el("span", "tkempty", "Noch nichts geschrieben.")]));
    };

    const draw = (): void => {
        editorHost.replaceChildren();
        fields.replaceChildren();

        if (entry.kind === options.custom?.kind) {
            editorHost.append(options.custom.form(paintPreview));
            paintPreview();

            return;
        }

        if (entry.kind === "v2") {
            renderEditor(editorHost, entry.doc, {
                ...context(),
                onChange: () => {
                    touch();
                    paintPreview();
                },
            });
            paintPreview();

            return;
        }

        const content = el("textarea", "text tkarea");

        content.rows = entry.kind === "text" ? 6 : 3;
        content.value = entry.content;
        content.maxLength = 2000;
        content.placeholder = entry.kind === "text" ? "Die Nachricht – Markdown und <@Rollen> gehen" : "Optionaler Text über dem Embed";
        content.setAttribute("aria-label", entry.kind === "text" ? "Die Nachricht" : "Text über dem Embed");
        content.addEventListener("input", () => {
            entry.content = content.value;
            touch();
            paintPreview();
        });
        editorHost.append(el("label", "mcfield", el("span", "mcfield__label", entry.kind === "text" ? "Die Nachricht" : "Text über dem Embed"), content));

        if (entry.kind !== "embed") {
            paintPreview();

            return;
        }

        entry.embed ??= options.defaultEmbed();

        const embed = entry.embed;
        const text = (label: string, hint: string, value: string | null, max: number, onChange: (value: string) => void, area = false): HTMLElement => {
            const field = area ? el("textarea", "text tkarea") : el("input", "text");

            if (area) (field as HTMLTextAreaElement).rows = 4;
            else (field as HTMLInputElement).type = "text";

            (field as HTMLInputElement).value = value ?? "";
            (field as HTMLInputElement).maxLength = max;
            field.setAttribute("aria-label", label);
            field.addEventListener("input", () => {
                onChange((field as HTMLInputElement).value);
                touch();
                paintPreview();
            });

            return row(label, hint, field);
        };

        const color = el("input", "tkcolor");

        color.type = "color";
        color.value = embed.color ?? "#00afff";
        color.setAttribute("aria-label", "Farbe des Embeds");
        color.addEventListener("input", () => {
            embed.color = color.value;
            touch();
            paintPreview();
        });

        fields.append(
            text("Überschrift", "Steht oben, fett", embed.title, 256, (value) => (embed.title = value || null)),
            text("Text", "Der Inhalt des Embeds", embed.description, 4000, (value) => (embed.description = value || null), true),
            row("Farbe", "Der Balken links", color),
            text("Bild", "https:// – steht groß unten", embed.image, 512, (value) => (embed.image = value || null)),
            text("Kleines Bild", "https:// – steht rechts oben", embed.thumbnail, 512, (value) => (embed.thumbnail = value || null)),
            text("Autor", "Kleine Zeile ganz oben", embed.author?.name ?? null, 256, (value) => (embed.author = value ? { name: value, icon: embed.author?.icon ?? null } : null)),
            text("Fußzeile", "Kleine Zeile ganz unten", embed.footer?.text ?? null, 2048, (value) => (embed.footer = value ? { text: value, icon: embed.footer?.icon ?? null } : null)),
            row(
                "Uhrzeit",
                "Zeigt unten, wann die Nachricht raus ging",
                el("label", "snitem__switch", toggle(embed.timestamp, "Uhrzeit zeigen", (on) => {
                    embed.timestamp = on;
                    touch();
                    paintPreview();
                }), el("span", "", "zeigen"))
            ),
            fieldList(embed, touch, paintPreview)
        );

        paintPreview();
    };

    const kind = select(
        Object.entries(options.kinds).map(([value, label]): [string, string] => [value, label]),
        entry.kind,
        (value) => {
            entry.kind = value;
            touch();
            draw();
        },
        "Art der Nachricht"
    );

    draw();

    return {
        node: el(
            "div",
            "sneditor",
            el(
                "div",
                "sneditor__main",
                el("div", "sneditor__bar", el("h4", "sneditor__title", options.title ?? "Inhalt"), kind),
                ...(options.hint ? [el("p", "hintline", options.hint)] : []),
                editorHost,
                fields
            ),
            el("aside", "sneditor__side", el("div", "tkside__head", el("span", "tkside__live", "Live-Vorschau")), preview)
        ),
        refresh: paintPreview,
        redraw: draw,
    };
}
