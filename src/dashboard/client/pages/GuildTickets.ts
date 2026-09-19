/**
 * Abschnitt: Ticket-System eines Servers.
 *
 * Oben der Stand auf einen Blick, darunter Tabs - immer nur ein Bereich offen.
 * Daneben steht die Live-Vorschau dessen, was man gerade ändert; auf schmalen
 * Seiten rutscht sie unter den Bereich. Gespeichert wird alles auf einmal über
 * die Leiste unten.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { failureText } from "../core/Gallery.js";
import { ILogThread, logTargetSelect } from "../core/LogTarget.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { emojiNode, emojiPicker, IServerEmoji } from "../layout/EmojiPicker.js";
import { loadGallery } from "../layout/ImagePicker.js";
import { IEditorContext, IMessageDoc, renderEditor, renderPreview } from "../layout/MessageEditor.js";

interface IOption {
    id: string;
    name: string;
    /** Kürzel für die Ticket-ID (SUP -> SUP-5). Leer: der Bot nimmt es aus dem Namen. */
    code: string;
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
    transcripts: { enabled: boolean; channelId: string | null; dm: boolean };
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
    /** Die Beiträge der Foren - auch einer davon taugt als Log-Kanal. */
    threads: ILogThread[];
    emojis: IServerEmoji[];
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
    /** Wo das Panel wirklich steht - null, wenn die Nachricht weg ist. */
    panel: { channelId: string; url: string } | null;
    guild: IResources;
    actions: IAction[];
    blacklist: IBlocked[];
}

export interface ITicketUser {
    id: string;
    name: string;
    avatar: string | null;
}

type Tab = "setup" | "topics" | "actions" | "messages" | "panel" | "blocked";

// hash: der Teil hinter # in der Adresse - ein Tab lässt sich so verlinken.
const TABS: { id: Tab; hash: string; label: string; icon: string }[] = [
    { id: "setup", hash: "einrichtung", label: "Einrichtung", icon: "#i-sliders" },
    { id: "topics", hash: "themen", label: "Themen", icon: "#i-list-checks" },
    { id: "actions", hash: "aktionen", label: "Aktionen", icon: "#i-settings" },
    { id: "messages", hash: "nachrichten", label: "Nachrichten", icon: "#i-message" },
    { id: "panel", hash: "panel", label: "Panel", icon: "#i-layout" },
    { id: "blocked", hash: "sperrliste", label: "Sperrliste", icon: "#i-lock" },
];

const MESSAGE_LABELS: Record<string, string> = {
    panel: "Panel",
    modmailPanel: "Panel (ModMail)",
    opened: "Ticket geöffnet",
    dm: "ModMail-Bestätigung",
    closed: "Ticket geschlossen",
    frozen: "Ticket eingefroren",
    blacklisted: "User gesperrt",
};

const MESSAGE_HINTS: Record<string, string> = {
    panel: "Steht im Server-Kanal. Darunter kommen die Knöpfe bzw. das Auswahlmenü mit den Themen.",
    modmailPanel:
        "Das Panel bei ModMail: erklärt, dass es per DM weitergeht. Darunter steht nur der Knopf „Ticket per DM starten“ – die Themen fragt der Bot in der DM ab.",
    opened: "Die erste Nachricht im Ticket, mit Statuszeile und Aktions-Menü darunter.",
    dm: "Bekommt der User per DM, sobald sein ModMail-Ticket steht.",
    closed: "Wird beim Schließen geschickt – mit {closer} und {reason}.",
    frozen: "Sieht der User, wenn das Team das Ticket einfriert.",
    blacklisted: "Die Absage an einen gesperrten User.",
};

// Dieselben Werte wie DELETE_AFTER_HOURS im Bot; -1 steht dort für "sofort".
const DELETE_LABELS: [number, string][] = [
    [0, "nie"],
    [-1, "sofort"],
    [1, "nach 1 Stunde"],
    [6, "nach 6 Stunden"],
    [24, "nach 1 Tag"],
    [72, "nach 3 Tagen"],
    [168, "nach 7 Tagen"],
];

const MAX_OPTIONS = 25;

const PANEL_TOASTS: Record<string, [string, string]> = {
    sent: ["Panel gesendet", "Der Bot hat das Panel in den Kanal gestellt."],
    updated: ["Panel aktualisiert", "Dort stand schon eins – jetzt ist es auf dem neuen Stand. Ein zweites gibt es nicht."],
    moved: ["Panel umgezogen", "Das Panel steht im neuen Kanal, das alte ist weg."],
};

/* ----------------------------------------------------------
   Kleine Bausteine
   ---------------------------------------------------------- */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (className) element.className = className;

    element.append(...children);

    return element;
}

/** Eine Zeile mit Beschriftung links und Bedienelement rechts - wie in den Einstellungen. */
function row(label: string, hint: string, control: HTMLElement): HTMLElement {
    // Vorleser brauchen den Namen am Feld selbst, nicht nur daneben.
    if (!control.hasAttribute("aria-label") && control.matches("input, select")) control.setAttribute("aria-label", label);

    return el("div", "row", el("div", "row__text", el("b", "", label), ...(hint ? [el("i", "", hint)] : [])), control);
}

function hint(text: string): HTMLElement {
    return el("p", "hintline", text);
}

