/**
 * Abschnitt: Custom Message.
 *
 * Zwei Reiter: eigene Nachrichten (Editor, Knöpfe, Termin, senden und später
 * ändern) und Stichwörter, auf die der Bot von selbst antwortet.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { ago } from "../core/Format.js";
import { toast } from "../core/Toast.js";
import { api, button, card, confirmButton, el, IRole, localInput, row, select, stat, toggle, WHEN } from "../core/Ui.js";
import { IServerEmoji } from "../layout/EmojiPicker.js";
import { IEditorContext, IMessageDoc, renderEditor, renderPreview } from "../layout/MessageEditor.js";

type Tab = "messages" | "responses";

interface IButton {
    id: string;
    label: string;
    emoji: string | null;
    tone: "primary" | "secondary" | "success" | "danger";
    action: "role" | "link" | "text";
    roleId: string | null;
    mode: "toggle" | "add" | "remove";
    url: string | null;
    text: string | null;
}

interface ISchedule {
    mode: "off" | "once" | "daily" | "weekly";
    at: number | null;
    hour: number;
    minute: number;
    weekday: number;
    next: number | null;
    replace: boolean;
}

interface IMessage {
    id: number;
    name: string;
    doc: IMessageDoc;
    buttons: IButton[];
    channelId: string | null;
    channelName: string | null;
    messageId: string | null;
    url: string | null;
    schedule: ISchedule;
    updatedAt: number;
}

interface IResponse {
    id: number;
    phrase: string;
    match: "contains" | "exact" | "starts" | "regex";
    doc: IMessageDoc;
    settings: { reply: boolean; delete: boolean; quiet: boolean; cooldown: number; channels: string[]; roles: string[]; ignoreRoles: string[] };
    enabled: boolean;
    uses: number;
}

interface IPayload {
    messages: IMessage[];
    responses: IResponse[];
    limits: { messages: number; responses: number; buttons: number };
    defaults: { message: IMessageDoc; response: IMessageDoc };
    weekdays: string[];
    matches: Record<string, string>;
    guild: { name: string; roles: IRole[]; channels: { id: string; name: string }[]; emojis: IServerEmoji[] };
}

const TONES: [string, string][] = [
    ["secondary", "Grau"],
    ["primary", "Blau"],
    ["success", "Grün"],
    ["danger", "Rot"],
];

export function renderMessages(guildId: string): void {
    const host = need<HTMLElement>("#messageBody");
    const note = need<HTMLElement>("#messageNote");
    const call = api(`${BASE}/api/guild/${encodeURIComponent(guildId)}/messages`, note);

    let data: IPayload | null = null;
    let tab: Tab = "messages";
    let open: number | null = null;
    let openResponse: number | null = null;
    const drafts = new Map<number, IMessage>();
    const responseDrafts = new Map<number, IResponse>();

    const context = (extra: Record<string, string> = {}): IEditorContext => ({
        guildId,
        values: { user: "@du", "user.name": "du", guild: data!.guild.name, ...extra },
        roles: new Map(data!.guild.roles.map((role) => [role.id, role.name])),
        channels: new Map(data!.guild.channels.map((channel) => [channel.id, channel.name])),
        emojis: data!.guild.emojis,
        onChange: () => undefined,
    });

    /* ------------------------------------------------------------
       Kopf
       ------------------------------------------------------------ */
    function head(): HTMLElement {
        const planned = data!.messages.filter((message) => message.schedule.next).length;
        const sent = data!.messages.filter((message) => message.messageId).length;

        return el(
            "div",
            "tkhead snhead",
            stat("#i-layout", "Nachrichten", `${data!.messages.length} / ${data!.limits.messages}`),
            stat("#i-message", "Gesendet", String(sent)),
            stat("#i-clock", "Geplant", String(planned), planned ? "is-ok" : ""),
            stat("#i-bot", "Stichwörter", `${data!.responses.length} / ${data!.limits.responses}`)
        );
    }

    function tabs(): HTMLElement {
        const box = el("div", "seg plkinds");

        box.setAttribute("role", "group");
        box.setAttribute("aria-label", "Was bearbeiten");

        for (const [value, label] of [["messages", "Nachrichten"], ["responses", "Stichwörter"]] as [Tab, string][]) {
            const entry = button("", label);

            entry.setAttribute("aria-pressed", String(tab === value));
            entry.addEventListener("click", () => {
                tab = value;
                paint();
            });
            box.append(entry);
        }

        return box;
    }

    /* ------------------------------------------------------------
       Nachrichten
       ------------------------------------------------------------ */
    function draftOf(message: IMessage): IMessage {
        let draft = drafts.get(message.id);

        if (!draft) {
            draft = structuredClone(message);
            drafts.set(message.id, draft);
        }

        return draft;
    }

    function messageItem(message: IMessage): HTMLElement {
        const isOpen = open === message.id;
        const edit = button("btn btn--quiet snitem__edit", icon(isOpen ? "#i-up" : "#i-sliders"), isOpen ? "Zuklappen" : "Bearbeiten");

        edit.addEventListener("click", () => {
            open = isOpen ? null : message.id;
            paint();
        });

        const when = message.schedule.next ? `nächste ${WHEN.format(new Date(message.schedule.next))}` : message.messageId ? `gesendet, zuletzt geändert ${ago(message.updatedAt)}` : "noch nicht gesendet";
        const box = el(
            "div",
            `snitem${isOpen ? " is-open" : ""}`,
            el(
                "div",
                "snitem__head",
                el("div", "snitem__face", icon("#i-layout")),
                el(
                    "div",
                    "snitem__name",
                    el("b", "", message.name),
                    el("span", "", `${message.channelName ? `# ${message.channelName}` : "kein Kanal"} · ${when}`)
                ),
                ...(message.url ? [linkButton(message.url)] : []),
                edit,
                confirmButton("btn btn--quiet btn--icon", "#i-trash", "Nachricht löschen", "Wirklich? Die Vorlage ist dann weg – die gesendete Nachricht bleibt stehen.", async () => {
                    const answer = await call("", { action: "delete", id: message.id, withMessage: false });

                    if (!answer) return;

                    data!.messages = data!.messages.filter((entry) => entry.id !== message.id);
                    drafts.delete(message.id);
                    toast("info", "Gelöscht", "Die Vorlage ist weg.");
                    paint();
                })
            )
        );

        if (isOpen) box.append(messageBody(message));

        return box;
    }

    function linkButton(url: string): HTMLElement {
        const link = el("a", "btn btn--quiet btn--icon", icon("#i-external"));

        link.href = url;
        link.target = "_blank";
        link.rel = "noopener";
        link.title = "In Discord ansehen";

        return link;
    }

    function messageBody(message: IMessage): HTMLElement {
        const draft = draftOf(message);
        const saveButton = button("btn btn--primary", icon("#i-check"), "Speichern");
        const editorHost = el("div", "");
        const preview = el("div", "tkprev");
        const touch = (): void => {
            saveButton.disabled = false;
        };
        const paintPreview = (): void => renderPreview(preview, draft.doc, context(), buttonPreview(draft));

        saveButton.disabled = true;

        const name = el("input", "text");

        name.type = "text";
        name.value = draft.name;
        name.maxLength = 80;
        name.setAttribute("aria-label", "Name der Nachricht");
        name.addEventListener("input", () => {
            draft.name = name.value;
            touch();
        });

        const channel = select(
            [["", "— Kanal wählen —"], ...data!.guild.channels.map((entry): [string, string] => [entry.id, `# ${entry.name}`])],
            draft.channelId ?? "",
            (value) => {
                draft.channelId = value || null;
                touch();
            },
            "Kanal für die Nachricht"
        );

        renderEditor(editorHost, draft.doc, { ...context(), onChange: () => {
            touch();
            paintPreview();
        } });
        paintPreview();

        saveButton.addEventListener("click", async () => {
            saveButton.disabled = true;

            const answer = await call<{ message: IMessage }>("", { action: "save", id: message.id, message: draft });

            if (!answer) {
                saveButton.disabled = false;

                return;
            }

            const index = data!.messages.findIndex((entry) => entry.id === message.id);

            data!.messages[index] = answer.message;
            drafts.delete(message.id);
            toast("info", "Gespeichert", answer.message.messageId ? "Die gesendete Nachricht wurde gleich mit geändert." : "Gilt beim nächsten Senden.");
            paint();
        });

        const send = button("btn btn--quiet", icon("#i-message"), message.messageId ? "Neu senden" : "Jetzt senden");

        send.addEventListener("click", async () => {
            send.disabled = true;

            const answer = await call<{ message: IMessage }>("", { action: "send", id: message.id });

            send.disabled = false;

            if (!answer) return;

            const index = data!.messages.findIndex((entry) => entry.id === message.id);

            data!.messages[index] = answer.message;
            toast("info", "Gesendet", "Sie steht jetzt im Kanal.");
            paint();
        });

        return el(
            "div",
            "snitem__body",
            el(
                "div",
                "snsettings",
                row("Name", "Nur für euch – in Discord steht er nicht", name),
                row("Kanal", "Wohin die Nachricht geht", channel)
            ),
            scheduleBox(draft, touch),
            el(
                "div",
                "sneditor",
                el("div", "sneditor__main", el("div", "sneditor__bar", el("h4", "sneditor__title", "Inhalt")), editorHost, buttonBox(draft, touch, paintPreview)),
                el("aside", "sneditor__side", el("div", "tkside__head", el("span", "tkside__live", "Live-Vorschau")), preview)
            ),
            el("div", "mcsave snitem__foot", send, saveButton)
        );
    }

    /** Die Knöpfe als Zeilen: Beschriftung, Aktion, Ziel. */
    function buttonBox(draft: IMessage, touch: () => void, paintPreview: () => void): HTMLElement {
        const box = el("div", "cmbuttons");
        const draw = (): void => {
            box.replaceChildren();

            for (const entry of draft.buttons) {
                const label = el("input", "text cmbtn__label");
                const remove = button("btn btn--quiet btn--icon", icon("#i-x"));
                const target = el("div", "cmbtn__target");

                label.type = "text";
                label.value = entry.label;
                label.maxLength = 80;
                label.placeholder = "Beschriftung";
                label.setAttribute("aria-label", "Beschriftung des Knopfes");
                label.addEventListener("input", () => {
                    entry.label = label.value;
                    touch();
                    paintPreview();
                });

                const action = select(
                    [
                        ["role", "Rolle geben/nehmen"],
                        ["link", "Link öffnen"],
                        ["text", "Text nur für den Klickenden"],
                    ],
                    entry.action,
                    (value) => {
                        entry.action = value as IButton["action"];
                        touch();
                        draw();
                        paintPreview();
                    },
                    "Was der Knopf tut"
                );

                const tone = select(TONES, entry.tone, (value) => {
                    entry.tone = value as IButton["tone"];
                    touch();
                    paintPreview();
                }, "Farbe des Knopfes");

                if (entry.action === "role") {
                    target.append(
                        select(
                            [["", "— Rolle —"], ...data!.guild.roles.map((role): [string, string] => [role.id, `@${role.name}`])],
                            entry.roleId ?? "",
                            (value) => {
                                entry.roleId = value || null;
                                touch();
                            },
                            "Rolle"
                        ),
                        select(
                            [
                                ["toggle", "an/aus"],
                                ["add", "nur geben"],
                                ["remove", "nur nehmen"],
                            ],
                            entry.mode,
                            (value) => {
                                entry.mode = value as IButton["mode"];
                                touch();
                            },
                            "Was mit der Rolle passiert"
                        )
                    );
                } else {
                    const field = el("input", "text");

                    field.type = entry.action === "link" ? "url" : "text";
                    field.value = (entry.action === "link" ? entry.url : entry.text) ?? "";
                    field.placeholder = entry.action === "link" ? "https://…" : "Was nur der Klickende liest";
                    field.setAttribute("aria-label", entry.action === "link" ? "Ziel-Link" : "Versteckter Text");
                    field.addEventListener("input", () => {
                        if (entry.action === "link") entry.url = field.value;
                        else entry.text = field.value;

                        touch();
                    });
                    target.append(field);
                }

                remove.title = "Knopf entfernen";
                remove.addEventListener("click", () => {
                    draft.buttons.splice(draft.buttons.indexOf(entry), 1);
                    touch();
                    draw();
                    paintPreview();
                });

                box.append(el("div", "cmbtn", label, action, ...(entry.action === "link" ? [] : [tone]), target, remove));
            }

            const add = button("btn btn--quiet", icon("#i-plus"), "Knopf hinzufügen");

            add.disabled = draft.buttons.length >= data!.limits.buttons;
            add.addEventListener("click", () => {
                draft.buttons.push({
                    id: String(Date.now()).slice(-6),
                    label: "Knopf",
                    emoji: null,
                    tone: "secondary",
                    action: "role",
                    roleId: null,
                    mode: "toggle",
                    url: null,
                    text: null,
                });
                touch();
                draw();
                paintPreview();
            });

            box.append(add);
        };

        draw();

        return el("div", "cmbuttonbox", el("h4", "sneditor__title vctitle", "Knöpfe"), el("p", "hintline", `Bis ${data!.limits.buttons} Stück, je fünf in einer Reihe.`), box);
    }

    /** Die Knöpfe in der Vorschau - nur zum Ansehen. */
    function buttonPreview(draft: IMessage): HTMLElement | undefined {
        if (!draft.buttons.length) return undefined;

        const box = el("div", "tkprev__buttons");

        for (const entry of draft.buttons) {
            box.append(el("span", `tkprev__btn is-${entry.action === "link" ? "link" : entry.tone}`, entry.label || "Knopf"));
        }

        return box;
    }

    /** Termin: einmalig, täglich, wöchentlich. */
    function scheduleBox(draft: IMessage, touch: () => void): HTMLElement {
        const schedule = draft.schedule;
        const box = el("div", "cmschedule");
        const draw = (): void => {
            box.replaceChildren();

            const mode = select(
                [
                    ["off", "Von Hand"],
                    ["once", "Einmal zu einem Zeitpunkt"],
                    ["daily", "Jeden Tag"],
                    ["weekly", "Jede Woche"],
                ],
                schedule.mode,
                (value) => {
                    schedule.mode = value as ISchedule["mode"];
                    touch();
                    draw();
                },
                "Wann die Nachricht rausgeht"
            );

            box.append(row("Termin", "Von Hand heißt: nur auf Knopfdruck", mode));

            if (schedule.mode === "once") {
                const at = el("input", "text gwstart");

                at.type = "datetime-local";
                at.value = localInput(schedule.at ?? Date.now() + 3_600_000);
                at.setAttribute("aria-label", "Zeitpunkt");
                at.addEventListener("input", () => {
                    schedule.at = new Date(at.value).getTime() || null;
                    touch();
                });

                box.append(row("Zeitpunkt", "Deine Uhrzeit", at));
            }

            if (schedule.mode === "daily" || schedule.mode === "weekly") {
                const time = el("input", "text gwnum");

                time.type = "time";
                time.value = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
                time.setAttribute("aria-label", "Uhrzeit");
                time.addEventListener("input", () => {
                    const [hour, minute] = time.value.split(":");

                    schedule.hour = Number(hour) || 0;
                    schedule.minute = Number(minute) || 0;
                    touch();
                });

                box.append(row("Uhrzeit", "Jeden Tag zu dieser Zeit", time));

                if (schedule.mode === "weekly") {
                    box.append(
                        row(
                            "Wochentag",
                            "An diesem Tag geht sie raus",
                            select(
                                data!.weekdays.map((day, index): [string, string] => [String(index), day]),
                                String(schedule.weekday),
                                (value) => {
                                    schedule.weekday = Number(value);
                                    touch();
                                },
                                "Wochentag"
                            )
                        )
                    );
                }

                box.append(
                    row(
                        "Alte löschen",
                        "Die vorherige Nachricht verschwindet, bevor die neue kommt",
                        el("label", "snitem__switch", toggle(schedule.replace, "Alte löschen", (on) => {
                            schedule.replace = on;
                            touch();
                        }), el("span", "", "ersetzen"))
                    )
                );
            }

            if (schedule.next) box.append(el("p", "hintline", `Als Nächstes: ${WHEN.format(new Date(schedule.next))}`));
        };

        draw();

        return box;
    }

    function newMessage(): HTMLElement {
        const name = el("input", "text snadd__input");
        const go = button("btn btn--primary snadd__go", icon("#i-plus"), "Anlegen");

        name.type = "text";
        name.placeholder = "Name der Nachricht – etwa „Regeln“";
        name.maxLength = 80;
        name.setAttribute("aria-label", "Name der neuen Nachricht");
        go.disabled = data!.messages.length >= data!.limits.messages;
        go.addEventListener("click", async () => {
            if (!name.value.trim()) {
                toast("info", "Kein Name", "Gib der Nachricht einen Namen.");

                return;
            }

            go.disabled = true;

            const answer = await call<{ message: IMessage }>("", { action: "create", message: { name: name.value.trim(), doc: data!.defaults.message, buttons: [], schedule: { mode: "off" } } });

            go.disabled = false;

            if (!answer) return;

            data!.messages.unshift(answer.message);
            open = answer.message.id;
            toast("info", "Angelegt", "Jetzt Inhalt schreiben und senden.");
            paint();
        });

        return card("Neue Nachricht", "Erst anlegen, dann schreiben. Gesendet wird sie erst, wenn ihr es sagt.", el("div", "snadd__row", icon("#i-layout"), name, go));
    }

    /* ------------------------------------------------------------
       Stichwörter
       ------------------------------------------------------------ */
    function responseItem(response: IResponse): HTMLElement {
        const isOpen = openResponse === response.id;
        const edit = button("btn btn--quiet snitem__edit", icon(isOpen ? "#i-up" : "#i-sliders"), isOpen ? "Zuklappen" : "Bearbeiten");

        edit.addEventListener("click", () => {
            openResponse = isOpen ? null : response.id;
            paint();
        });

        const box = el(
            "div",
            `snitem${isOpen ? " is-open" : ""}${response.enabled ? "" : " is-paused"}`,
            el(
                "div",
                "snitem__head",
                el("div", "snitem__face", icon("#i-bot")),
                el("div", "snitem__name", el("b", "", response.phrase), el("span", "", `${data!.matches[response.match]} · ${response.uses}× ausgelöst`)),
                el("label", "snitem__switch", toggle(response.enabled, `${response.phrase} an oder aus`, async (on) => {
                    const answer = await call<{ response: IResponse }>("", { action: "response-save", id: response.id, response: { ...response, enabled: on } });

                    if (answer) {
                        response.enabled = on;
                        toast("info", on ? "An" : "Aus", on ? "Der Bot antwortet wieder." : "Der Bot lässt es liegen.");
                        paint();
                    }
                }), el("span", "", response.enabled ? "an" : "aus")),
                edit,
                confirmButton("btn btn--quiet btn--icon", "#i-trash", "Stichwort löschen", "Wirklich? Der Bot antwortet darauf nicht mehr.", async () => {
                    const answer = await call("", { action: "response-delete", id: response.id });

                    if (!answer) return;

                    data!.responses = data!.responses.filter((entry) => entry.id !== response.id);
                    responseDrafts.delete(response.id);
                    toast("info", "Gelöscht", "Das Stichwort ist weg.");
                    paint();
                })
            )
        );

        if (isOpen) box.append(responseBody(response));

        return box;
    }

    function responseBody(response: IResponse): HTMLElement {
        let draft = responseDrafts.get(response.id);

        if (!draft) {
            draft = structuredClone(response);
            responseDrafts.set(response.id, draft);
        }

        const current = draft;
        const saveButton = button("btn btn--primary", icon("#i-check"), "Speichern");
        const editorHost = el("div", "");
        const preview = el("div", "tkprev");
        const touch = (): void => {
            saveButton.disabled = false;
        };
        const paintPreview = (): void => renderPreview(preview, current.doc, context());

        saveButton.disabled = true;

        const phrase = el("input", "text");

        phrase.type = "text";
        phrase.value = current.phrase;
        phrase.maxLength = 200;
        phrase.setAttribute("aria-label", "Stichwort");
        phrase.addEventListener("input", () => {
            current.phrase = phrase.value;
            touch();
        });

        const cooldown = el("input", "text gwnum");

        cooldown.type = "number";
        cooldown.min = "0";
        cooldown.max = "3600";
        cooldown.value = String(current.settings.cooldown);
        cooldown.setAttribute("aria-label", "Sperre in Sekunden");
        cooldown.addEventListener("input", () => {
            current.settings.cooldown = Math.max(0, Math.min(3600, Number(cooldown.value) || 0));
            touch();
        });

        renderEditor(editorHost, current.doc, { ...context(), onChange: () => {
            touch();
            paintPreview();
        } });
        paintPreview();

        saveButton.addEventListener("click", async () => {
            saveButton.disabled = true;

            const answer = await call<{ response: IResponse }>("", { action: "response-save", id: response.id, response: current });

            if (!answer) {
                saveButton.disabled = false;

                return;
            }

            const index = data!.responses.findIndex((entry) => entry.id === response.id);

            data!.responses[index] = answer.response;
            responseDrafts.delete(response.id);
            toast("info", "Gespeichert", "Gilt ab der nächsten Nachricht.");
            paint();
        });

        return el(
            "div",
            "snitem__body",
            el(
                "div",
                "snsettings",
                row("Stichwort", "Worauf der Bot reagiert", phrase),
                row(
                    "Vergleich",
                    "Wie genau es passen muss",
                    select(
                        Object.entries(data!.matches).map(([value, label]): [string, string] => [value, label]),
                        current.match,
                        (value) => {
                            current.match = value as IResponse["match"];
                            touch();
                        },
                        "Art des Vergleichs"
                    )
                ),
                row(
                    "Als Antwort",
                    "Sonst schreibt der Bot einfach in den Kanal",
                    el("label", "snitem__switch", toggle(current.settings.reply, "Als Antwort", (on) => {
                        current.settings.reply = on;
                        touch();
                    }), el("span", "", "antworten"))
                ),
                row(
                    "Leise",
                    "Antwortet ohne Benachrichtigung",
                    el("label", "snitem__switch", toggle(current.settings.quiet, "Leise antworten", (on) => {
                        current.settings.quiet = on;
                        touch();
                    }), el("span", "", "leise"))
                ),
                row(
                    "Auslöser löschen",
                    "Die Nachricht, die es ausgelöst hat, verschwindet",
                    el("label", "snitem__switch", toggle(current.settings.delete, "Auslöser löschen", (on) => {
                        current.settings.delete = on;
                        touch();
                    }), el("span", "", "löschen"))
                ),
                row("Sperre", "So viele Sekunden, bis dasselbe Stichwort wieder zieht", cooldown),
                filterBox("Nur in diesen Kanälen", current.settings.channels, data!.guild.channels.map((channel) => [channel.id, `# ${channel.name}`]), touch),
                filterBox("Nur für diese Rollen", current.settings.roles, data!.guild.roles.map((role) => [role.id, `@${role.name}`]), touch),
                filterBox("Nie für diese Rollen", current.settings.ignoreRoles, data!.guild.roles.map((role) => [role.id, `@${role.name}`]), touch)
            ),
            el(
                "div",
                "sneditor",
                el("div", "sneditor__main", el("div", "sneditor__bar", el("h4", "sneditor__title", "Antwort")), el("p", "hintline", "{user} und {user.name} setzt der Bot ein."), editorHost),
                el("aside", "sneditor__side", el("div", "tkside__head", el("span", "tkside__live", "Live-Vorschau")), preview)
            ),
            el("div", "mcsave snitem__foot", saveButton)
        );
    }

    function filterBox(label: string, list: string[], options: [string, string][], touch: () => void): HTMLElement {
        const box = el("div", "lvbonus");
        const draw = (): void => {
            box.replaceChildren();

            for (const id of list) {
                const chip = button("phchip", el("span", "", options.find(([entry]) => entry === id)?.[1] ?? id), icon("#i-x"));

                chip.title = "Entfernen";
                chip.addEventListener("click", () => {
                    list.splice(list.indexOf(id), 1);
                    touch();
                    draw();
                });
                box.append(chip);
            }

            const pick = select(
                [["", "— hinzufügen —"], ...options.filter(([id]) => !list.includes(id))],
                "",
                (value) => {
                    if (!value) return;

                    list.push(value);
                    touch();
                    draw();
                },
                `${label} hinzufügen`
            );

            pick.disabled = list.length >= 15;
            box.append(pick);
        };

        draw();

        return row(label, "Leer heißt überall", box);
    }

    function newResponse(): HTMLElement {
        const phrase = el("input", "text snadd__input");
        const go = button("btn btn--primary snadd__go", icon("#i-plus"), "Anlegen");

        phrase.type = "text";
        phrase.placeholder = "Stichwort – etwa „wann ist training“";
        phrase.maxLength = 200;
        phrase.setAttribute("aria-label", "Neues Stichwort");
        go.disabled = data!.responses.length >= data!.limits.responses;
        go.addEventListener("click", async () => {
            if (!phrase.value.trim()) {
                toast("info", "Kein Stichwort", "Schreib hin, worauf der Bot reagieren soll.");

                return;
            }

            go.disabled = true;

            const answer = await call<{ response: IResponse }>("", { action: "response-add", response: { phrase: phrase.value.trim(), match: "contains", doc: data!.defaults.response } });

            go.disabled = false;

            if (!answer) return;

            data!.responses.push(answer.response);
            openResponse = answer.response.id;
            toast("info", "Angelegt", "Jetzt die Antwort schreiben.");
            paint();
        });

        return card("Neues Stichwort", "Der Bot liest mit und antwortet, sobald es passt. Regex geht auch.", el("div", "snadd__row", icon("#i-bot"), phrase, go));
    }

    /* ------------------------------------------------------------
       Zeichnen und Laden
       ------------------------------------------------------------ */
    function paint(): void {
        if (!data) return;

        const list =
            tab === "messages"
                ? el(
                      "div",
                      "snlist",
                      ...(data.messages.length
                          ? data.messages.map(messageItem)
                          : [el("div", "tkempty tkempty--big", icon("#i-layout"), el("b", "", "Noch keine Nachricht."), el("span", "", "Leg oben eine an – Inhalt und Knöpfe kommen danach."))])
                  )
                : el(
                      "div",
                      "snlist",
                      ...(data.responses.length
                          ? data.responses.map(responseItem)
                          : [el("div", "tkempty tkempty--big", icon("#i-bot"), el("b", "", "Noch kein Stichwort."), el("span", "", "Etwa „discord link“ – der Bot antwortet dann von selbst."))])
                  );

        host.replaceChildren(head(), tabs(), tab === "messages" ? newMessage() : newResponse(), list);
    }

    host.replaceChildren(el("div", "tkhead", ...Array.from({ length: 4 }, () => el("div", "sb snskel"))));

    void call<IPayload>("").then((answer) => {
        if (!answer) return;

        data = answer;
        paint();
    });
}
