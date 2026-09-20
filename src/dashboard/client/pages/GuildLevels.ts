/**
 * Abschnitt: Level System.
 *
 * Oben die Zahlen, darunter drei Karten: Punkte (Chat, Voice, Kurve, Bonus,
 * Ausnahmen), Aufsteigen (Nachricht im Editor, Belohnungsrollen) und die
 * Rangliste samt Punkte-Verwaltung.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { toast } from "../core/Toast.js";
import { api, button, card, confirmButton, el, face, IRole, row, select, stat, toggle } from "../core/Ui.js";
import { LEVEL_IMAGES, LEVEL_PLACEHOLDERS } from "../constants/Placeholders.js";
import { IServerEmoji } from "../layout/EmojiPicker.js";
import { IEditorContext, IMessageDoc, renderEditor, renderPreview } from "../layout/MessageEditor.js";

interface IBonus {
    id: string;
    factor: number;
}

interface IReward {
    level: number;
    roleId: string;
}

interface ISettings {
    chat: { on: boolean; min: number; max: number; cooldown: number };
    voice: { on: boolean; xp: number; alone: boolean; muted: boolean };
    base: number;
    roleBonus: IBonus[];
    channelBonus: IBonus[];
    noChannels: string[];
    noRoles: string[];
    announce: "current" | "channel" | "dm" | "off";
    announceChannelId: string | null;
    message: IMessageDoc | null;
    rewards: IReward[];
    stack: boolean;
}

interface IRank {
    id: string;
    name: string;
    avatar: string | null;
    gone: boolean;
    rank: number;
    level: number;
    xp: number;
    into: number;
    need: number;
    messages: number;
    voiceMinutes: number;
}

interface IPerson {
    id: string;
    name: string;
    avatar: string;
}

interface IPayload {
    settings: ISettings;
    defaultMessage: IMessageDoc;
    limits: { rewards: number; bonus: number; excluded: number };
    page: number;
    total: number;
    top: IRank[];
    guild: { name: string; roles: IRole[]; channels: { id: string; name: string }[]; categories: { id: string; name: string }[]; emojis: IServerEmoji[] };
}

export function renderLevels(guildId: string): void {
    const host = need<HTMLElement>("#levelBody");
    const note = need<HTMLElement>("#levelNote");
    const call = api(`${BASE}/api/guild/${encodeURIComponent(guildId)}/levels`, note);

    let data: IPayload | null = null;
    let draft: ISettings | null = null;
    let dirty = false;
    let chosen: IPerson | null = null;
    let page = 1;

    const save = el("button", "btn btn--primary") as HTMLButtonElement;

    function touch(): void {
        dirty = true;
        save.disabled = false;
    }

    /* ------------------------------------------------------------
       Kopf
       ------------------------------------------------------------ */
    function head(): HTMLElement {
        const best = data!.top[0];

        return el(
            "div",
            "tkhead snhead",
            stat("#i-chart-up", "Mit Punkten", String(data!.total)),
            stat("#i-crown", "Spitze", best ? `${best.name} · Level ${best.level}` : "noch niemand"),
            stat("#i-message", "Chat-Punkte", draft!.chat.on ? `${draft!.chat.min}–${draft!.chat.max} alle ${draft!.chat.cooldown}s` : "aus", draft!.chat.on ? "is-ok" : ""),
            stat("#i-mic", "Voice-Punkte", draft!.voice.on ? `${draft!.voice.xp} je Minute` : "aus", draft!.voice.on ? "is-ok" : ""),
            stat("#i-badge", "Belohnungsrollen", String(draft!.rewards.length))
        );
    }

    /* ------------------------------------------------------------
       Punkte
       ------------------------------------------------------------ */
    function points(): HTMLElement {
        const settings = draft!;
        const num = (value: number, min: number, max: number, onChange: (value: number) => void, label: string): HTMLInputElement => {
            const input = el("input", "text gwnum");

            input.type = "number";
            input.min = String(min);
            input.max = String(max);
            input.value = String(value);
            input.setAttribute("aria-label", label);
            input.addEventListener("input", () => {
                onChange(Math.max(min, Math.min(max, Number(input.value) || 0)));
                touch();
            });

            return input;
        };

        const chatRange = el(
            "div",
            "lvrange",
            num(settings.chat.min, 0, 500, (value) => (settings.chat.min = value), "Punkte mindestens"),
            el("span", "lvrange__to", "bis"),
            num(settings.chat.max, 0, 500, (value) => (settings.chat.max = value), "Punkte höchstens")
        );

        return card(
            "Punkte",
            "Wie schnell es vorangeht. Die Punkte je Nachricht sind zufällig zwischen den beiden Werten – das macht Spam weniger berechenbar.",
            row(
                "Punkte für Nachrichten",
                "Nur alle paar Sekunden, sonst zählt jedes „k“",
                el("label", "snitem__switch", toggle(settings.chat.on, "Chat-Punkte", (on) => {
                    settings.chat.on = on;
                    touch();
                }), el("span", "", "an"))
            ),
            row("Punkte je Nachricht", "Zufällig zwischen beiden Werten", chatRange),
            row("Sperre", "So viele Sekunden zwischen zwei Nachrichten mit Punkten", num(settings.chat.cooldown, 0, 3600, (value) => (settings.chat.cooldown = value), "Sperre in Sekunden")),
            row(
                "Punkte für Voice",
                "Je angefangener Minute im Sprachkanal",
                el("label", "snitem__switch", toggle(settings.voice.on, "Voice-Punkte", (on) => {
                    settings.voice.on = on;
                    touch();
                }), el("span", "", "an"))
            ),
            row("Punkte je Minute", "0 schaltet sie faktisch ab", num(settings.voice.xp, 0, 500, (value) => (settings.voice.xp = value), "Punkte je Minute")),
            row(
                "Auch allein",
                "Sonst gibt es Punkte nur, wenn jemand anderes dabei ist",
                el("label", "snitem__switch", toggle(settings.voice.alone, "Auch allein", (on) => {
                    settings.voice.alone = on;
                    touch();
                }), el("span", "", "erlauben"))
            ),
            row(
                "Auch stumm",
                "Sonst zählt nicht, wer sich selbst stumm geschaltet hat",
                el("label", "snitem__switch", toggle(settings.voice.muted, "Auch stumm", (on) => {
                    settings.voice.muted = on;
                    touch();
                }), el("span", "", "erlauben"))
            ),
            row(
                "Kurve",
                `Level 1 braucht ${settings.base} Punkte, Level 10 insgesamt ${(settings.base * 10 * 11) / 2}`,
                num(settings.base, 10, 1000, (value) => {
                    settings.base = value;
                    paint();
                }, "Punkte je Stufe")
            ),
            bonusBox("Rollen mit Bonus", "Der höchste Faktor einer Rolle zählt", settings.roleBonus, data!.guild.roles.map((role) => [role.id, `@${role.name}`])),
            bonusBox("Kanäle mit Bonus", "Etwa doppelte Punkte im Vorstellungs-Kanal", settings.channelBonus, data!.guild.channels.map((channel) => [channel.id, `# ${channel.name}`])),
            listBox("Ohne Punkte: Kanäle", settings.noChannels, [
                ...data!.guild.channels.map((channel): [string, string] => [channel.id, `# ${channel.name}`]),
                ...data!.guild.categories.map((category): [string, string] => [category.id, `📁 ${category.name}`]),
            ]),
            listBox("Ohne Punkte: Rollen", settings.noRoles, data!.guild.roles.map((role) => [role.id, `@${role.name}`]))
        );
    }

    /** Eine Liste „Eintrag + Faktor" mit Hinzufügen und Entfernen. */
    function bonusBox(label: string, hint: string, list: IBonus[], options: [string, string][]): HTMLElement {
        const box = el("div", "lvbonus");
        const draw = (): void => {
            box.replaceChildren();

            for (const entry of list) {
                const name = options.find(([id]) => id === entry.id)?.[1] ?? entry.id;
                const factor = el("input", "text lvfactor");
                const remove = button("btn btn--quiet btn--icon", icon("#i-x"));

                factor.type = "number";
                factor.min = "0.1";
                factor.max = "5";
                factor.step = "0.1";
                factor.value = String(entry.factor);
                factor.setAttribute("aria-label", `Faktor für ${name}`);
                factor.addEventListener("input", () => {
                    entry.factor = Math.max(0.1, Math.min(5, Number(factor.value) || 1));
                    touch();
                });

                remove.title = "Entfernen";
                remove.addEventListener("click", () => {
                    list.splice(list.indexOf(entry), 1);
                    touch();
                    draw();
                });

                box.append(el("div", "lvbonus__row", el("span", "lvbonus__name", name), el("span", "lvbonus__x", "×"), factor, remove));
            }

            const pick = select(
                [["", "— hinzufügen —"], ...options.filter(([id]) => !list.some((entry) => entry.id === id))],
                "",
                (value) => {
                    if (!value) return;

                    list.push({ id: value, factor: 2 });
                    touch();
                    draw();
                },
                `${label} hinzufügen`
            );

            pick.disabled = list.length >= data!.limits.bonus;
            box.append(pick);
        };

        draw();

        return row(label, hint, box);
    }

    /** Eine reine Auswahl-Liste (Kanäle oder Rollen ohne Punkte). */
    function listBox(label: string, list: string[], options: [string, string][]): HTMLElement {
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

            pick.disabled = list.length >= data!.limits.excluded;
            box.append(pick);
        };

        draw();

        return row(label, "Hier sammelt niemand Punkte", box);
    }

    /* ------------------------------------------------------------
       Aufsteigen
       ------------------------------------------------------------ */
    function levelUp(): HTMLElement {
        const settings = draft!;
        const editorHost = el("div", "");
        const preview = el("div", "tkprev");
        const doc = (): IMessageDoc => {
            settings.message ??= structuredClone(data!.defaultMessage);

            return settings.message;
        };
        const values: Record<string, string> = Object.fromEntries(LEVEL_PLACEHOLDERS.map((entry) => [entry.key, entry.sample]));
        const context = (): IEditorContext => ({
            guildId,
            values,
            roles: new Map(data!.guild.roles.map((role) => [role.id, role.name])),
            channels: new Map(data!.guild.channels.map((channel) => [channel.id, channel.name])),
            emojis: data!.guild.emojis,
            placeholders: LEVEL_PLACEHOLDERS,
            imagePlaceholders: LEVEL_IMAGES,
            onChange: () => {
                touch();
                paintPreview();
            },
        });
        const paintPreview = (): void => renderPreview(preview, doc(), context());

        renderEditor(editorHost, doc(), context());
        paintPreview();

        const reset = button("btn btn--quiet sneditor__reset", icon("#i-refresh"), "Vorlage");

        reset.title = "Die Nachricht auf die Vorlage zurücksetzen";
        reset.addEventListener("click", () => {
            settings.message = structuredClone(data!.defaultMessage);
            touch();
            renderEditor(editorHost, doc(), context());
            paintPreview();
        });

        const where = select(
            [
                ["current", "Im Kanal, in dem es passiert"],
                ["channel", "In einem festen Kanal"],
                ["dm", "Als Direktnachricht"],
                ["off", "Gar nicht"],
            ],
            settings.announce,
            (value) => {
                settings.announce = value as ISettings["announce"];
                touch();
                paint();
            },
            "Wohin die Aufstiegs-Nachricht geht"
        );

        const target = select(
            [["", "— Kanal wählen —"], ...data!.guild.channels.map((channel): [string, string] => [channel.id, `# ${channel.name}`])],
            settings.announceChannelId ?? "",
            (value) => {
                settings.announceChannelId = value || null;
                touch();
            },
            "Kanal für die Aufstiegs-Nachricht"
        );

        target.disabled = settings.announce !== "channel";

        return card(
            "Aufsteigen",
            "Was passiert, wenn jemand ein Level schafft.",
            row("Nachricht", "Im Kanal, an einer festen Stelle oder per DM", where),
            row("Fester Kanal", "Nur nötig für „In einem festen Kanal“", target),
            ...(settings.announce === "off"
                ? []
                : [
                      el("div", "sneditor", el("div", "sneditor__main", el("div", "sneditor__bar", el("h4", "sneditor__title", "Die Nachricht"), reset), placeholderHint(), editorHost), el("aside", "sneditor__side", el("div", "tkside__head", el("span", "tkside__live", "Live-Vorschau")), preview)),
                  ]),
            rewardBox()
        );
    }

    function placeholderHint(): HTMLElement {
        const chips = el("div", "phhint__list");

        for (const entry of LEVEL_PLACEHOLDERS) {
            const chip = el("span", "phchip", el("code", "", `{${entry.key}}`), el("span", "phchip__label", entry.label));

            chip.title = `Beispiel: ${entry.sample}`;
            chips.append(chip);
        }

        return el("div", "phhint", el("p", "hintline phhint__lead", "Diese Platzhalter setzt der Bot beim Senden ein:"), chips);
    }

    /** Rollen ab Level X. */
    function rewardBox(): HTMLElement {
        const settings = draft!;
        const box = el("div", "lvrewards");
        const draw = (): void => {
            box.replaceChildren();

            for (const reward of settings.rewards) {
                const role = data!.guild.roles.find((entry) => entry.id === reward.roleId);
                const level = el("input", "text gwnum");
                const remove = button("btn btn--quiet btn--icon", icon("#i-x"));

                level.type = "number";
                level.min = "1";
                level.max = "999";
                level.value = String(reward.level);
                level.setAttribute("aria-label", `Ab welchem Level für ${role?.name ?? reward.roleId}`);
                level.addEventListener("input", () => {
                    reward.level = Math.max(1, Math.min(999, Number(level.value) || 1));
                    touch();
                });

                remove.title = "Entfernen";
                remove.addEventListener("click", () => {
                    settings.rewards.splice(settings.rewards.indexOf(reward), 1);
                    touch();
                    draw();
                });

                box.append(el("div", "lvreward", el("span", "lvreward__lead", "ab Level"), level, el("span", "lvreward__role", `@${role?.name ?? "gelöschte Rolle"}`), remove));
            }

            const pick = select(
                [["", "— Rolle hinzufügen —"], ...data!.guild.roles.filter((role) => !settings.rewards.some((reward) => reward.roleId === role.id)).map((role): [string, string] => [role.id, `@${role.name}`])],
                "",
                (value) => {
                    if (!value) return;

                    settings.rewards.push({ level: (settings.rewards.at(-1)?.level ?? 0) + 5, roleId: value });
                    touch();
                    draw();
                },
                "Belohnungsrolle hinzufügen"
            );

            pick.disabled = settings.rewards.length >= data!.limits.rewards;
            box.append(pick);
        };

        draw();

        const sync = button("btn btn--quiet", icon("#i-refresh"), "Rollen nachtragen");

        sync.title = "Vergibt fehlende Belohnungsrollen an alle, die das Level schon haben";
        sync.addEventListener("click", async () => {
            sync.disabled = true;

            const answer = await call<{ touched: number }>("", { action: "sync" });

            sync.disabled = false;

            if (answer) toast("info", "Nachgetragen", `${answer.touched} Mitglied(er) geprüft.`);
        });

        return el(
            "div",
            "lvrewardbox",
            row("Belohnungsrollen", `Bis ${data!.limits.rewards} Stück – die Rolle muss unter der höchsten Rolle des Bots stehen`, box),
            row(
                "Alte behalten",
                "Aus heißt: die neue Rolle ersetzt die vorherige",
                el("label", "snitem__switch", toggle(settings.stack, "Alte behalten", (on) => {
                    settings.stack = on;
                    touch();
                }), el("span", "", "sammeln"))
            ),
            el("div", "mcsave", sync)
        );
    }

    /* ------------------------------------------------------------
       Rangliste
       ------------------------------------------------------------ */
    function board(): HTMLElement {
        const rows = data!.top.map((entry) =>
            el(
                "div",
                `plrow vcrow${entry.rank <= 3 ? " is-top" : ""}`,
                el("span", "lvplace", `#${entry.rank}`),
                face({ name: entry.name, avatar: entry.avatar }, "travatar"),
                el(
                    "div",
                    "plrow__main",
                    el("div", "plrow__top", el("b", "", entry.name), ...(entry.gone ? [el("span", "chip", "nicht mehr da")] : [])),
                    el("span", "gwrow__facts", `Level ${entry.level} · ${entry.xp.toLocaleString("de-DE")} Punkte · ${entry.messages} Nachrichten · ${entry.voiceMinutes} Min. Voice`)
                ),
                el("div", "plbars", el("div", "plbar", el("span", "plbar__label", `${entry.into} / ${entry.need}`), el("span", "plbar__track", el("span", "plbar__fill", "")), el("span", "plbar__value", `L${entry.level + 1}`)))
            )
        );

        for (const [index, node] of rows.entries()) {
            const fill = node.querySelector<HTMLElement>(".plbar__fill");
            const entry = data!.top[index];

            if (fill) fill.style.width = `${entry.need > 0 ? Math.round((entry.into / entry.need) * 100) : 100}%`;
        }

        const prev = button("btn btn--quiet", icon("#i-up"), "Zurück");
        const next = button("btn btn--quiet", icon("#i-down"), "Weiter");

        prev.disabled = page <= 1;
        next.disabled = data!.top.length < 25;
        prev.addEventListener("click", () => load(page - 1));
        next.addEventListener("click", () => load(page + 1));

        return card(
            "Rangliste",
            `${data!.total} Mitglieder haben Punkte. In Discord zeigt /level rangliste dieselbe Liste.`,
            ...(rows.length ? rows : [el("div", "tkempty", icon("#i-chart-up"), el("span", "", "Noch hat niemand Punkte."))]),
            el("div", "mcsave lvpager", prev, next)
        );
    }

    /* ------------------------------------------------------------
       Punkte von Hand
       ------------------------------------------------------------ */
    function manage(): HTMLElement {
        const amount = el("input", "text gwnum");
        const mode = select(
            [
                ["set", "setzen auf"],
                ["add", "dazugeben"],
            ],
            "set",
            () => undefined,
            "Was mit den Punkten passieren soll"
        );
        const go = button("btn btn--primary", icon("#i-check"), "Übernehmen");
        const pickHost = el("div", "snperson");
        const drawPick = (): void => {
            pickHost.replaceChildren(
                personPicker(chosen, (person) => {
                    chosen = person;
                    drawPick();
                })
            );
        };

        amount.type = "number";
        amount.min = "-1000000";
        amount.max = "1000000";
        amount.value = "0";
        amount.setAttribute("aria-label", "Punkte");

        drawPick();

        go.addEventListener("click", async () => {
            if (!chosen) {
                toast("info", "Niemand gewählt", "Such zuerst ein Mitglied.");

                return;
            }

            go.disabled = true;

            const answer = await call("", { action: "adjust", userId: chosen.id, mode: mode.value, amount: Number(amount.value) || 0 });

            go.disabled = false;

            if (!answer) return;

            toast("info", "Punkte geändert", `${chosen.name} steht jetzt anders da.`);
            load(page);
        });

        const wipe = confirmButton("btn btn--quiet", "#i-trash", "Punkte zurücksetzen", "Wirklich? Damit sind alle Punkte dieses Mitglieds weg.", async () => {
            if (!chosen) {
                toast("info", "Niemand gewählt", "Such zuerst ein Mitglied.");

                return;
            }

            const answer = await call("", { action: "adjust", userId: chosen.id, mode: "reset" });

            if (answer) {
                toast("info", "Zurückgesetzt", `${chosen.name} fängt wieder bei null an.`);
                load(page);
            }
        });

        const clear = confirmButton("btn btn--quiet btn--danger", "#i-eraser", "Ganze Rangliste löschen", "Wirklich? Danach hat niemand mehr Punkte – das lässt sich nicht rückgängig machen.", async () => {
            const answer = await call("", { action: "reset" });

            if (answer) {
                toast("info", "Rangliste gelöscht", "Alle fangen wieder bei null an.");
                load(1);
            }
        });

        return card(
            "Punkte von Hand",
            "Für Umzüge, Fehler und kleine Belohnungen. Belohnungsrollen zieht der Bot dabei nach.",
            row("Mitglied", "Nach Name oder ID suchen", pickHost),
            row("Punkte", "Setzen oder dazugeben – negative Zahlen ziehen ab", el("div", "lvrange", mode, amount, go)),
            el("div", "mcsave", clear, wipe)
        );
    }

    function personPicker(current: IPerson | null, onPick: (person: IPerson | null) => void): HTMLElement {
        if (current) {
            const change = button("btn btn--quiet mcchosen__change", "Ändern");

            change.addEventListener("click", () => onPick(null));

            return el("div", "mcchosen", face(current, "mcchosen__face"), el("div", "mcchosen__name", el("b", "", current.name), el("code", "mcid", current.id)), change);
        }

        const input = el("input", "text");
        const results = el("div", "mcpeople");
        let asked = 0;
        let timer = 0;

        input.type = "search";
        input.placeholder = "Mitglied suchen: Name oder ID …";
        input.setAttribute("aria-label", "Mitglied suchen");
        input.addEventListener("input", () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(async () => {
                const text = input.value.trim();

                if (!text) {
                    results.replaceChildren();

                    return;
                }

                const mine = ++asked;
                const answer = await call<{ members?: IPerson[] }>("", { action: "members", query: text });

                if (mine !== asked) return;

                const found = answer?.members ?? [];

                results.replaceChildren(
                    ...(found.length
                        ? found.map((person) => {
                              const pick = button("ltperson", face(person), el("span", "", person.name));

                              pick.addEventListener("click", () => onPick(person));

                              return pick;
                          })
                        : [el("span", "tkempty", "Niemand gefunden.")])
                );
            }, 250);
        });

        return el("div", "mcpick", input, results);
    }

    /* ------------------------------------------------------------
       Zeichnen und Laden
       ------------------------------------------------------------ */
    function paint(): void {
        if (!data || !draft) return;

        save.replaceChildren(icon("#i-check"), document.createTextNode("Speichern"));
        save.disabled = !dirty;

        host.replaceChildren(head(), points(), levelUp(), el("div", "mcsave lvsave", save), board(), manage());
    }

    save.addEventListener("click", async () => {
        save.disabled = true;

        const answer = await call<{ settings: ISettings }>("", { action: "save", settings: draft });

        if (!answer) {
            save.disabled = false;

            return;
        }

        data!.settings = answer.settings;
        draft = structuredClone(answer.settings);
        dirty = false;
        toast("info", "Gespeichert", "Gilt ab der nächsten Nachricht.");
        paint();
    });

    function load(next: number): void {
        page = Math.max(1, next);

        void call<IPayload>(`?page=${page}`).then((answer) => {
            if (!answer) return;

            data = answer;
            draft ??= structuredClone(answer.settings);
            paint();
        });
    }

    host.replaceChildren(el("div", "tkhead", ...Array.from({ length: 5 }, () => el("div", "sb snskel"))));
    load(1);
}