/** Eine Karte im Bereich: Überschrift, ein Satz dazu, Inhalt. */
function card(title: string, lead: string, ...children: HTMLElement[]): HTMLElement {
    return el("section", "tkcard", el("h3", "tkcard__title", title), ...(lead ? [el("p", "tkcard__lead", lead)] : []), ...children);
}

function alert(text: string): HTMLElement {
    return el("div", "notice tkalert", icon("#i-warn"), el("span", "", text));
}

function select(
    entries: { value: string; label: string }[],
    active: string | null,
    onPick: (value: string | null) => void,
    empty = "— keine —"
): HTMLSelectElement {
    const picker = el("select", "pick", el("option", "", empty));

    (picker.firstElementChild as HTMLOptionElement).value = "";

    for (const entry of entries) {
        const option = el("option", "", entry.label);

        option.value = entry.value;
        picker.append(option);
    }

    picker.value = active ?? "";
    picker.addEventListener("change", () => onPick(picker.value || null));

    return picker;
}

// Wie CodeFrom() im Bot: die ersten drei Buchstaben des Namens, Umlaute ohne Punkte.
function codeFrom(name: string): string {
    return `${name.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "")}TKT`.slice(0, 3);
}

function field(value: string, placeholder: string, max: number, onInput: (value: string) => void): HTMLInputElement {
    const input = el("input", "text");

    input.type = "text";
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = max;
    input.addEventListener("input", () => onInput(input.value));

    return input;
}

