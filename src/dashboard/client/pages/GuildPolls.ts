/**
 * Abschnitt: Umfragen.
 *
 * Oben die Zahlen, darunter zwei Bereiche: die Liste (laufend und beendet,
 * mit Balken - ein Klick öffnet eine Umfrage groß, samt wer was gewählt hat)
 * und "Neue Umfrage": eigene mit Knöpfen oder Discords eigene, mit Vorschau.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { ago } from "../core/Format.js";
import { ILogTargets, ILogThread, logTargetSelect } from "../core/LogTarget.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { api, button, card, confirmButton, DURATIONS, el, face, IRole, pingSelect, rolePicker, row, select, stat, toggle, WHEN } from "../core/Ui.js";
import { emojiNode, emojiPicker, IServerEmoji } from "../layout/EmojiPicker.js";

type Kind = "buttons" | "native";

interface IOption {
    id: string;
    label: string;
    emoji: string | null;
}

interface ISettings {
    multi: boolean;
    maxChoices: number;
    anonymous: boolean;
    results: "live" | "voted" | "end";
    roles: string[];
    ping: string | null;
    accent: string | null;
}

interface IPoll {
    id: number;
    number: number;
    kind: Kind;
    channelId: string;
    url: string | null;
    question: string;
    description: string | null;
    options: IOption[];
    settings: ISettings;
    status: "open" | "ended";
    createdAt: number;
    endsAt: number | null;
    endedAt: number | null;
    counts: Record<string, number>;
    voters: number;
}

interface IPayload {
    polls: IPoll[];
    limits: { options: number; own: number; native: number; nativeHours: number };
    guild: { name: string; roles: IRole[]; emojis: IServerEmoji[] };
    targets: ILogTargets;
}

interface IDetail {
    poll: IPoll;
    voters: { option: string; id: string; name: string; avatar: string | null }[];
}

const NATIVE_DURATIONS = DURATIONS.filter(([seconds]) => seconds >= 3_600 && seconds <= 2_764_800);

function total(poll: IPoll): number {
    return Object.values(poll.counts).reduce((sum, count) => sum + count, 0);
}

/** Die Balken einer Umfrage - dieselbe Rechnung wie die Karte in Discord. */
function bars(poll: IPoll, limit = poll.options.length): HTMLElement {
    const sum = total(poll);
    const best = Math.max(0, ...poll.options.map((option) => poll.counts[option.id] ?? 0));
    const ranked = [...poll.options].sort((a, b) => (poll.counts[b.id] ?? 0) - (poll.counts[a.id] ?? 0)).slice(0, limit);
    const shown = limit < poll.options.length ? ranked : poll.options;

    return el(
        "div",
        "plbars",
        ...shown.map((option) => {
            const count = poll.counts[option.id] ?? 0;
            const share = sum ? count / sum : 0;
            const fill = el("span", "plbar__fill");

            fill.style.width = `${Math.round(share * 100)}%`;

            return el(
                "div",
                `plbar${count === best && best > 0 ? " is-top" : ""}`,
                el("span", "plbar__label", ...(option.emoji && !option.emoji.startsWith("<") ? [`${option.emoji} `] : []), option.label),
                el("span", "plbar__track", fill),
                el("span", "plbar__value", `${count} · ${Math.round(share * 100)} %`)
            );
        })
    );
}

