/** Abschnitt: Ticket-System eines Servers. */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { failureText } from "../core/Gallery.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { loadGallery } from "../layout/ImagePicker.js";
import { IEditorContext, IMessageDoc, renderEditor, renderPreview } from "../layout/MessageEditor.js";

interface IOption {
    id: string;
    name: string;
    description: string;
    emoji: string | null;
    categoryId: string | null;
    tagId: string | null;
    supportRoleId: string | null;
    opened: IMessageDoc | null;
}

interface IConfig {
    contact: "direct" | "modmail";
    surface: "channel" | "forum";
    style: "buttons" | "select";
    supportRoleId: string | null;
    forumId: string | null;
    limit: number;
    deleteAfter: number;
    actions: string[];
    options: IOption[];
    messages: Record<string, IMessageDoc>;
    tags: Record<string, string | null>;
    panel: { channelId: string | null; messageId: string | null };
}

interface INamed {
    id: string;
    name: string;
}

interface IResources {
    name: string;
    icon: string | null;
    members: number;
    roles: (INamed & { color: string })[];
    categories: INamed[];
    channels: INamed[];
    forums: INamed[];
    emojis: { id: string; name: string; animated: boolean; url: string }[];
}

interface IAction {
    value: string;
    name: string;
    description: string;
    emoji: string;
    core: boolean;
}

interface IBlocked {
    userId: string;
    name: string | null;
    reason: string | null;
    by: string;
    at: string;
}

interface IPayload {
    config: IConfig;
    guild: IResources;
    actions: IAction[];
    blacklist: IBlocked[];
}

export interface ITicketUser {
    id: string;
    name: string;
    avatar: string | null;
}

const MESSAGE_LABELS: Record<string, string> = {
    panel: "Panel",
    opened: "Ticket geöffnet",
    dm: "ModMail-Bestätigung",
    closed: "Ticket geschlossen",
    frozen: "Ticket eingefroren",
    blacklisted: "User gesperrt",
};

const DELETE_LABELS: [number, string][] = [
    [0, "nie"],
    [1, "nach 1 Stunde"],
    [6, "nach 6 Stunden"],
    [24, "nach 1 Tag"],
    [72, "nach 3 Tagen"],
    [168, "nach 7 Tagen"],
];

/** Eine Zeile mit Beschriftung links und Bedienelement rechts - wie in den Einstellungen. */
function row(label: string, hint: string, control: HTMLElement): HTMLElement {
    const box = document.createElement("div");

    box.className = "row";

    const text = document.createElement("div");

    text.className = "row__text";

    const name = document.createElement("b");

    name.textContent = label;

    const note = document.createElement("i");

    note.textContent = hint;
    text.append(name, note);
    box.append(text, control);

    return box;
}

function seg(options: [string, string][], active: string, onPick: (value: string) => void): HTMLElement {
    const box = document.createElement("div");

    box.className = "seg";
    box.setAttribute("role", "group");

    for (const [value, label] of options) {
        const button = document.createElement("button");

        button.type = "button";
        button.textContent = label;
        button.setAttribute("aria-pressed", String(value === active));
        button.addEventListener("click", () => {
            clickSound("primary");
            onPick(value);
        });
        box.append(button);
    }

    return box;
}

function select(
    entries: { value: string; label: string }[],
    active: string | null,
    onPick: (value: string | null) => void,
    empty = "— keine —"
): HTMLSelectElement {
    const picker = document.createElement("select");

    picker.className = "pick";

    const none = document.createElement("option");

    none.value = "";
    none.textContent = empty;
    picker.append(none);

    for (const entry of entries) {
        const option = document.createElement("option");

        option.value = entry.value;
        option.textContent = entry.label;
        picker.append(option);
    }

    picker.value = active ?? "";
    picker.addEventListener("change", () => onPick(picker.value || null));

    return picker;
}

function field(value: string, placeholder: string, max: number, onInput: (value: string) => void): HTMLInputElement {
    const input = document.createElement("input");

    input.className = "text";
    input.type = "text";
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = max;
    input.addEventListener("input", () => onInput(input.value));

    return input;
}

function heading(text: string): HTMLElement {
    const element = document.createElement("h3");

    element.textContent = text;

    return element;
}