function seg(options: [string, string][], active: string, onPick: (value: string) => void): HTMLElement {
    const box = el("div", "seg");

    box.setAttribute("role", "group");

    for (const [value, label] of options) {
        const button = el("button", "", label);

        button.type = "button";
        button.dataset.key = `seg:${value}`;
        button.setAttribute("aria-pressed", String(value === active));
        button.addEventListener("click", () => {
            if (value === active) return;

            clickSound("primary");
            onPick(value);
        });
        box.append(button);
    }

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
    let tab: Tab = TABS.find((entry) => `#${entry.hash}` === window.location.hash)?.id ?? "setup";
    // Welche Nachricht der Editor gerade zeigt: ein Schlüssel oder "option:<id>".
    let current = "panel";
    let panelChannel: string | null = null;
    // Welche Themen-Karten gerade aufgeklappt sind - übersteht das Neuzeichnen.
    const expanded = new Set<number>();

    const head = el("div", "tkhead");
    const tabs = el("div", "tktabs");
    const pane = el("div", "tkpane");
    const side = el("aside", "tkside");
    let editorHost: HTMLElement | null = null;

    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Bereiche des Ticket-Systems");
    pane.id = "tkPane";
    pane.setAttribute("role", "tabpanel");
    side.setAttribute("aria-label", "Live-Vorschau");

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    function touch(): void {
        dirty = true;
        bar.hidden = !canManage;
        saveButton.disabled = false;
        paintHead();
        paintTabs();
        paintPreview();
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
            panelChannel = data.panel?.channelId ?? config.panel.channelId;
            dirty = false;
            bar.hidden = true;
            warn(null);

            // Für die Bildauswahl und die Vorschau: die Galerie einmal holen.
            void loadGallery(guildId).then(() => paintPreview());

            paintAll();
        } catch {
            warn("Der Bot antwortet gerade nicht.");
        }
    }

    /* ------------------------------------------------------------
       Gerüst: Kopf, Tabs, Bereich, Vorschau
       ------------------------------------------------------------ */
    function paintAll(): void {
        if (!config || !data) return;

        host.replaceChildren(head, tabs, el("div", "tkgrid", pane, side));
        paintHead();
        paintTabs();
        paintPane();
        paintPreview();
    }

    // Kanal oder Forum-Beitrag (Log-Kanal) - beide stehen mit Namen da.
    function channelName(id: string | null): string {
        return [...data!.guild.channels, ...(data!.guild.threads ?? [])].find((entry) => entry.id === id)?.name ?? "unbekannt";
    }

    function paintHead(): void {
        const cfg = config!;
        const placed = data!.panel;
        const modmail = cfg.contact === "modmail";
        const { enabled, channelId } = cfg.transcripts;

        const stats: [Tab, string, string, string, string][] = [
            [
                "setup",
                modmail ? "#i-inbox" : "#i-message",
                "Modus",
                `${modmail ? "ModMail" : "Klassisch"} · ${cfg.surface === "forum" ? "Forum" : "Textkanal"}`,
                "",
            ],
            ["panel", "#i-layout", "Panel", placed ? `#${channelName(placed.channelId)}` : "nicht gesendet", placed ? "is-ok" : "is-warn"],
            ["topics", "#i-list-checks", "Themen", String(cfg.options.length), cfg.options.length ? "" : "is-warn"],
            [
                "setup",
                "#i-archive",
                "Transcripts",
                enabled ? (channelId ? `an · #${channelName(channelId)}` : "an") : "aus",
                enabled ? "is-ok" : "",
            ],
        ];

        head.replaceChildren(
            ...stats.map(([target, symbol, label, value, tone]) => {
                const button = el(
                    "button",
                    `tkstat ${tone}`.trim(),
                    el("span", "tkstat__mark", icon(symbol)),
                    el("span", "tkstat__text", el("small", "", label), el("b", "", value))
                );

                button.type = "button";
                button.title = `${label}: zu „${TABS.find((entry) => entry.id === target)!.label}“`;
                button.addEventListener("click", () => {
                    open(target);
                    document.getElementById(`tktab-${target}`)?.focus();
                });

                return button;
            })
        );
    }

    function paintTabs(): void {
        const cfg = config!;
        const optional = data!.actions.filter((action) => !action.core).length;
        const counts: Partial<Record<Tab, string>> = {
            topics: String(cfg.options.length),
            actions: `${cfg.actions.length}/${optional}`,
            blocked: data!.blacklist.length ? String(data!.blacklist.length) : "",
        };

        tabs.replaceChildren(
            ...TABS.map((entry) => {
                const button = el("button", "tktab", icon(entry.icon), el("span", "", entry.label));
                const count = counts[entry.id];

                if (count) button.append(el("span", "tktab__count", count));

                button.type = "button";
                button.id = `tktab-${entry.id}`;
                button.tabIndex = entry.id === tab ? 0 : -1;
                button.setAttribute("role", "tab");
                button.setAttribute("aria-selected", String(entry.id === tab));
                button.setAttribute("aria-controls", "tkPane");
                button.addEventListener("click", () => open(entry.id));

                return button;
            })
        );
    }

    // Pfeiltasten wechseln den Tab - wie bei jeder Tab-Leiste.
    tabs.addEventListener("keydown", (event) => {
        const index = TABS.findIndex((entry) => entry.id === tab);
        const next =
            event.key === "ArrowRight"
                ? (index + 1) % TABS.length
                : event.key === "ArrowLeft"
                  ? (index - 1 + TABS.length) % TABS.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? TABS.length - 1
                      : -1;

        if (next < 0) return;

        event.preventDefault();
        open(TABS[next].id);
        document.getElementById(`tktab-${TABS[next].id}`)?.focus();
    });

    function open(next: Tab): void {
        if (next !== tab) clickSound("primary");

        tab = next;
        history.replaceState(null, "", `${window.location.pathname}#${TABS.find((entry) => entry.id === next)!.hash}`);
        paintTabs();
        paintPane();
        paintPreview();
    }

    /** Zeichnet den offenen Bereich neu - der Fokus bleibt, wo er war (data-key). */
    function paintPane(): void {
        const key = (document.activeElement as HTMLElement | null)?.dataset?.key;

        pane.setAttribute("aria-labelledby", `tktab-${tab}`);
        pane.replaceChildren(
            ...(tab === "setup"
                ? setup()
                : tab === "topics"
                  ? topics()
                  : tab === "actions"
                    ? actions()
                    : tab === "messages"
                      ? messages()
                      : tab === "panel"
                        ? panel()
                        : blocked())
        );

        if (key) pane.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
    }

    function toggle(checked: boolean, label: string, key: string, onChange: (on: boolean) => void, disabled = false): HTMLInputElement {
        const box = el("input", "switch");

        box.type = "checkbox";
        box.checked = checked;
        box.disabled = disabled || !canManage;
        box.dataset.key = key;
        box.setAttribute("aria-label", label);
        box.addEventListener("change", () => onChange(box.checked));

        return box;
    }

    /** Große Auswahlkarten statt eines Umschalters - wer zum ersten Mal einrichtet, sieht, was er wählt. */
    function choice(
        legend: string,
        name: string,
        options: { value: string; symbol: string; title: string; tag?: string; text: string }[],
        active: string,
        onPick: (value: string) => void
    ): HTMLElement {
        const label = el("p", "tkchoice__label", legend);
        const list = el("div", "tkchoice__opts");

        label.id = `tkchoice-${name}`;
        list.setAttribute("role", "radiogroup");
        list.setAttribute("aria-labelledby", label.id);

        for (const option of options) {
            const on = option.value === active;
            const title = el("b", "", option.title);

            if (option.tag) title.append(el("span", "tkchoice__tag", option.tag));

            const button = el(
                "button",
                "tkchoice__opt",
                el("span", "tkchoice__mark", icon(option.symbol)),
                el("span", "tkchoice__text", title, el("span", "", option.text)),
                el("span", "tkchoice__check", icon("#i-check"))
            );

            button.type = "button";
            button.disabled = !canManage;
            button.tabIndex = on ? 0 : -1;
            button.dataset.key = `choice:${name}:${option.value}`;
            button.setAttribute("role", "radio");
            button.setAttribute("aria-checked", String(on));
            button.addEventListener("click", () => {
                if (option.value === active) return;

                clickSound("primary");
                onPick(option.value);
            });
            list.append(button);
        }

        list.addEventListener("keydown", (event) => {
            const buttons = [...list.querySelectorAll<HTMLButtonElement>("button")];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];

            if (index < 0 || step === undefined) return;

            event.preventDefault();

            // Erst fokussieren, dann wählen: das Neuzeichnen stellt den Fokus dorthin zurück.
            const next = buttons[(index + step + buttons.length) % buttons.length];

            next.focus();
            next.click();
        });

        return el("div", "tkchoice", label, list);
    }

    /* ------------------------------------------------------------
       Einrichtung
       ------------------------------------------------------------ */
    function setup(): HTMLElement[] {
        const cfg = config!;
        const resources = data!.guild;
        const modmail = cfg.contact === "modmail";

        const flow = card(
            "So läuft ein Ticket",
            "Zwei Entscheidungen – der Rest passt sich daran an.",
            choice(
                "Wie meldet sich der User?",
                "contact",
                [
                    {
                        value: "direct",
                        symbol: "#i-message",
                        title: "Im Server",
                        tag: "Klassisch",
                        text: "Ein Klick im Panel öffnet das Ticket – dort schreibt der User direkt mit dem Team.",
                    },
                    {
                        value: "modmail",
                        symbol: "#i-inbox",
                        title: "Per DM",
                        tag: "ModMail",
                        text: "Der User schreibt dem Bot. Die Team-Seite sieht er nie, Antworten kommen per DM.",
                    },
                ],
                cfg.contact,
                (value) => {
                    cfg.contact = value as IConfig["contact"];
                    touch();
                    paintPane();
                }
            ),
            choice(
                "Wo arbeitet das Team?",
                "surface",
                [
                    { value: "channel", symbol: "#i-hash", title: "Textkanal", text: "Ein privater Kanal je Ticket, in der Kategorie seines Themas." },
                    { value: "forum", symbol: "#i-forum", title: "Forum-Post", text: "Ein Post je Ticket – Tags zeigen Thema, Priorität und Status." },
                ],
                cfg.surface,
                (value) => {
                    cfg.surface = value as IConfig["surface"];
                    touch();
                    paintPane();
                }
            )
        );

        if (!modmail && cfg.surface === "forum") {
            flow.append(
                alert(
                    "Forum-Posts sieht jeder, der das Forum sehen darf – auch die Tickets anderer. Für vertrauliche Anliegen ist der Textkanal oder ModMail die bessere Wahl."
                )
            );
        }

        const role = select(
            resources.roles.map((entry) => ({ value: entry.id, label: `@${entry.name}` })),
            cfg.supportRoleId,
            (value) => {
                cfg.supportRoleId = value;
                touch();
            }
        );

        // Die 0 ("ohne Grenze", "nie") ist in beiden Menüs der leere erste
        // Eintrag von select() - stünde sie zusätzlich in der Liste, käme sie doppelt.
        const limit = select(
            Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
            cfg.limit === 0 ? null : String(cfg.limit),
            (value) => {
                cfg.limit = Number(value ?? 0);
                touch();
            },
            "ohne Grenze"
        );

        const team = card(
            "Team & Grenzen",
            "",
            row("Support-Rolle", "Sieht jedes Ticket und darf alle Aktionen", role),
            ...(cfg.surface === "forum"
                ? [
                      row(
                          "Forum",
                          "Hier entstehen die Ticket-Posts; Tags legt der Bot selbst an",
                          select(
                              resources.forums.map((forum) => ({ value: forum.id, label: `#${forum.name}` })),
                              cfg.forumId,
                              (value) => {
                                  cfg.forumId = value;
                                  touch();
                              },
                              "— Forum wählen —"
                          )
                      ),
                  ]
                : []),
            ...(modmail
                ? []
                : [
                      row(
                          "Themen im Panel",
                          "Als Knöpfe oder als Auswahlmenü",
                          seg(
                              [
                                  ["buttons", "Knöpfe"],
                                  ["select", "Auswahlmenü"],
                              ],
                              cfg.style,
                              (value) => {
                                  cfg.style = value as IConfig["style"];
                                  touch();
                                  paintPane();
                              }
                          )
                      ),
                  ]),
            row("Offene Tickets je User", "Wie viele einer gleichzeitig haben darf", limit)
        );

        const removal = select(
            DELETE_LABELS.filter(([hours]) => hours !== 0).map(([hours, label]) => ({ value: String(hours), label })),
            cfg.deleteAfter === 0 ? null : String(cfg.deleteAfter),
            (value) => {
                cfg.deleteAfter = Number(value ?? 0);
                touch();
            },
            "nie"
        );

        const { transcripts } = cfg;
        // Textkanal oder Beitrag in einem Forum - ein neuer Beitrag entsteht sofort.
        const log = logTargetSelect(
            resources,
            transcripts.channelId,
            (value) => {
                transcripts.channelId = value;
                touch();
            },
            async (forumId) => {
                const result = await send({ action: "logthread", forumId });
                const thread = (result?.thread ?? null) as ILogThread | null;

                if (thread) toast("info", "Beitrag angelegt", `„${thread.name}“ in #${thread.parentName} – speichern nicht vergessen.`);

                return thread;
            }
        );

        log.disabled = !transcripts.enabled || !canManage;

        const after = card(
            "Nach dem Schließen",
            "Was mit dem Kanal und dem Verlauf passiert.",
            row("Kanal löschen", "Forum-Posts verschwinden ebenfalls", removal),
            row(
                "Transcript speichern",
                "Der ganze Verlauf im Discord-Look – im Dashboard unter Transcriptions",
                toggle(transcripts.enabled, "Transcript speichern", "transcripts-enabled", (on) => {
                    transcripts.enabled = on;
                    touch();
                    paintPane();
                })
            ),
            row("Log-Kanal", "Karte mit Link und HTML-Datei für das Team – Textkanal oder Forum-Beitrag", log),
            row(
                "Kopie an den Ersteller",
                modmail ? "Bei ModMail nicht nötig – das Gespräch steht schon in seinen DMs" : "Per DM, mit Link und HTML-Datei",
                toggle(
                    transcripts.dm && !modmail,
                    "Kopie an den Ersteller",
                    "transcripts-dm",
                    (on) => {
                        transcripts.dm = on;
                        touch();
                    },
                    !transcripts.enabled || modmail
                )
            )
        );

        return [flow, team, after];
    }

    /* ------------------------------------------------------------
       Themen (Öffnungs-Optionen)
       ------------------------------------------------------------ */
    function topics(): HTMLElement[] {
        const cfg = config!;
        const list = el("div", "tktopics");

        cfg.options.forEach((option, index) => list.append(topic(option, index)));

        if (cfg.options.length === 0) {
            list.append(el("p", "tkempty", "Noch kein Thema – ohne Thema kann niemand ein Ticket öffnen."));
        }

        const full = cfg.options.length >= MAX_OPTIONS;
        const add = el("button", "tkadd", icon("#i-plus"), el("span", "", full ? "Mehr als 25 Themen gehen nicht" : "Thema hinzufügen"));

        add.type = "button";
        add.disabled = !canManage || full;
        add.addEventListener("click", () => {
            cfg.options.push({
                id: "",
                name: "Neues Thema",
                code: "",
                description: "",
                emoji: "🎫",
                categoryId: null,
                tagId: null,
                supportRoleId: null,
                opened: null,
            });
            touch();
            paintPane();

            const name = pane.querySelector<HTMLInputElement>(`[data-key="topic-name:${cfg.options.length - 1}"]`);

            name?.focus();
            name?.select();
        });

        return [
            hint(
                cfg.contact === "modmail"
                    ? "Bei ModMail fragt der Bot das Thema per DM ab – im Kanal steht nur der Knopf „Ticket per DM starten“. Die Reihenfolge hier ist die Reihenfolge in der DM."
                    : "Jedes Thema ist ein Knopf bzw. ein Eintrag im Panel. Die Reihenfolge hier ist die Reihenfolge dort."
            ),
            list,
            add,
        ];
    }

    function topic(option: IOption, index: number): HTMLElement {
        const cfg = config!;
        const resources = data!.guild;

        const picker = emojiPicker({
            value: option.emoji,
            emojis: resources.emojis,
            label: `Emoji für ${option.name || "dieses Thema"}`,
            onPick: (value) => {
                option.emoji = value;
                touch();
            },
        });

        picker.disabled = !canManage;
        picker.dataset.key = `topic-emoji:${index}`;

        // Das Kürzel der Ticket-IDs: SUP -> SUP-1, SUP-2 ... Leer nimmt der Bot es aus dem Namen.
        const code = field(option.code ?? "", codeFrom(option.name), 6, (value) => {
            const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");

            if (clean !== value) code.value = clean;

            option.code = clean;
            code.classList.toggle("is-bad", clean.length === 1);
            touch();
        });

        code.classList.add("tkcode__input");
        code.dataset.key = `topic-code:${index}`;
        code.disabled = !canManage;
        code.autocomplete = "off";
        code.spellcheck = false;
        code.title = "Kürzel für die Ticket-ID: SUP ergibt SUP-1, SUP-2 … – 2 bis 6 Buchstaben oder Ziffern. Leer: aus dem Namen.";
        code.setAttribute("aria-label", `Kürzel für die Ticket-IDs von Thema ${index + 1}`);

        const name = field(option.name, "Name des Themas", 80, (value) => {
            option.name = value;
            code.placeholder = codeFrom(value);
            touch();
        });

        name.dataset.key = `topic-name:${index}`;
        name.setAttribute("aria-label", `Name von Thema ${index + 1}`);

        const move = (delta: number, symbol: string, label: string): HTMLButtonElement => {
            const button = el("button", "iconbtn", icon(symbol));

            button.type = "button";
            button.title = label;
            button.dataset.key = `topic-move:${index}:${delta}`;
            button.setAttribute("aria-label", `${label}: ${option.name}`);
            button.disabled = !canManage || index + delta < 0 || index + delta >= cfg.options.length;
            button.addEventListener("click", () => {
                const [moved] = cfg.options.splice(index, 1);

                cfg.options.splice(index + delta, 0, moved);
                touch();
                paintPane();
                pane.querySelector<HTMLElement>(`[data-key="topic-move:${index + delta}:${delta}"]`)?.focus();
            });

            return button;
        };

        const remove = el("button", "iconbtn is-danger", icon("#i-trash"));

        remove.type = "button";
        remove.title = "Thema löschen";
        remove.disabled = !canManage;
        remove.setAttribute("aria-label", `Thema löschen: ${option.name}`);
        remove.addEventListener("click", () => {
            cfg.options.splice(index, 1);
            expanded.clear();
            touch();
            paintPane();
        });

        const description = field(option.description, "Kurze Beschreibung – steht im Auswahlmenü", 100, (value) => {
            option.description = value;
            touch();
        });

        description.dataset.key = `topic-description:${index}`;
        description.setAttribute("aria-label", `Beschreibung von Thema ${index + 1}`);

        // Was nicht jeder braucht, steht aufgeklappt - die Karte bleibt kurz.
        const badges: string[] = [];

        if (option.supportRoleId) badges.push("eigene Rolle");
        if (option.opened) badges.push("eigene Eröffnung");

        const more = el(
            "details",
            "tktopic__more",
            el(
                "summary",
                "",
                el("span", "", cfg.surface === "channel" ? "Kategorie, Rolle, Eröffnung" : "Forum-Tag, Rolle, Eröffnung"),
                ...badges.map((badge) => el("span", "tagline tagline--on", badge))
            )
        );

        more.open = expanded.has(index);
        more.addEventListener("toggle", () => (more.open ? expanded.add(index) : expanded.delete(index)));

        more.append(
            cfg.surface === "channel"
                ? row(
                      "Kategorie",
                      "Hier entstehen die Kanäle dieses Themas",
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
                : hint(option.tagId ? "Der Forum-Tag steht bereit." : "Der Forum-Tag entsteht beim Speichern."),
            row(
                "Eigene Support-Rolle",
                "Statt der allgemeinen – nur sie sieht diese Tickets",
                select(
                    resources.roles.map((role) => ({ value: role.id, label: `@${role.name}` })),
                    option.supportRoleId,
                    (value) => {
                        option.supportRoleId = value;
                        touch();
                        paintPane();
                    },
                    "— allgemeine Rolle —"
                )
            )
        );

        const own = toggle(option.opened !== null, "Eigene Eröffnungs-Nachricht", `topic-opened:${index}`, (on) => {
            option.opened = on ? structuredClone(cfg.messages.opened) : null;
            current = on ? `option:${option.id}` : "opened";
            touch();
            paintPane();
        });

        const ownRow = row("Eigene Eröffnungs-Nachricht", "Statt der allgemeinen – nur für dieses Thema", own);

        if (option.opened) {
            const edit = el("button", "btn btn--quiet tktopic__edit", icon("#i-message"), "Bearbeiten");

            edit.type = "button";
            edit.addEventListener("click", () => {
                current = `option:${option.id}`;
                open("messages");
            });
            ownRow.append(edit);
        }

        more.append(ownRow);

        return el(
            "article",
            "tktopic",
            el(
                "div",
                "tktopic__head",
                picker,
                name,
                el("label", "tkcode", el("span", "", "ID"), code),
                el("div", "tktopic__tools", move(-1, "#i-up", "Nach oben"), move(1, "#i-down", "Nach unten"), remove)
            ),
            description,
            more
        );
    }

    /* ------------------------------------------------------------
       Aktionen
       ------------------------------------------------------------ */
    function actions(): HTMLElement[] {
        const cfg = config!;
        const core = data!.actions.filter((action) => action.core);
        const optional = data!.actions.filter((action) => !action.core);
        const lead = el("p", "tkcard__lead");
        const count = (): void => {
            const on = optional.filter((action) => cfg.actions.includes(action.value)).length;

            lead.textContent = `${on} von ${optional.length} an – das Menü im Ticket zeigt nur, was hier an ist.`;
        };

        const grid = el("div", "tkacts");

        for (const action of optional) {
            const tile = el("label", `tkact${cfg.actions.includes(action.value) ? " is-on" : ""}`);
            const box = toggle(cfg.actions.includes(action.value), action.name, `action:${action.value}`, (on) => {
                cfg.actions = on ? [...cfg.actions, action.value] : cfg.actions.filter((entry) => entry !== action.value);
                tile.classList.toggle("is-on", on);
                count();
                touch();
            });

            tile.append(
                el("span", "tkact__mark", action.emoji),
                el("span", "tkact__text", el("b", "", action.name), el("span", "", action.description)),
                box
            );
            grid.append(tile);
        }

        count();

        const always = card(
            "Immer dabei",
            "Gehören fest zu jedem Ticket und lassen sich nicht abschalten.",
            el(
                "div",
                "tkcore",
                ...core.map((action) => {
                    const chip = el("span", "tkcore__chip", el("span", "tkcore__emoji", action.emoji), el("b", "", action.name), icon("#i-lock"));

                    chip.title = action.description;

                    return chip;
                })
            )
        );

        const extra = el("section", "tkcard", el("h3", "tkcard__title", "Zuschaltbar"), lead, grid);

        return [always, extra];
    }

    /* ------------------------------------------------------------
       Nachrichten
       ------------------------------------------------------------ */
    function messageKeys(): { value: string; label: string; custom: boolean }[] {
        const cfg = config!;
        // Nur, was beim gewählten Kontakt auch verschickt wird: ModMail hat sein
        // eigenes Panel und die Bestätigung per DM, Klassisch das normale Panel.
        const modmail = cfg.contact === "modmail";

        return [
            ...Object.keys(MESSAGE_LABELS)
                .filter((key) => (key === "dm" || key === "modmailPanel" ? modmail : key === "panel" ? !modmail : true))
                .map((key) => ({ value: key, label: MESSAGE_LABELS[key], custom: false })),
            ...cfg.options
                .filter((option) => option.opened)
                .map((option) => ({ value: `option:${option.id}`, label: `Eröffnung: ${option.name}`, custom: true })),
        ];
    }

    function docOf(key: string): IMessageDoc {
        const cfg = config!;

        if (key.startsWith("option:")) {
            const option = cfg.options.find((entry) => entry.id === key.slice(7));

            return option?.opened ?? cfg.messages.opened;
        }

        return cfg.messages[key] ?? cfg.messages.panel;
    }

    function labelOf(key: string): string {
        if (key.startsWith("option:")) return `Eröffnung: ${config!.options.find((entry) => entry.id === key.slice(7))?.name ?? "Thema"}`;

        return MESSAGE_LABELS[key] ?? key;
    }

    function messages(): HTMLElement[] {
        const keys = messageKeys();

        if (!keys.some((entry) => entry.value === current)) current = config!.contact === "modmail" ? "modmailPanel" : "panel";

        const list = el("div", "tkmsgs");

        list.setAttribute("role", "group");
        list.setAttribute("aria-label", "Welche Nachricht");

        for (const entry of keys) {
            const button = el("button", `tkmsg${entry.custom ? " is-custom" : ""}`, entry.label);

            button.type = "button";
            button.dataset.key = `message:${entry.value}`;
            button.setAttribute("aria-pressed", String(entry.value === current));
            button.addEventListener("click", () => {
                current = entry.value;
                paintPane();
                paintPreview();
            });
            list.append(button);
        }

        const about = hint(current.startsWith("option:") ? "Diese Eröffnung gilt nur für dieses Thema – sonst gilt die allgemeine." : MESSAGE_HINTS[current] ?? "");

        editorHost = el("div", "tkeditor");
        renderEditor(editorHost, docOf(current), context());

        return [list, about, editorHost];
    }

    /* ------------------------------------------------------------
       Panel
       ------------------------------------------------------------ */
    function panel(): HTMLElement[] {
        const placed = data!.panel;
        const same = placed !== null && panelChannel === placed.channelId;

        const status = el(
            "div",
            `tkplaced${placed ? " is-on" : ""}`,
            el("span", "tkplaced__mark", icon(placed ? "#i-check" : "#i-layout")),
            el(
                "div",
                "tkplaced__text",
                el("b", "", placed ? `Das Panel steht in #${channelName(placed.channelId)}` : "Noch kein Panel im Server"),
                el(
                    "span",
                    "",
                    placed
                        ? "Speichern zieht es automatisch nach. Es gibt immer nur ein Panel – auch ein vergessenes im Kanal ersetzt der Bot."
                        : "Wähle einen Kanal und schick es los."
                )
            )
        );

        if (placed) {
            const jump = el("a", "btn btn--quiet tkplaced__link", icon("#i-external"), "Zur Nachricht");

            jump.href = placed.url;
            jump.target = "_blank";
            jump.rel = "noopener";
            status.append(jump);
        }

        const picker = select(
            data!.guild.channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` })),
            panelChannel,
            (value) => {
                panelChannel = value;
                paintPane();
            },
            "— Kanal wählen —"
        );

        picker.dataset.key = "panel-channel";

        const explain = dirty
            ? "Speichere zuerst deine Änderungen – sonst schickt der Bot den alten Stand."
            : !panelChannel
              ? "Wähle einen Textkanal."
              : !placed
                ? `Der Bot schickt das Panel in #${channelName(panelChannel)}.`
                : same
                  ? "Der Bot bearbeitet die vorhandene Nachricht – ein zweites Panel gibt es nicht."
                  : `Das Panel zieht nach #${channelName(panelChannel)} um, die Nachricht in #${channelName(placed.channelId)} verschwindet.`;

        const sendButton = el("button", "btn btn--primary", icon(same ? "#i-refresh" : "#i-message"), !placed ? "Panel senden" : same ? "Panel aktualisieren" : "Hierher umziehen");

        sendButton.type = "button";
        sendButton.disabled = !canManage || !panelChannel || dirty;
        sendButton.addEventListener("click", async () => {
            if (!panelChannel) return;

            clickSound("primary");
            sendButton.disabled = true;

            const result = await send({ action: "panel", channelId: panelChannel });

            sendButton.disabled = false;

            if (result === null) return;

            const [title, text] = PANEL_TOASTS[String(result.state)] ?? PANEL_TOASTS.sent;

            toast("info", title, text);
            await load();
        });

        const removeButton = el("button", "btn btn--quiet is-danger", icon("#i-trash"), "Panel entfernen");

        removeButton.type = "button";
        removeButton.hidden = !placed;
        removeButton.disabled = !canManage;

        // Zweimal klicken: ein Panel ist schnell weg und nur mit einem neuen wieder da.
        let sure: ReturnType<typeof setTimeout> | null = null;

        removeButton.addEventListener("click", async () => {
            if (!sure) {
                removeButton.classList.add("is-sure");
                removeButton.lastChild!.textContent = "Wirklich entfernen?";
                sure = setTimeout(() => {
                    sure = null;
                    removeButton.classList.remove("is-sure");
                    removeButton.lastChild!.textContent = "Panel entfernen";
                }, 4000);

                return;
            }

            clearTimeout(sure);
            removeButton.disabled = true;

            if (await send({ action: "unpanel" })) {
                toast("info", "Panel entfernt", "Die Nachricht ist aus dem Kanal verschwunden.");
                await load();
            } else removeButton.disabled = false;
        });

        return [
            status,
            card(
                "Wohin damit",
                "",
                row("Kanal", "Ein Textkanal, den die User sehen", picker),
                el("p", `hintline${dirty ? " is-warn" : ""}`, explain),
                el("div", "tkpanelbar", sendButton, removeButton)
            ),
        ];
    }

    /* ------------------------------------------------------------
       Sperrliste
       ------------------------------------------------------------ */
    function blocked(): HTMLElement[] {
        if (data!.blacklist.length === 0) {
            return [
                el(
                    "div",
                    "tkempty tkempty--big",
                    icon("#i-shield-check"),
                    el("b", "", "Niemand ist gesperrt."),
                    el("span", "", "Gesperrt wird im Ticket über die Aktion „Benutzer sperren“. Die Liste hier hebt Sperren wieder auf.")
                ),
            ];
        }

        const list = el("div", "glist");

        for (const entry of data!.blacklist) {
            const unblock = el("button", "btn btn--quiet", "Entsperren");

            unblock.type = "button";
            unblock.disabled = !canManage;
            unblock.addEventListener("click", async () => {
                unblock.disabled = true;

                if (await send({ action: "unblock", userId: entry.userId })) {
                    toast("info", "Entsperrt", `${entry.name ?? entry.userId} kann wieder Tickets öffnen.`);
                    await load();
                }
            });

            list.append(
                el(
                    "div",
                    "grow",
                    el(
                        "div",
                        "grow__text",
                        el("b", "", entry.name ?? entry.userId),
                        el("span", "", `${entry.reason ?? "ohne Grund"} · gesperrt am ${new Date(entry.at).toLocaleDateString("de-DE")}`)
                    ),
                    unblock
                )
            );
        }

        return [list];
    }

    /* ------------------------------------------------------------
       Live-Vorschau
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
                "ticket.id": `${config!.options[0]?.code || "SUP"}-42`,
                "user.code": "U-7K3F",
                "ticket.option": config!.options[0]?.name ?? "Support",
                "ticket.priority": "Normal",
                "ticket.opened": "vor 2 Minuten",
                "ticket.claimer": "niemand",
                "support.role": role ? `@${role.name}` : "@Team",
                closer: `@${user.name}`,
                reason: "Erledigt",
                bot: "@RL Nexus",
            },
            roles: new Map(resources.roles.map((entry) => [entry.id, entry.name])),
            channels: new Map(resources.channels.map((entry) => [entry.id, entry.name])),
            emojis: resources.emojis,
            onChange: (structural?: boolean) => {
                touch();

                if (structural && editorHost) renderEditor(editorHost, docOf(current), context());
            },
        };
    }

    /** Was die Vorschau gerade zeigt: das Panel, die Eröffnung, die gewählte Nachricht. */
    function previewKey(): string {
        if (tab === "messages") return current;
        if (tab === "actions") return "opened";
        if (tab === "blocked") return "blacklisted";

        return config!.contact === "modmail" ? "modmailPanel" : "panel";
    }

    function paintPreview(): void {
        if (!config || !data) return;

        const key = previewKey();
        const body = el("div", "tkside__body");

        renderPreview(body, docOf(key), context(), mock(key));

        side.replaceChildren(
            el("div", "tkside__head", el("span", "tkside__live", "Live-Vorschau"), el("b", "", labelOf(key))),
            body,
            el("p", "tkside__foot", "Angedeutet wie in Discord – Knöpfe und Menüs lassen sich hier nicht anklicken.")
        );
    }

    /** Was unter der Nachricht steht: Themen, der DM-Knopf oder das Aktions-Menü. */
    function mock(key: string): HTMLElement | undefined {
        const cfg = config!;
        const emojis = data!.guild.emojis;

        if (key === "panel") {
            const box = el("div", "tkmock");

            if (cfg.style === "select") {
                box.append(el("div", "tkmock__select", "Worum geht es?"));
            } else {
                for (const option of cfg.options) {
                    box.append(el("span", "tkmock__btn", ...(option.emoji ? [emojiNode(option.emoji, emojis, "tkemoji")] : []), option.name));
                }
            }

            return box;
        }

        if (key === "modmailPanel") {
            return el("div", "tkmock", el("span", "tkmock__btn", "📬 Ticket per DM starten"));
        }

        if (key === "opened" || key.startsWith("option:")) {
            const chips = el("div", "tkmock__chips");

            for (const action of data!.actions.filter((entry) => entry.core || cfg.actions.includes(entry.value))) {
                chips.append(el("span", "tagline", `${action.emoji} ${action.name}`));
            }

            return el(
                "div",
                "tkmock",
                el("p", "tkmock__status", "🎫 #0042 · Support · ⏳ Wartet auf das Team"),
                el("div", "tkmock__select", "⚙️ | Aktion wählen …"),
                chips
            );
        }

        return undefined;
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
        toast("info", "Gespeichert", data.panel ? "Der Bot arbeitet ab sofort damit – das Panel ist schon nachgezogen." : "Der Bot arbeitet ab sofort damit.");
        paintAll();
    });

    resetButton.addEventListener("click", () => {
        if (!data) return;

        config = structuredClone(data.config);
        dirty = false;
        bar.hidden = true;
        paintAll();
    });

    void load();
}