export function renderPolls(guildId: string): void {
    const host = need<HTMLElement>("#pollBody");
    const note = need<HTMLElement>("#pollNote");
    const call = api(`${BASE}/api/guild/${encodeURIComponent(guildId)}/polls`, note);

    let data: IPayload | null = null;
    let tab: "list" | "new" = "list";

    const draft = {
        kind: "buttons" as Kind,
        question: "",
        description: "",
        options: [
            { label: "", emoji: null as string | null },
            { label: "", emoji: null as string | null },
        ],
        settings: { multi: false, maxChoices: 0, anonymous: false, results: "live", roles: [], ping: null, accent: null } as ISettings,
        duration: 86_400 as number | null,
        channelId: null as string | null,
    };

    /* ------------------------------------------------------------
       Gerüst
       ------------------------------------------------------------ */
    const head = el("div", "tkhead");
    const tabs = el("div", "tktabs");
    const pane = el("div", "tkpane");

    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Bereiche der Umfragen");

    function paintHead(): void {
        const polls = data!.polls;
        const open = polls.filter((poll) => poll.status === "open");
        const votes = polls.reduce((sum, poll) => sum + total(poll), 0);

        head.replaceChildren(
            stat("#i-list-checks", "Laufend", String(open.length), open.length ? "is-ok" : ""),
            stat("#i-archive", "Beendet", String(polls.length - open.length)),
            stat("#i-users", "Stimmen gesamt", String(votes)),
            stat("#i-stats", "Zuletzt", polls[0] ? `#${polls[0].number} · ${ago(polls[0].createdAt)}` : "noch keine")
        );
    }

    function paintTabs(): void {
        const entries: ["list" | "new", string, string][] = [
            ["list", "#i-list-checks", "Umfragen"],
            ["new", "#i-plus", "Neue Umfrage"],
        ];

        tabs.replaceChildren(
            ...entries.map(([id, symbol, label]) => {
                const knob = button("tktab", icon(symbol), el("span", "", label));

                knob.setAttribute("role", "tab");
                knob.setAttribute("aria-selected", String(id === tab));
                knob.addEventListener("click", () => {
                    if (tab === id) return;

                    clickSound("primary");
                    tab = id;
                    paint();
                });

                if (id === "list" && data!.polls.length) knob.append(el("span", "tktab__count", String(data!.polls.length)));

                return knob;
            })
        );
    }

    function paint(): void {
        if (!data) return;

        paintHead();
        paintTabs();
        pane.replaceChildren(...(tab === "list" ? list() : form()));
    }

    /* ------------------------------------------------------------
       Liste
       ------------------------------------------------------------ */
    function status(poll: IPoll): HTMLElement {
        if (poll.status === "ended") return el("span", "mcstate is-ended", `beendet ${poll.endedAt ? ago(poll.endedAt) : ""}`.trim());

        return el("span", "mcstate is-ok", poll.endsAt ? `läuft · endet ${WHEN.format(poll.endsAt)}` : "läuft · ohne Ende");
    }

    function list(): HTMLElement[] {
        if (!data!.polls.length) {
            const go = button("btn btn--primary", icon("#i-plus"), "Erste Umfrage");

            go.addEventListener("click", () => {
                tab = "new";
                paint();
            });

            return [
                el(
                    "div",
                    "tkempty tkempty--big",
                    icon("#i-list-checks"),
                    el("b", "", "Noch keine Umfrage."),
                    el("span", "", "Eigene Umfragen mit Balken und anonymen Stimmen – oder Discords eigene. Auch per /umfrage."),
                    go
                ),
            ];
        }

        return [
            el(
                "div",
                "pllist",
                ...data!.polls.map((poll) => {
                    const item = button(
                        `plrow${poll.status === "ended" ? " is-ended" : ""}`,
                        el("span", "mcb mcb--info", icon("#i-list-checks")),
                        el(
                            "span",
                            "plrow__main",
                            el("span", "plrow__top", el("b", "", poll.question), el("span", "mcrow__num", `#${poll.number}`), el("span", "tagline", poll.kind === "native" ? "Discord" : "Knöpfe"), status(poll)),
                            bars(poll, 3)
                        ),
                        el("span", "mcrow__side", el("span", "", `${total(poll)} Stimmen`), el("time", "", ago(poll.createdAt)))
                    );

                    item.setAttribute("aria-label", `Umfrage ${poll.number}: ${poll.question}`);
                    item.addEventListener("click", () => void view(poll.number));

                    return item;
                })
            ),
        ];
    }

    /* ------------------------------------------------------------
       Eine Umfrage groß
       ------------------------------------------------------------ */
    const title = el("h2", "", "");
    const sub = el("p", "", "");
    const body = el("div", "modal__body plview__body");
    const close = button("iconbtn modal__x", icon("#i-x"));
    const dialog = el("dialog", "modal plview", el("div", "modal__head", el("span", "mcb mcb--info", icon("#i-list-checks")), el("div", "mcview__title", title, sub), close), body);

    title.id = "plViewTitle";
    dialog.setAttribute("aria-labelledby", "plViewTitle");
    close.autofocus = true;
    close.setAttribute("aria-label", "Schließen");
    document.body.append(dialog);

    const hide = (): void => {
        if (dialog.open) dialog.close();
    };

    close.addEventListener("click", hide);
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) hide();
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            hide();
        }
    });

    async function view(number: number): Promise<void> {
        const detail = await call<IDetail>(`?poll=${number}`);

        if (!detail) return;

        const { poll, voters } = detail;

        title.textContent = poll.question;
        sub.textContent = `Umfrage #${poll.number} · ${poll.kind === "native" ? "Discord-Umfrage" : "eigene Umfrage"} · gestartet ${WHEN.format(poll.createdAt)}`;

        const actions = el("div", "mcsave plview__acts");

        if (poll.url) {
            const link = el("a", "btn btn--quiet", icon("#i-external"), "In Discord öffnen");

            link.href = poll.url;
            link.target = "_blank";
            link.rel = "noopener";
            actions.append(link);
        }

        if (poll.status === "open") {
            actions.append(
                confirmButton("btn btn--quiet", "#i-lock", "Jetzt beenden", "Wirklich beenden?", async () => {
                    if (await call("", { action: "end", number: poll.number })) {
                        toast("info", "Beendet", `Umfrage #${poll.number} ist zu – das Ergebnis steht in Discord.`);
                        await reload();
                        await view(poll.number);
                    }
                })
            );
        }

        actions.append(
            confirmButton("btn btn--quiet is-danger", "#i-trash", "Löschen", "Wirklich löschen?", async () => {
                if (await call("", { action: "delete", number: poll.number })) {
                    hide();
                    toast("info", "Gelöscht", `Umfrage #${poll.number} ist weg – auch die Nachricht in Discord.`);
                    await reload();
                }
            })
        );

        const facts = el(
            "div",
            "plview__facts",
            status(poll),
            el("span", "tagline", poll.settings.multi ? (poll.settings.maxChoices ? `bis zu ${poll.settings.maxChoices} Antworten` : "Mehrfachauswahl") : "eine Antwort"),
            ...(poll.settings.anonymous ? [el("span", "tagline", "anonym")] : []),
            el("span", "tagline", `${total(poll)} Stimmen${poll.voters ? ` von ${poll.voters} Personen` : ""}`)
        );

        const who =
            poll.kind === "native"
                ? el("p", "hintline", "Bei Discord-Umfragen zählt Discord – wer was gewählt hat, steht in Discord selbst.")
                : poll.settings.anonymous
                  ? el("p", "hintline", "Anonym – wer was gewählt hat, sieht niemand, auch nicht hier.")
                  : el(
                        "div",
                        "plvoters",
                        ...poll.options.map((option) => {
                            const people = voters.filter((vote) => vote.option === option.id);

                            return el(
                                "section",
                                "mcside",
                                el("h3", "mcside__title", `${option.label} · ${people.length}`),
                                people.length
                                    ? el("div", "plvoters__list", ...people.slice(0, 60).map((person) => el("span", "ltperson plvoter", face(person), el("span", "", person.name))))
                                    : el("p", "mcmuted", "Noch niemand.")
                            );
                        })
                    );

        body.replaceChildren(facts, ...(poll.description ? [el("p", "plview__desc", poll.description)] : []), bars(poll), who, actions);

        if (!dialog.open) dialog.showModal();
    }

    /* ------------------------------------------------------------
       Neue Umfrage
       ------------------------------------------------------------ */
    const preview = el("div", "tkside__body");

    function paintPreview(): void {
        const options = draft.options.filter((option) => option.label.trim());

        if (draft.kind === "native") {
            preview.replaceChildren(
                el(
                    "div",
                    "plnative",
                    el("b", "plnative__q", draft.question || "Deine Frage"),
                    el("span", "plnative__hint", draft.settings.multi ? "Wähle eine oder mehrere Antworten" : "Wähle eine Antwort"),
                    ...(options.length ? options : [{ label: "Antwort", emoji: null }]).map((option) =>
                        el("span", "plnative__opt", ...(option.emoji ? [emojiNode(option.emoji, data!.guild.emojis, "tkemoji")] : []), option.label)
                    ),
                    el("span", "plnative__foot", `0 Stimmen · ${draft.duration ? `noch ${DURATIONS.find(([seconds]) => seconds === draft.duration)?.[1] ?? ""}` : ""}`)
                )
            );

            return;
        }

        const accent = draft.settings.accent ?? "#00afff";
        const prev = el(
            "div",
            "tkprev",
            el("h2", "", `📊 ${draft.question || "Deine Frage"}`),
            ...(draft.description ? [el("p", "", draft.description)] : []),
            el("p", "tkprev__small", `Umfrage #${(data!.polls[0]?.number ?? 0) + 1} · ${draft.settings.multi ? "mehrere Antworten" : "eine Antwort"}${draft.settings.anonymous ? " · anonym" : ""}`),
            el("div", "tkprev__sep"),
            ...(options.length ? options : [{ label: "Antwort", emoji: null }]).map((option) =>
                el(
                    "div",
                    "plprev__opt",
                    el("b", "", ...(option.emoji ? [emojiNode(option.emoji, data!.guild.emojis, "tkemoji"), " "] : []), option.label),
                    ...(draft.settings.results === "live" ? [el("span", "plprev__bar", "░░░░░░░░░░░░ 0 · 0 %")] : [])
                )
            ),
            el(
                "div",
                "tkmock",
                ...(options.length ? options : [{ label: "Antwort", emoji: null }]).map((option) =>
                    el("span", "tkmock__btn", ...(option.emoji ? [emojiNode(option.emoji, data!.guild.emojis, "tkemoji")] : []), option.label)
                )
            )
        );

        prev.style.setProperty("--accent", accent);
        preview.replaceChildren(prev);
    }

    function form(): HTMLElement[] {
        const own = draft.kind === "buttons";
        const limits = data!.limits;

        // Art: zwei große Karten.
        const kinds = el("div", "tkchoice__opts plkinds");

        kinds.setAttribute("role", "radiogroup");
        kinds.setAttribute("aria-label", "Art der Umfrage");

        for (const [value, symbol, name, text] of [
            ["buttons", "#i-list-checks", "Eigene Umfrage", "Knöpfe und Balken im RL-Nexus-Look. Anonym möglich, nur für bestimmte Rollen, auch ohne Ende."],
            ["native", "#i-message", "Discord-Umfrage", "Discords eigene Umfrage. Discord zählt, läuft eine Stunde bis 32 Tage, Stimmen sichtbar."],
        ] as [Kind, string, string, string][]) {
            const option = button("tkchoice__opt", el("span", "tkchoice__mark", icon(symbol)), el("span", "tkchoice__text", el("b", "", name), el("span", "", text)));

            option.setAttribute("role", "radio");
            option.setAttribute("aria-checked", String(draft.kind === value));
            option.addEventListener("click", () => {
                if (draft.kind === value) return;

                draft.kind = value;

                if (value === "native" && (!draft.duration || draft.duration < 3_600)) draft.duration = 86_400;

                paint();
            });
            kinds.append(option);
        }

        // Frage und Beschreibung.
        const question = el("input", "text plq");

        question.maxLength = 300;
        question.value = draft.question;
        question.placeholder = "Welche Map spielen wir am Freitag?";
        question.addEventListener("input", () => {
            draft.question = question.value;
            paintPreview();
        });

        const description = el("textarea", "text mcreason");

        description.rows = 2;
        description.maxLength = 1000;
        description.value = draft.description;
        description.placeholder = "Optional: ein paar Worte dazu";
        description.addEventListener("input", () => {
            draft.description = description.value;
            paintPreview();
        });

        // Antworten.
        const answers = el("div", "plopts");
        const paintAnswers = (): void => {
            const max = draft.kind === "native" ? limits.native : limits.own;

            answers.replaceChildren(
                ...draft.options.map((option, index) => {
                    const input = el("input", "text");
                    const picker = emojiPicker({
                        value: option.emoji,
                        emojis: data!.guild.emojis,
                        label: `Emoji für Antwort ${index + 1}`,
                        onPick: (value) => {
                            option.emoji = value;
                            paintPreview();
                        },
                    });
                    const remove = button("iconbtn is-danger", icon("#i-trash"));

                    input.maxLength = max;
                    input.value = option.label;
                    input.placeholder = `Antwort ${index + 1}`;
                    input.dataset.key = `answer-${index}`;
                    input.setAttribute("aria-label", `Antwort ${index + 1}`);
                    input.addEventListener("input", () => {
                        option.label = input.value;
                        paintPreview();
                    });
                    remove.disabled = draft.options.length <= 2;
                    remove.setAttribute("aria-label", `Antwort ${index + 1} entfernen`);
                    remove.addEventListener("click", () => {
                        draft.options.splice(index, 1);
                        paintAnswers();
                        paintPreview();
                    });

                    return el("div", "plopt", picker, input, remove);
                })
            );

            const add = button("tkadd", icon("#i-plus"), el("span", "", draft.options.length >= limits.options ? `Höchstens ${limits.options} Antworten` : "Antwort hinzufügen"));

            add.disabled = draft.options.length >= limits.options;
            add.addEventListener("click", () => {
                draft.options.push({ label: "", emoji: null });
                paintAnswers();
                answers.querySelector<HTMLInputElement>(`[data-key="answer-${draft.options.length - 1}"]`)?.focus();
            });
            answers.append(add);
        };

        paintAnswers();

        // Einstellungen.
        const durations: [string, string][] = own
            ? [["", "Ohne Ende"], ...DURATIONS.map(([seconds, label]): [string, string] => [String(seconds), label])]
            : NATIVE_DURATIONS.map(([seconds, label]): [string, string] => [String(seconds), label]);
        const settings = el(
            "div",
            "",
            row(
                "Mehrfachauswahl",
                "Mehr als eine Antwort erlaubt",
                toggle(draft.settings.multi, "Mehrfachauswahl", (on) => {
                    draft.settings.multi = on;
                    paint();
                })
            )
        );

        if (own && draft.settings.multi) {
            settings.append(
                row(
                    "Höchstens",
                    "Wie viele Antworten jemand wählen darf",
                    select(
                        [["0", "Alle"], ...Array.from({ length: Math.max(0, draft.options.length - 2) }, (_, index): [string, string] => [String(index + 2), `${index + 2} Antworten`])],
                        String(draft.settings.maxChoices),
                        (value) => {
                            draft.settings.maxChoices = Number(value);
                        },
                        "Höchstens so viele Antworten"
                    )
                )
            );
        }

        if (own) {
            settings.append(
                row(
                    "Anonym",
                    "Niemand sieht, wer was gewählt hat – auch nicht im Dashboard",
                    toggle(draft.settings.anonymous, "Anonym", (on) => {
                        draft.settings.anonymous = on;
                        paintPreview();
                    })
                ),
                row(
                    "Ergebnis zeigen",
                    "Wann die Balken zu sehen sind",
                    select(
                        [
                            ["live", "Immer – live"],
                            ["voted", "Nach der eigenen Stimme"],
                            ["end", "Erst am Ende"],
                        ],
                        draft.settings.results,
                        (value) => {
                            draft.settings.results = value as ISettings["results"];
                            paintPreview();
                        },
                        "Ergebnis zeigen"
                    )
                ),
                row(
                    "Nur für Rollen",
                    "Leer: jeder darf abstimmen",
                    rolePicker(data!.guild.roles, draft.settings.roles, (ids) => {
                        draft.settings.roles = ids;
                    })
                )
            );
        }

        const channel = logTargetSelect(
            data!.targets,
            draft.channelId,
            (value) => {
                draft.channelId = value;
            },
            async (forumId) => {
                const answer = await call<{ thread: ILogThread }>("", { action: "logthread", forumId });

                return answer?.thread ?? null;
            },
            "— Kanal wählen —"
        );

        settings.append(
            row(
                "Laufzeit",
                own ? "Danach ist sie zu – oder ohne Ende, bis ihr sie beendet" : "Discord: eine Stunde bis 32 Tage",
                select(durations, draft.duration ? String(draft.duration) : "", (value) => {
                    draft.duration = value ? Number(value) : null;
                    paintPreview();
                }, "Laufzeit")
            ),
            row("Kanal", "Textkanal oder Beitrag in einem Forum", channel),
            row("Ping", "Beim Start anpingen", pingSelect(data!.guild.roles, draft.settings.ping, (value) => (draft.settings.ping = value)))
        );

        if (own) {
            const color = el("input", "tkcolor");

            color.type = "color";
            color.value = draft.settings.accent ?? "#00afff";
            color.addEventListener("input", () => {
                draft.settings.accent = color.value;
                paintPreview();
            });
            settings.append(row("Farbe", "Der Balken links an der Karte", color));
        }

        const start = button("btn btn--primary", icon("#i-play"), "Umfrage starten");

        start.addEventListener("click", async () => {
            start.disabled = true;

            const answer = await call<{ poll: IPoll }>("", {
                action: "create",
                poll: {
                    kind: draft.kind,
                    question: draft.question,
                    description: draft.description,
                    options: draft.options.filter((option) => option.label.trim()),
                    settings: draft.settings,
                    duration: draft.duration,
                    channelId: draft.channelId,
                },
            });

            start.disabled = false;

            if (!answer) return;

            toast("info", `Umfrage #${answer.poll.number} läuft`, "Viel Spaß beim Abstimmen!");
            draft.question = "";
            draft.description = "";
            draft.options = [
                { label: "", emoji: null },
                { label: "", emoji: null },
            ];
            tab = "list";
            await reload();
        });

        paintPreview();

        return [
            el(
                "div",
                "plform",
                el(
                    "div",
                    "plform__main",
                    card("Welche Art?", "", kinds),
                    card(
                        "Frage und Antworten",
                        "",
                        el("label", "mcfield", el("span", "mcfield__label", "Frage"), question),
                        ...(own ? [el("label", "mcfield", el("span", "mcfield__label", "Beschreibung"), description)] : []),
                        el("div", "mcfield", el("span", "mcfield__label", "Antworten"), answers)
                    ),
                    card("Einstellungen", "", settings, el("div", "mcsave", start))
                ),
                el("aside", "tkside plform__side", el("div", "tkside__head", el("span", "tkside__live", "Live-Vorschau"), el("b", "", own ? "Eigene Umfrage" : "Discord-Umfrage")), preview)
            ),
        ];
    }

    /* ------------------------------------------------------------
       Laden
       ------------------------------------------------------------ */
    async function reload(): Promise<void> {
        const answer = await call<IPayload>("");

        if (!answer) return;

        data = answer;
        paint();
    }

    host.replaceChildren(head, tabs, pane);
    head.append(...Array.from({ length: 4 }, () => el("div", "sb snskel")));
    void reload();
}
