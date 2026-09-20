/**
 * Abschnitt: Welcome System.
 *
 * Zwei Reiter: Begrüßung und Abschied. Je Reiter die Art (gezeichnete Karte,
 * Karte im Components-V2-Stil, Embed oder normale Nachricht), der Inhalt mit
 * Live-Vorschau und ein Test-Knopf. Darunter die Auto-Rollen.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { toast } from "../core/Toast.js";
import { api, button, card, el, IRole, rolePicker, row, select, stat, toggle } from "../core/Ui.js";
import { bodyEditor, IBody, IBodyEditor, IEmbed } from "../layout/BodyEditor.js";
import { IEditorContext, IMessageDoc } from "../layout/MessageEditor.js";
import { IServerEmoji } from "../layout/EmojiPicker.js";
import { fill, WELCOME_PLACEHOLDERS } from "../constants/Placeholders.js";

type Which = "join" | "leave";

interface ICard {
    background: string | null;
    accent: string;
    dim: number;
    title: string;
    subtitle: string;
    footer: string;
    align: "left" | "center";
    titleSize: number;
    avatar: boolean;
    avatarRing: boolean;
    avatarShape: "circle" | "bevel";
    count: boolean;
    icon: boolean;
    date: boolean;
}

interface IMessage extends IBody {
    on: boolean;
    channelId: string | null;
    card: ICard;
}

interface IConfig {
    join: IMessage;
    leave: IMessage;
    roles: string[];
    botRoles: string[];
}

interface IPayload {
    config: IConfig;
    defaults: Record<Which, { doc: IMessageDoc; card: ICard }>;
    placeholders: string[];
    kinds: Record<string, string>;
    limits: { roles: number; titleMin: number; titleMax: number };
    ready: { members: boolean };
    guild: { name: string; icon: string | null; roles: IRole[]; channels: { id: string; name: string }[]; emojis: IServerEmoji[] };
}

const EMPTY_EMBED: IEmbed = {
    title: "Willkommen!",
    description: "Schön, dass du da bist.",
    color: "#00afff",
    url: null,
    image: null,
    thumbnail: null,
    author: null,
    footer: null,
    timestamp: false,
    fields: [],
};

export function renderWelcome(guildId: string): void {
    const host = need<HTMLElement>("#welcomeBody");
    const note = need<HTMLElement>("#welcomeNote");
    const call = api(`${BASE}/api/guild/${encodeURIComponent(guildId)}/welcome`, note);

    let data: IPayload | null = null;
    let draft: IConfig | null = null;
    let which: Which = "join";
    let dirty = false;
    /** Die zuletzt gezeichnete Karte je Richtung - sie kommt vom Bot als Bild. */
    const cards = new Map<Which, string>();

    const save = el("button", "btn btn--primary") as HTMLButtonElement;

    function touch(): void {
        dirty = true;
        save.disabled = false;
    }

    const context = (): IEditorContext => ({
        guildId,
        values: Object.fromEntries(WELCOME_PLACEHOLDERS.map((entry) => [entry.key, entry.sample])),
        roles: new Map(data!.guild.roles.map((role) => [role.id, role.name])),
        channels: new Map(data!.guild.channels.map((channel) => [channel.id, channel.name])),
        emojis: data!.guild.emojis,
        onChange: () => undefined,
    });

    /* ------------------------------------------------------------
       Kopf
       ------------------------------------------------------------ */
    function head(): HTMLElement {
        const join = draft!.join;
        const leave = draft!.leave;
        const channel = (message: IMessage): string => {
            const entry = message.channelId ? data!.guild.channels.find((item) => item.id === message.channelId) : null;

            return message.on ? (entry ? `# ${entry.name}` : "kein Kanal") : "aus";
        };

        return el(
            "div",
            "tkhead snhead",
            stat("#i-wave", "Begrüßung", channel(join), join.on && join.channelId ? "is-ok" : ""),
            stat("#i-logout", "Abschied", channel(leave), leave.on && leave.channelId ? "is-ok" : ""),
            stat("#i-badge", "Auto-Rollen", `${draft!.roles.length + draft!.botRoles.length} / ${data!.limits.roles * 2}`),
            stat("#i-image", "Art", data!.kinds[draft![which].kind] ?? draft![which].kind)
        );
    }

    function tabs(): HTMLElement {
        const box = el("div", "seg plkinds");

        box.setAttribute("role", "group");
        box.setAttribute("aria-label", "Begrüßung oder Abschied bearbeiten");

        for (const [value, label] of [["join", "Begrüßung"], ["leave", "Abschied"]] as [Which, string][]) {
            const entry = button("", label);

            entry.setAttribute("aria-pressed", String(which === value));
            entry.addEventListener("click", () => {
                which = value;
                paint();
            });
            box.append(entry);
        }

        return box;
    }

    /* ------------------------------------------------------------
       Die Nachricht
       ------------------------------------------------------------ */
    function message(): HTMLElement {
        const current = draft![which];
        const channel = select(
            [["", "— Kanal wählen —"], ...data!.guild.channels.map((entry): [string, string] => [entry.id, `# ${entry.name}`])],
            current.channelId ?? "",
            (value) => {
                current.channelId = value || null;
                touch();
            },
            which === "join" ? "Kanal für die Begrüßung" : "Kanal für den Abschied"
        );

        let editor: IBodyEditor;

        editor = bodyEditor(current, {
            kinds: data!.kinds,
            context,
            defaultEmbed: () => structuredClone(EMPTY_EMBED),
            touch,
            title: "Inhalt",
            custom: {
                kind: "card",
                form: (refresh) => cardForm(current, refresh),
                preview: () => cardPreview(),
            },
        });

        const test = button("btn btn--quiet", icon("#i-play"), "Test senden");

        test.addEventListener("click", async () => {
            if (dirty) {
                toast("info", "Erst speichern", "Der Test schickt, was gespeichert ist.");

                return;
            }

            test.disabled = true;

            if (await call("", { action: "test", which })) toast("info", "Test gesendet", "Schau in den Kanal – so sieht es für neue Mitglieder aus.");

            test.disabled = false;
        });

        return card(
            which === "join" ? "Begrüßung" : "Abschied",
            which === "join"
                ? "Was passiert, wenn jemand den Server betritt. Die Platzhalter setzt der Bot beim Senden ein."
                : "Was passiert, wenn jemand geht. Wer gebannt wird, zählt dabei mit.",
            row(
                which === "join" ? "Begrüßen" : "Verabschieden",
                "Aus heißt: der Bot sagt nichts",
                el("label", "snitem__switch", toggle(current.on, which === "join" ? "Begrüßung an" : "Abschied an", (on) => {
                    current.on = on;
                    touch();
                    paint();
                }), el("span", "", current.on ? "an" : "aus"))
            ),
            row("Kanal", "Wohin die Nachricht geht", channel),
            placeholderHint(),
            editor.node,
            el("div", "mcsave", test)
        );
    }

    /** Die Platzhalter zum Nachlesen - ein Klick kopiert sie. */
    function placeholderHint(): HTMLElement {
        const chips = el("div", "phhint__list");

        for (const entry of WELCOME_PLACEHOLDERS) {
            const key = `{${entry.key}}`;
            const chip = button("phchip", el("code", "", key), el("span", "phchip__label", entry.label));

            chip.title = `${entry.label} – Beispiel: ${entry.sample}`;
            chip.addEventListener("click", async () => {
                await navigator.clipboard.writeText(key).catch(() => undefined);
                toast("info", "Kopiert", `${key} steht in der Zwischenablage.`);
            });
            chips.append(chip);
        }

        return el("div", "phhint", el("p", "hintline phhint__lead", "Diese Platzhalter kennt der Bot – in den Texten und auf der Karte:"), chips);
    }

    /* ------------------------------------------------------------
       Die gezeichnete Karte
       ------------------------------------------------------------ */
    function cardForm(current: IMessage, refresh: () => void): HTMLElement {
        const entry = current.card;
        const box = el("div", "wccard");
        const later = (): void => {
            touch();
            void drawCard(refresh);
        };
        const line = (label: string, hint: string, value: string, onChange: (value: string) => void): HTMLElement => {
            const field = el("input", "text");

            field.type = "text";
            field.value = value;
            field.maxLength = 120;
            field.setAttribute("aria-label", label);
            field.addEventListener("input", () => {
                onChange(field.value);
                later();
            });

            return row(label, hint, field);
        };

        const content = el("textarea", "text tkarea");

        content.rows = 2;
        content.value = current.content;
        content.maxLength = 2000;
        content.setAttribute("aria-label", "Text über der Karte");
        content.addEventListener("input", () => {
            current.content = content.value;
            touch();
        });

        const accent = el("input", "tkcolor");

        accent.type = "color";
        accent.value = entry.accent;
        accent.setAttribute("aria-label", "Akzentfarbe der Karte");
        accent.addEventListener("input", () => {
            entry.accent = accent.value;
            later();
        });

        const dim = el("input", "wcrange");

        dim.type = "range";
        dim.min = "0";
        dim.max = "90";
        dim.step = "5";
        dim.value = String(entry.dim);
        dim.setAttribute("aria-label", "Hintergrund abdunkeln");

        const dimValue = el("span", "wcrange__value", `${entry.dim} %`);

        dim.addEventListener("input", () => {
            entry.dim = Number(dim.value);
            dimValue.textContent = `${entry.dim} %`;
            later();
        });

        const size = el("input", "text gwnum");

        size.type = "number";
        size.min = String(data!.limits.titleMin);
        size.max = String(data!.limits.titleMax);
        size.value = String(entry.titleSize);
        size.setAttribute("aria-label", "Schriftgröße der Überschrift");
        size.addEventListener("input", () => {
            entry.titleSize = Math.max(data!.limits.titleMin, Math.min(data!.limits.titleMax, Number(size.value) || 48));
            later();
        });

        const switchRow = (label: string, hint: string, value: boolean, onChange: (on: boolean) => void): HTMLElement =>
            row(
                label,
                hint,
                el("label", "snitem__switch", toggle(value, label, (on) => {
                    onChange(on);
                    later();
                }), el("span", "", "an"))
            );

        box.append(
            el("label", "mcfield", el("span", "mcfield__label", "Text über der Karte"), content),
            backgroundRow(entry, refresh),
            row("Akzentfarbe", "Rahmen, Ring und die kleine Zeile", accent),
            row("Abdunkeln", "Macht den Text auf hellen Bildern lesbar", el("div", "wcrange__box", dim, dimValue)),
            line("Überschrift", "Die große Zeile", entry.title, (value) => (entry.title = value)),
            line("Unterzeile", "Die Zeile darunter", entry.subtitle, (value) => (entry.subtitle = value)),
            line("Kleine Zeile", "Ganz unten, in der Akzentfarbe", entry.footer, (value) => (entry.footer = value)),
            row("Schriftgröße", `${data!.limits.titleMin} bis ${data!.limits.titleMax} Pixel`, size),
            row(
                "Ausrichtung",
                "Links neben dem Avatar oder mittig",
                select(
                    [
                        ["left", "Links"],
                        ["center", "Mittig"],
                    ],
                    entry.align,
                    (value) => {
                        entry.align = value === "center" ? "center" : "left";
                        later();
                    },
                    "Ausrichtung der Texte"
                )
            ),
            switchRow("Avatar", "Das Bild des Mitglieds", entry.avatar, (on) => (entry.avatar = on)),
            switchRow("Ring um den Avatar", "In der Akzentfarbe", entry.avatarRing, (on) => (entry.avatarRing = on)),
            row(
                "Form des Avatars",
                "Rund oder mit abgeschrägten Ecken",
                select(
                    [
                        ["circle", "Rund"],
                        ["bevel", "Abgeschrägt"],
                    ],
                    entry.avatarShape,
                    (value) => {
                        entry.avatarShape = value === "bevel" ? "bevel" : "circle";
                        later();
                    },
                    "Form des Avatars"
                )
            ),
            switchRow("Server-Icon", "Oben rechts auf der Karte", entry.icon, (on) => (entry.icon = on)),
            switchRow("Beitrittsdatum", "Hängt hinten an der kleinen Zeile", entry.date, (on) => (entry.date = on))
        );

        return box;
    }

    /** Hintergrundbild hochladen, ansehen, entfernen. */
    function backgroundRow(entry: ICard, refresh: () => void): HTMLElement {
        const input = el("input", "wcfile");
        const pick = button("btn btn--quiet", icon("#i-upload"), entry.background ? "Bild tauschen" : "Bild hochladen");
        const drop = button("btn btn--quiet btn--icon", icon("#i-trash"), "Entfernen");

        input.type = "file";
        input.accept = "image/png,image/jpeg,image/gif,image/webp";
        input.setAttribute("aria-label", "Hintergrundbild wählen");
        input.addEventListener("change", async () => {
            const file = input.files?.[0];

            input.value = "";

            if (!file) return;
            if (file.size > 8 * 1024 * 1024) {
                toast("info", "Zu groß", "Das Bild darf höchstens 8 MB haben.");

                return;
            }

            pick.disabled = true;

            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/welcome/background/${which}`, {
                method: "POST",
                headers: { "Content-Type": file.type, Accept: "application/json" },
                body: file,
            }).catch(() => null);

            pick.disabled = false;

            if (!response?.ok) {
                toast("info", "Nicht hochgeladen", "Der Bot hat das Bild abgelehnt. PNG, JPG, GIF oder WebP bis 8 MB.");

                return;
            }

            const answer = (await response.json()) as { config: IConfig };

            data!.config = answer.config;
            entry.background = answer.config[which].card.background;
            toast("info", "Hochgeladen", "Das Bild liegt beim Bot und steht gleich auf der Karte.");
            void drawCard(refresh);
            paint();
        });

        drop.disabled = !entry.background;
        drop.addEventListener("click", async () => {
            const answer = await call<{ config: IConfig }>("", { action: "background-remove", which });

            if (!answer) return;

            entry.background = null;
            data!.config = answer.config;
            toast("info", "Entfernt", "Die Karte nutzt wieder den Farbverlauf.");
            void drawCard(refresh);
            paint();
        });

        return row(
            "Hintergrund",
            entry.background ? "Liegt beim Bot – verkleinert auf 1920 px" : "Ohne Bild zeichnet der Bot einen Farbverlauf",
            el("div", "wcbg", pick, ...(entry.background ? [drop] : []), input)
        );
    }

    /** Die Karte kommt fertig gezeichnet vom Bot - die Schriften liegen dort. */
    async function drawCard(refresh: () => void): Promise<void> {
        const answer = await call<{ image: string }>("", { action: "preview", which, message: draft![which] });

        if (!answer) return;

        cards.set(which, answer.image);
        refresh();
    }

    function cardPreview(): Node | null {
        const image = cards.get(which);

        if (!image) {
            void drawCard(() => paintPreviewOnly());

            return el("span", "tkempty", "Karte wird gezeichnet …");
        }

        const view = el("img", "wcpreview");

        view.src = image;
        view.alt = "Vorschau der Begrüßungskarte";
        view.loading = "lazy";

        const values = Object.fromEntries(WELCOME_PLACEHOLDERS.map((entry) => [entry.key, entry.sample]));

        return el("div", "wcpreview__box", ...(draft![which].content ? [el("p", "cmtext", fill(draft![which].content, values))] : []), view);
    }

    /** Nur die Vorschau neu zeichnen - ohne die ganze Seite anzufassen. */
    function paintPreviewOnly(): void {
        const side = host.querySelector<HTMLElement>(".sneditor__side .tkprev");
        const view = cardPreview();

        if (side && view) side.replaceChildren(view);
    }

    /* ------------------------------------------------------------
       Auto-Rollen
       ------------------------------------------------------------ */
    function roles(): HTMLElement {
        return card(
            "Auto-Rollen",
            "Was jeder bekommt, der den Server betritt. Die Rollen müssen unter der höchsten Rolle des Bots stehen.",
            row(
                "Für Mitglieder",
                `Bis zu ${data!.limits.roles} Rollen`,
                rolePicker(data!.guild.roles, draft!.roles, (ids) => {
                    draft!.roles = ids;
                    touch();
                }, [], data!.limits.roles)
            ),
            row(
                "Für Bots",
                "Wer einen Bot einlädt, gibt ihm damit diese Rollen",
                rolePicker(data!.guild.roles, draft!.botRoles, (ids) => {
                    draft!.botRoles = ids;
                    touch();
                }, [], data!.limits.roles)
            )
        );
    }

    /* ------------------------------------------------------------
       Zeichnen und Laden
       ------------------------------------------------------------ */
    function notices(): HTMLElement[] {
        if (data!.ready.members) return [];

        return [
            el(
                "div",
                "notice snnotice",
                icon("#i-warn"),
                el("span", "", 'Der Bot sieht niemanden kommen oder gehen: dafür braucht er das Members-Intent (GUILD_MEMBER_INTENT="true" in der .env und im Developer Portal). Auto-Rollen und Begrüßung bleiben bis dahin still.')
            ),
        ];
    }

    function paint(): void {
        if (!data || !draft) return;

        save.replaceChildren(icon("#i-check"), document.createTextNode("Speichern"));
        save.disabled = !dirty;

        host.replaceChildren(...notices(), head(), tabs(), message(), roles(), el("div", "mcsave lvsave", save));
    }

    save.addEventListener("click", async () => {
        save.disabled = true;

        const answer = await call<{ config: IConfig }>("", { action: "save", config: draft });

        if (!answer) {
            save.disabled = false;

            return;
        }

        data!.config = answer.config;
        draft = structuredClone(answer.config);
        dirty = false;
        cards.clear();
        toast("info", "Gespeichert", "Gilt ab dem nächsten Mitglied.");
        paint();
    });

    host.replaceChildren(el("div", "tkhead", ...Array.from({ length: 4 }, () => el("div", "sb snskel"))));

    void call<IPayload>("").then((answer) => {
        if (!answer) return;

        data = answer;
        draft = structuredClone(answer.config);
        paint();
    });
}