function block(...children: (Node | string)[]): HTMLElement {
    const box = document.createElement("div");

    box.className = "set";
    box.append(...children);

    return box;
}

export function renderTickets(guildId: string, canManage: boolean, user: ITicketUser): void {
    const host = need<HTMLElement>("#tkBody");
    const note = need<HTMLElement>("#tkNote");
    const bar = need<HTMLElement>("#tkBar");
    const saveButton = need<HTMLButtonElement>("#tkSave");
    const resetButton = need<HTMLButtonElement>("#tkReset");

    let data: IPayload | null = null;
    let config: IConfig | null = null;
    let dirty = false;
    let saving = false;
    // Welche Nachricht der Editor gerade zeigt: ein Schlüssel oder "option:<id>".
    let current = "panel";
    let panelChannel: string | null = null;

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    function touch(): void {
        dirty = true;
        bar.hidden = !canManage;
        saveButton.disabled = false;
    }

    async function send(body: unknown): Promise<Record<string, unknown> | null> {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/tickets`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(body),
            });

            const failure = await failureText(response);

            if (failure !== null) {
                warn(failure);

                return null;
            }

            warn(null);

            return (await response.json().catch(() => ({}))) as Record<string, unknown>;
        } catch {
            warn("Der Bot antwortet gerade nicht.");
        }

        return null;
    }

    async function load(): Promise<void> {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/tickets`, {
                headers: { Accept: "application/json" },
            });

            const failure = await failureText(response);

            if (failure !== null) {
                warn(failure);

                return;
            }

            data = (await response.json()) as IPayload;
            config = structuredClone(data.config);
            panelChannel = config.panel.channelId;
            dirty = false;
            bar.hidden = true;
            warn(null);

            // Für die Bildauswahl und die Vorschau: die Galerie einmal holen.
            void loadGallery(guildId).then(() => paint());

            paint();
        } catch {
            warn("Der Bot antwortet gerade nicht.");
        }
    }

    /* ------------------------------------------------------------
       Werte der Vorschau
       ------------------------------------------------------------ */
    function context(): IEditorContext {
        const resources = data!.guild;
        const role = resources.roles.find((entry) => entry.id === config!.supportRoleId);

        return {
            guildId,
            values: {
                user: `@${user.name}`,
                "user.name": user.name,
                "user.id": user.id,
                "user.avatar": user.avatar ?? "",
                guild: resources.name,
                "guild.id": guildId,
                "guild.icon": resources.icon ?? "",
                "guild.members": String(resources.members),
                "ticket.id": "#0042",
                "ticket.option": config!.options[0]?.name ?? "Support",
                "ticket.priority": "Normal",
                "ticket.opened": "vor 2 Minuten",
                "ticket.claimer": "niemand",
                "support.role": role ? `@${role.name}` : "@Team",
                closer: `@${user.name}`,
                reason: "Erledigt",
            },
            roles: new Map(resources.roles.map((entry) => [entry.id, entry.name])),
            channels: new Map(resources.channels.map((entry) => [entry.id, entry.name])),
            onChange: (structural?: boolean) => {
                touch();

                if (structural) paintMessages();
                else paintPreview();
            },
        };
    }

    function doc(): IMessageDoc {
        if (current.startsWith("option:")) {
            const option = config!.options.find((entry) => entry.id === current.slice(7));

            return option?.opened ?? config!.messages.opened;
        }

        return config!.messages[current] ?? config!.messages.panel;
    }

    /* ------------------------------------------------------------
       Abschnitte
       ------------------------------------------------------------ */
    function paint(): void {
        if (!config || !data) return;

        host.replaceChildren(
            block(
                heading("Grundlagen"),
                ...general(),
                hint(
                    config.contact === "modmail"
                        ? "ModMail: Der User schreibt dem Bot per DM, das Team antwortet auf der Team-Seite. Der User sieht den Server-Kanal nie."
                        : "Klassisch: Der User sitzt mit dem Team im Ticket."
                ),
                ...(config.contact === "direct" && config.surface === "forum"
                    ? [
                          hint(
                              "⚠️ Forum-Posts sieht jeder, der das Forum sehen darf – auch die Tickets anderer. Für vertrauliche Anliegen ist der Kanal oder ModMail die bessere Wahl."
                          ),
                      ]
                    : [])
            ),
            block(heading("Öffnungs-Optionen"), ...options()),
            block(heading("Aktionen im Ticket"), ...actions()),
            block(heading("Nachrichten"), messagesHost),
            block(heading("Panel"), ...panel()),
            block(heading("Gesperrte User"), ...blocked())
        );

        paintMessages();
    }

    function hint(text: string): HTMLElement {
        const line = document.createElement("p");

        line.className = "hintline";
        line.textContent = text;

        return line;
    }

    function general(): HTMLElement[] {
        const resources = data!.guild;

        const rows = [
            row(
                "Kontakt",
                "Wo der User schreibt",
                seg(
                    [
                        ["direct", "Klassisch"],
                        ["modmail", "ModMail"],
                    ],
                    config!.contact,
                    (value) => {
                        config!.contact = value as IConfig["contact"];
                        touch();
                        paint();
                    }
                )
            ),
            row(
                "Oberfläche",
                "Wo das Ticket auf der Team-Seite entsteht",
                seg(
                    [
                        ["channel", "Textkanal"],
                        ["forum", "Forum-Post"],
                    ],
                    config!.surface,
                    (value) => {
                        config!.surface = value as IConfig["surface"];
                        touch();
                        paint();
                    }
                )
            ),
            row(
                "Panel",
                "Wie die Optionen im Panel stehen",
                seg(
                    [
                        ["buttons", "Buttons"],
                        ["select", "Auswahlmenü"],
                    ],
                    config!.style,
                    (value) => {
                        config!.style = value as IConfig["style"];
                        touch();
                        paintPreview();
                        paint();
                    }
                )
            ),
            row(
                "Support-Rolle",
                "Sieht jedes Ticket und darf alle Aktionen",
                select(
                    resources.roles.map((role) => ({ value: role.id, label: `@${role.name}` })),
                    config!.supportRoleId,
                    (value) => {
                        config!.supportRoleId = value;
                        touch();
                        paintPreview();
                    }
                )
            ),
        ];

        if (config!.surface === "forum") {
            rows.push(
                row(
                    "Forum",
                    "Hier entstehen die Ticket-Posts; Tags legt der Bot selbst an",
                    select(
                        resources.forums.map((forum) => ({ value: forum.id, label: `#${forum.name}` })),
                        config!.forumId,
                        (value) => {
                            config!.forumId = value;
                            touch();
                        },
                        "— Forum wählen —"
                    )
                )
            );
        }

        rows.push(
            row(
                "Offene Tickets je User",
                "0 heißt: ohne Grenze",
                select(
                    Array.from({ length: 11 }, (_, value) => ({ value: String(value), label: value === 0 ? "ohne Grenze" : String(value) })),
                    String(config!.limit),
                    (value) => {
                        config!.limit = Number(value ?? 0);
                        touch();
                    },
                    "ohne Grenze"
                )
            ),
            row(
                "Kanal löschen",
                "Nach dem Schließen; Forum-Posts werden ebenfalls entfernt",
                select(
                    DELETE_LABELS.map(([hours, label]) => ({ value: String(hours), label })),
                    String(config!.deleteAfter),
                    (value) => {
                        config!.deleteAfter = Number(value ?? 0);
                        touch();
                    },
                    "nie"
                )
            )
        );

        return rows;
    }

    function options(): HTMLElement[] {
        const resources = data!.guild;
        const list = document.createElement("div");

        list.className = "tkopts";

        config!.options.forEach((option, index) => {
            const card = document.createElement("div");

            card.className = "tkopt";

            const head = document.createElement("div");

            head.className = "tkopt__head";

            const emoji = field(option.emoji ?? "", "🎫", 64, (value) => {
                option.emoji = value.trim() || null;
                touch();
            });

            emoji.className = "text tkopt__emoji";
            emoji.setAttribute("aria-label", "Emoji");

            const emojis = select(
                resources.emojis.map((entry) => ({ value: `<${entry.animated ? "a" : ""}:${entry.name}:${entry.id}>`, label: `:${entry.name}:` })),
                null,
                (value) => {
                    if (!value) return;

                    option.emoji = value;
                    touch();
                    paintOptions();
                },
                "Server-Emoji …"
            );

            const name = field(option.name, "Name der Option", 80, (value) => {
                option.name = value;
                touch();
            });

            name.setAttribute("aria-label", "Name");

            const tools = document.createElement("div");

            tools.className = "tkopt__tools";

            const move = (delta: number, symbol: string, label: string) => {
                const button = document.createElement("button");

                button.type = "button";
                button.className = "iconbtn";
                button.title = label;
                button.setAttribute("aria-label", label);
                button.disabled = index + delta < 0 || index + delta >= config!.options.length;
                button.append(icon(symbol));
                button.addEventListener("click", () => {
                    const [moved] = config!.options.splice(index, 1);

                    config!.options.splice(index + delta, 0, moved);
                    touch();
                    paintOptions();
                });

                return button;
            };

            const remove = document.createElement("button");

            remove.type = "button";
            remove.className = "iconbtn is-danger";
            remove.title = "Option löschen";
            remove.setAttribute("aria-label", "Option löschen");
            remove.append(icon("#i-trash"));
            remove.addEventListener("click", () => {
                config!.options.splice(index, 1);
                touch();
                paintOptions();
                paintMessages();
            });

            tools.append(move(-1, "#i-up", "Nach oben"), move(1, "#i-down", "Nach unten"), remove);
            head.append(emoji, emojis, name, tools);

            const description = field(option.description, "Kurze Beschreibung – steht im Auswahlmenü", 100, (value) => {
                option.description = value;
                touch();
            });

            description.setAttribute("aria-label", "Beschreibung");

            card.append(head, description);

            if (config!.surface === "channel") {
                card.append(
                    row(
                        "Kategorie",
                        "Hier entstehen die Kanäle dieser Option",
                        select(
                            resources.categories.map((category) => ({ value: category.id, label: category.name })),
                            option.categoryId,
                            (value) => {
                                option.categoryId = value;
                                touch();
                            },
                            "— ohne Kategorie —"
                        )
                    )
                );
            } else {
                card.append(hint(option.tagId ? "Forum-Tag steht bereit." : "Der Forum-Tag entsteht beim Speichern."));
            }

            card.append(
                row(
                    "Eigene Support-Rolle",
                    "Statt der allgemeinen – nur sie sieht diese Tickets",
                    select(
                        resources.roles.map((role) => ({ value: role.id, label: `@${role.name}` })),
                        option.supportRoleId,
                        (value) => {
                            option.supportRoleId = value;
                            touch();
                        },
                        "— allgemeine Rolle —"
                    )
                )
            );

            const own = document.createElement("label");

            own.className = "tktoggle";

            const switcher = document.createElement("input");

            switcher.type = "checkbox";
            switcher.className = "switch";
            switcher.checked = option.opened !== null;
            switcher.addEventListener("change", () => {
                option.opened = switcher.checked ? structuredClone(config!.messages.opened) : null;
                current = switcher.checked ? `option:${option.id}` : "opened";
                touch();
                paintOptions();
                paintMessages();
            });

            const ownText = document.createElement("span");

            ownText.textContent = "Eigene Eröffnungs-Nachricht";
            own.append(switcher, ownText);
            card.append(own);

            list.append(card);
        });

        const add = document.createElement("button");

        add.type = "button";
        add.className = "btn btn--quiet";
        add.append(icon("#i-plus"), document.createTextNode("Option hinzufügen"));
        add.addEventListener("click", () => {
            config!.options.push({
                id: "",
                name: "Neue Option",
                description: "",
                emoji: "🎫",
                categoryId: null,
                tagId: null,
                supportRoleId: null,
                opened: null,
            });
            touch();
            paintOptions();
        });

        return [
            hint("Jede Option ist ein Knopf bzw. ein Eintrag im Panel. Die Reihenfolge hier ist die Reihenfolge dort."),
            list,
            add,
        ];
    }

    function actions(): HTMLElement[] {
        const list = document.createElement("div");

        list.className = "modlist";

        for (const action of data!.actions) {
            const tile = document.createElement("label");

            tile.className = action.core || config!.actions.includes(action.value) ? "acct acct--on" : "acct";

            const mark = document.createElement("span");

            mark.className = "acct__mark";
            mark.textContent = action.emoji;

            const text = document.createElement("span");

            text.className = "acct__text";

            const name = document.createElement("b");

            name.textContent = action.name;

            const description = document.createElement("span");

            description.textContent = action.description;
            text.append(name, description);

            if (action.core) {
                const fixed = document.createElement("span");

                fixed.className = "modalways";
                fixed.textContent = "Immer an – gehört fest zum Ticket.";
                text.append(fixed);
            }

            const switcher = document.createElement("input");

            switcher.type = "checkbox";
            switcher.className = "switch";
            switcher.checked = action.core || config!.actions.includes(action.value);
            switcher.disabled = action.core || !canManage;
            switcher.addEventListener("change", () => {
                config!.actions = switcher.checked
                    ? [...config!.actions, action.value]
                    : config!.actions.filter((entry) => entry !== action.value);
                touch();
                paintActions();
                paintPreview();
            });

            tile.append(mark, text, switcher);
            list.append(tile);
        }

        return [hint("Was das Menü im Ticket anbietet. Fünf Aktionen gehören fest dazu."), list];
    }

    const messagesHost = document.createElement("div");

    function paintMessages(): void {
        if (!config) return;

        const tabs = document.createElement("div");

        tabs.className = "seg tkmsgtabs";

        const keys = [
            ...Object.keys(MESSAGE_LABELS)
                .filter((key) => key !== "dm" || config!.contact === "modmail")
                .map((key) => ({ value: key, label: MESSAGE_LABELS[key] })),
            ...config.options
                .filter((option) => option.opened)
                .map((option) => ({ value: `option:${option.id}`, label: `Eröffnung: ${option.name}` })),
        ];

        if (!keys.some((entry) => entry.value === current)) current = "panel";

        for (const entry of keys) {
            const tab = document.createElement("button");

            tab.type = "button";
            tab.textContent = entry.label;
            tab.setAttribute("aria-pressed", String(entry.value === current));
            tab.addEventListener("click", () => {
                current = entry.value;
                paintMessages();
            });
            tabs.append(tab);
        }

        const grid = document.createElement("div");

        grid.className = "tkedit";

        const editor = document.createElement("div");

        editor.className = "tkedit__form";

        const preview = document.createElement("aside");

        preview.className = "tkedit__preview";

        const previewTitle = document.createElement("h4");

        previewTitle.textContent = "Vorschau";

        const previewBody = document.createElement("div");

        previewBody.id = "tkPreview";
        preview.append(previewTitle, previewBody);
        grid.append(editor, preview);

        messagesHost.replaceChildren(hint(describe(current)), tabs, grid);

        renderEditor(editor, doc(), context());
        paintPreview();
    }

    function describe(key: string): string {
        if (key.startsWith("option:")) return "Diese Eröffnung gilt nur für diese Option – sonst gilt die allgemeine.";
        if (key === "panel") return "Steht im Server-Kanal. Darunter kommen die Knöpfe bzw. das Auswahlmenü.";
        if (key === "opened") return "Die erste Nachricht im Ticket, mit Statuszeile und Aktions-Menü darunter.";
        if (key === "dm") return "Bekommt der User per DM, sobald sein ModMail-Ticket steht.";
        if (key === "closed") return "Wird beim Schließen geschickt – mit {closer} und {reason}.";
        if (key === "frozen") return "Sieht der User, wenn das Team das Ticket einfriert.";

        return "Die Absage an einen gesperrten User.";
    }

    function paintPreview(): void {
        const body = document.querySelector<HTMLElement>("#tkPreview");

        if (!body || !config) return;

        renderPreview(body, doc(), context(), mock());
    }

    /** Was unter der Nachricht steht: Panel-Knöpfe oder das Aktions-Menü. */
    function mock(): HTMLElement | undefined {
        if (current === "panel") {
            const box = document.createElement("div");

            box.className = "tkmock";

            if (config!.style === "select") {
                const fake = document.createElement("div");

                fake.className = "tkmock__select";
                fake.textContent = "Worum geht es?";
                box.append(fake);
            } else {
                for (const option of config!.options) {
                    const button = document.createElement("span");

                    button.className = "tkmock__btn";
                    button.textContent = `${option.emoji ?? ""} ${option.name}`.trim();
                    box.append(button);
                }
            }

            return box;
        }

        if (current === "opened" || current.startsWith("option:")) {
            const box = document.createElement("div");

            box.className = "tkmock";

            const status = document.createElement("p");

            status.className = "tkmock__status";
            status.textContent = "🎫 #0042 · Support · ⏳ Wartet auf das Team";

            const fake = document.createElement("div");

            fake.className = "tkmock__select";
            fake.textContent = "⚙️ | Aktion wählen …";

            const chips = document.createElement("div");

            chips.className = "tkmock__chips";

            for (const action of data!.actions.filter((entry) => entry.core || config!.actions.includes(entry.value))) {
                const chip = document.createElement("span");

                chip.className = "tagline";
                chip.textContent = `${action.emoji} ${action.name}`;
                chips.append(chip);
            }

            box.append(status, fake, chips);

            return box;
        }

        return undefined;
    }

    function panel(): HTMLElement[] {
        const resources = data!.guild;
        const status = hint(
            config!.panel.channelId
                ? `Das Panel steht in #${resources.channels.find((entry) => entry.id === config!.panel.channelId)?.name ?? "unbekannt"}.`
                : "Das Panel wurde noch nirgends gesendet."
        );

        const picker = select(
            resources.channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` })),
            panelChannel,
            (value) => {
                panelChannel = value;
            },
            "— Kanal wählen —"
        );

        const sendButton = document.createElement("button");

        sendButton.type = "button";
        sendButton.className = "btn btn--primary";
        sendButton.disabled = !canManage;
        sendButton.append(icon("#i-message"), document.createTextNode(config!.panel.messageId ? "Panel neu senden" : "Panel senden"));
        sendButton.addEventListener("click", async () => {
            if (!panelChannel) {
                warn("Wähle zuerst einen Kanal für das Panel.");

                return;
            }

            if (dirty) {
                warn("Speichere zuerst deine Änderungen – sonst schickt der Bot den alten Stand.");

                return;
            }

            clickSound("primary");
            sendButton.disabled = true;

            const result = await send({ action: "panel", channelId: panelChannel });

            sendButton.disabled = false;

            if (result === null) return;

            toast("info", "Panel gesendet", "Der Bot hat das Panel in den Kanal gestellt.");
            await load();
        });

        return [status, row("Kanal", "Wohin das Panel soll", picker), sendButton];
    }

    function blocked(): HTMLElement[] {
        if (data!.blacklist.length === 0) return [hint("Niemand ist gesperrt.")];

        const list = document.createElement("div");

        list.className = "glist";

        for (const entry of data!.blacklist) {
            const line = document.createElement("div");

            line.className = "grow";

            const text = document.createElement("div");

            text.className = "grow__text";

            const name = document.createElement("b");

            name.textContent = entry.name ?? entry.userId;

            const reason = document.createElement("span");

            reason.textContent = `${entry.reason ?? "ohne Grund"} · gesperrt am ${new Date(entry.at).toLocaleDateString("de-DE")}`;
            text.append(name, reason);

            const unblock = document.createElement("button");

            unblock.type = "button";
            unblock.className = "btn btn--quiet";
            unblock.disabled = !canManage;
            unblock.textContent = "Entsperren";
            unblock.addEventListener("click", async () => {
                unblock.disabled = true;

                if (await send({ action: "unblock", userId: entry.userId })) {
                    toast("info", "Entsperrt", `${entry.name ?? entry.userId} kann wieder Tickets öffnen.`);
                    await load();
                }
            });

            line.append(text, unblock);
            list.append(line);
        }

        return [list];
    }

    function paintOptions(): void {
        paint();
    }

    function paintActions(): void {
        paint();
    }

    /* ------------------------------------------------------------
       Speichern
       ------------------------------------------------------------ */
    saveButton.addEventListener("click", async () => {
        if (!config || saving) return;

        saving = true;
        saveButton.disabled = true;
        clickSound("primary");

        const result = (await send({ action: "save", config })) as { config?: IConfig } | null;

        saving = false;

        if (!result?.config) {
            saveButton.disabled = false;

            return;
        }

        data = { ...data!, config: result.config };
        config = structuredClone(result.config);
        dirty = false;
        bar.hidden = true;
        toast("info", "Gespeichert", "Der Bot arbeitet ab sofort damit.");
        paint();
    });

    resetButton.addEventListener("click", () => {
        if (!data) return;

        config = structuredClone(data.config);
        dirty = false;
        bar.hidden = true;
        paint();
    });

    void load();
}
