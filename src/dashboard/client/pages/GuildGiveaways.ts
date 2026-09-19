/**
 * Abschnitt: Giveaways.
 *
 * Oben die Zahlen, darunter die Liste (laufend, geplant, beendet - ein Klick
 * öffnet eins groß: Gewinner mit Frist, Teilnehmer, neu auslosen) und
 * "Neues Giveaway" mit Bedingungen, Bonus-Losen, Gewinner-Frist, geplantem
 * Start und einer Vorschau der Karte.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { ago } from "../core/Format.js";
import { ILogTargets, ILogThread, logTargetSelect } from "../core/LogTarget.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { api, button, card, confirmButton, DURATIONS, el, face, IRole, localInput, pingSelect, rolePicker, row, select, stat, toggle, WHEN } from "../core/Ui.js";
import { IServerEmoji } from "../layout/EmojiPicker.js";

type Status = "scheduled" | "running" | "ended" | "cancelled";

interface IRequirements {
    roles: string[];
    allRoles: boolean;
    forbidden: string[];
    booster: "any" | "only" | "none";
    serverDays: number;
    accountDays: number;
    messages: number;
    linked: boolean;
}

interface IBonus {
    roleId: string;
    tickets: number;
}

interface ISettings {
    dm: boolean;
    claimHours: number;
    ping: string | null;
    accent: string | null;
}

interface IPerson {
    id: string;
    name: string;
    avatar: string | null;
}

interface IWinner extends IPerson {
    userId: string;
    drawnAt: number;
    deadline: number | null;
    status: "won" | "pending" | "claimed" | "expired" | "replaced";
    claimedAt: number | null;
    dm: boolean | null;
}

interface IGiveaway {
    id: number;
    number: number;
    channelId: string;
    url: string | null;
    prize: string;
    description: string | null;
    image: string | null;
    winners: number;
    host: IPerson;
    status: Status;
    startsAt: number;
    endsAt: number;
    endedAt: number | null;
    requirements: IRequirements;
    bonus: IBonus[];
    settings: ISettings;
    rules: string[];
    results: IWinner[];
    entries: number;
}

interface IPayload {
    giveaways: IGiveaway[];
    limits: { winners: number; bonusRoles: number; bonusTickets: number; claim: number[] };
    booster: string;
    guild: { name: string; boostRole: string | null; roles: IRole[]; emojis: IServerEmoji[] };
    targets: ILogTargets;
}

interface IDetail {
    giveaway: IGiveaway;
    entrants: (IPerson & { tickets: number; at: number })[];
}

const STATUS: Record<Status, [string, string]> = {
    running: ["läuft", "is-ok"],
    scheduled: ["geplant", "is-active"],
    ended: ["beendet", "is-ended"],
    cancelled: ["abgebrochen", "is-ended"],
};

const WINNER: Record<IWinner["status"], [string, string]> = {
    won: ["gewonnen", "is-ok"],
    pending: ["wartet auf Annahme", "is-active"],
    claimed: ["angenommen", "is-ok"],
    expired: ["Frist verpasst", "is-ended"],
    replaced: ["ersetzt", "is-ended"],
};

function when(giveaway: IGiveaway): string {
    if (giveaway.status === "running") return `endet ${WHEN.format(giveaway.endsAt)}`;
    if (giveaway.status === "scheduled") return `startet ${WHEN.format(giveaway.startsAt)}`;

    return giveaway.endedAt ? ago(giveaway.endedAt) : "";
}

export function renderGiveaways(guildId: string): void {
    const host = need<HTMLElement>("#giveawayBody");
    const note = need<HTMLElement>("#giveawayNote");
    const call = api(`${BASE}/api/guild/${encodeURIComponent(guildId)}/giveaways`, note);

    let data: IPayload | null = null;
    let tab: "list" | "new" = "list";
    let filter: Status | "all" = "all";

    const draft = {
        prize: "",
        description: "",
        image: "",
        winners: 1,
        scheduled: false,
        startsAt: Date.now() + 3_600_000,
        duration: 86_400,
        channelId: null as string | null,
        requirements: { roles: [], allRoles: false, forbidden: [], booster: "any", serverDays: 0, accountDays: 0, messages: 0, linked: false } as IRequirements,
        bonus: [] as IBonus[],
        settings: { dm: true, claimHours: 24, ping: null, accent: null } as ISettings,
    };

    /* ------------------------------------------------------------
       Gerüst
       ------------------------------------------------------------ */
    const head = el("div", "tkhead");
    const tabs = el("div", "tktabs");
    const pane = el("div", "tkpane");

    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Bereiche der Giveaways");

    function paintHead(): void {
        const list = data!.giveaways;
        const running = list.filter((entry) => entry.status === "running");
        const pending = list.flatMap((entry) => entry.results).filter((winner) => winner.status === "pending").length;

        head.replaceChildren(
            stat("#i-gift", "Laufend", String(running.length), running.length ? "is-ok" : ""),
            stat("#i-bell", "Geplant", String(list.filter((entry) => entry.status === "scheduled").length)),
            stat("#i-users", "Teilnahmen (laufend)", String(running.reduce((sum, entry) => sum + entry.entries, 0))),
            stat("#i-clock", "Offene Gewinne", String(pending), pending ? "is-warn" : "")
        );
    }

    function paintTabs(): void {
        const entries: ["list" | "new", string, string][] = [
            ["list", "#i-gift", "Giveaways"],
            ["new", "#i-plus", "Neues Giveaway"],
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

                if (id === "list" && data!.giveaways.length) knob.append(el("span", "tktab__count", String(data!.giveaways.length)));

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
    function list(): HTMLElement[] {
        if (!data!.giveaways.length) {
            const go = button("btn btn--primary", icon("#i-plus"), "Erstes Giveaway");

            go.addEventListener("click", () => {
                tab = "new";
                paint();
            });

            return [
                el(
                    "div",
                    "tkempty tkempty--big",
                    icon("#i-gift"),
                    el("b", "", "Noch kein Giveaway."),
                    el("span", "", "Preis, Dauer, Kanal – fertig. Bedingungen, Bonus-Lose und eine Frist für die Gewinner sind optional. Auch per /giveaway."),
                    go
                ),
            ];
        }

        const seg = el("div", "seg gwfilter");

        for (const [value, label] of [
            ["all", "Alle"],
            ["running", "Laufend"],
            ["scheduled", "Geplant"],
            ["ended", "Beendet"],
        ] as [Status | "all", string][]) {
            const knob = button("", label);

            knob.setAttribute("aria-pressed", String(filter === value));
            knob.addEventListener("click", () => {
                filter = value;
                paint();
            });
            seg.append(knob);
        }

        const shown = data!.giveaways.filter((entry) => filter === "all" || entry.status === filter || (filter === "ended" && entry.status === "cancelled"));

        return [
            seg,
            el(
                "div",
                "pllist",
                ...(shown.length
                    ? shown.map((giveaway) => {
                          const [label, tone] = STATUS[giveaway.status];
                          const item = button(
                              `gwrow${giveaway.status === "running" ? " is-running" : ""}`,
                              el("span", "mcb mcb--warn", icon("#i-gift")),
                              el(
                                  "span",
                                  "plrow__main",
                                  el("span", "plrow__top", el("b", "", giveaway.prize), el("span", "mcrow__num", `#${giveaway.number}`), el("span", `mcstate ${tone}`, label)),
                                  el(
                                      "span",
                                      "gwrow__facts",
                                      `${giveaway.winners} Gewinner · ${giveaway.entries} Teilnehmer · ${when(giveaway)}${giveaway.rules.length ? ` · ${giveaway.rules.length} ${giveaway.rules.length === 1 ? "Bedingung" : "Bedingungen"}` : ""}`
                                  )
                              ),
                              el("span", "mcrow__side", el("span", "", `von ${giveaway.host.name}`), el("time", "", ago(giveaway.startsAt)))
                          );

                          item.setAttribute("aria-label", `Giveaway ${giveaway.number}: ${giveaway.prize}, ${label}`);
                          item.addEventListener("click", () => void view(giveaway.number));

                          return item;
                      })
                    : [el("p", "tkempty", "Keine Giveaways in dieser Ansicht.")])
            ),
        ];
    }

    /* ------------------------------------------------------------
       Ein Giveaway groß
       ------------------------------------------------------------ */
    const title = el("h2", "", "");
    const sub = el("p", "", "");
    const body = el("div", "modal__body gwview__body");
    const close = button("iconbtn modal__x", icon("#i-x"));
    const dialog = el("dialog", "modal plview", el("div", "modal__head", el("span", "mcb mcb--warn", icon("#i-gift")), el("div", "mcview__title", title, sub), close), body);

    title.id = "gwViewTitle";
    dialog.setAttribute("aria-labelledby", "gwViewTitle");
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

    async function act(number: number, action: string, extra: Record<string, unknown> = {}, done = ""): Promise<void> {
        if (!(await call("", { action, number, ...extra }))) return;

        if (done) toast("info", done, `Giveaway #${number}`);

        await reload();

        if (action === "delete") hide();
        else await view(number);
    }

    async function view(number: number): Promise<void> {
        const detail = await call<IDetail>(`?giveaway=${number}`);

        if (!detail) return;

        const { giveaway, entrants } = detail;
        const [label, tone] = STATUS[giveaway.status];

        title.textContent = giveaway.prize;
        sub.textContent = `Giveaway #${giveaway.number} · von ${giveaway.host.name} · ${when(giveaway)}`;

        const facts = el(
            "div",
            "plview__facts",
            el("span", `mcstate ${tone}`, label),
            el("span", "tagline", `${giveaway.winners} Gewinner`),
            el("span", "tagline", `${giveaway.entries} Teilnehmer`),
            el("span", "tagline", giveaway.settings.dm ? (giveaway.settings.claimHours ? `Frist ${giveaway.settings.claimHours} Std.` : "DM ohne Frist") : "ohne DM")
        );

        const winners = el(
            "section",
            "mcside",
            el("h3", "mcside__title", icon("#i-crown"), "Gewinner"),
            ...(giveaway.results.length
                ? giveaway.results.map((winner) => {
                      const [text, state] = WINNER[winner.status];
                      const line = el(
                          "div",
                          `gwwinner${winner.status === "replaced" || winner.status === "expired" ? " is-out" : ""}`,
                          face(winner),
                          el("span", "gwwinner__name", winner.name),
                          el("span", `mcstate ${state}`, winner.status === "pending" && winner.deadline ? `${text} · bis ${WHEN.format(winner.deadline)}` : text),
                          ...(winner.dm === false ? [el("span", "mcstate is-ended", "DM zu")] : [])
                      );

                      if (giveaway.status === "ended" && winner.status !== "replaced" && winner.status !== "claimed") {
                          line.append(confirmButton("btn btn--quiet gwwinner__reroll", "#i-refresh", "Neu auslosen", "Wirklich?", () => act(giveaway.number, "reroll", { user: winner.userId }, "Neu ausgelost")));
                      }

                      return line;
                  })
                : [el("p", "mcmuted", giveaway.status === "ended" ? "Niemand hat die Bedingungen erfüllt." : "Ausgelost wird am Ende.")])
        );

        const search = el("input", "text");
        const people = el("div", "gwentrants");
        const paintPeople = (): void => {
            const text = search.value.trim().toLowerCase();
            const shown = entrants.filter((person) => !text || person.name.toLowerCase().includes(text) || person.id.startsWith(text));

            people.replaceChildren(
                ...(shown.length
                    ? shown.slice(0, 200).map((person) => el("span", "ltperson", face(person), el("span", "", person.name), ...(person.tickets > 1 ? [el("b", "gwtickets", `×${person.tickets}`)] : [])))
                    : [el("p", "mcmuted", entrants.length ? "Niemand gefunden." : "Noch niemand dabei.")])
            );
        };

        search.type = "search";
        search.placeholder = "Teilnehmer suchen";
        search.setAttribute("aria-label", "Teilnehmer suchen");
        search.addEventListener("input", paintPeople);
        paintPeople();

        const actions = el("div", "mcsave plview__acts");

        if (giveaway.url) {
            const link = el("a", "btn btn--quiet", icon("#i-external"), "In Discord öffnen");

            link.href = giveaway.url;
            link.target = "_blank";
            link.rel = "noopener";
            actions.append(link);
        }

        if (giveaway.status === "running") actions.append(confirmButton("btn btn--primary", "#i-gift", "Jetzt auslosen", "Wirklich jetzt?", () => act(giveaway.number, "end", {}, "Ausgelost")));
        if (giveaway.status === "running" || giveaway.status === "scheduled") actions.append(confirmButton("btn btn--quiet", "#i-x", "Abbrechen", "Wirklich abbrechen?", () => act(giveaway.number, "cancel", {}, "Abgebrochen")));
        if (giveaway.status === "ended" && giveaway.results.some((winner) => winner.status === "pending" || winner.status === "won" || winner.status === "expired")) {
            actions.append(confirmButton("btn btn--quiet", "#i-refresh", "Offene neu auslosen", "Wirklich alle?", () => act(giveaway.number, "reroll", {}, "Neu ausgelost")));
        }

        actions.append(confirmButton("btn btn--quiet is-danger", "#i-trash", "Löschen", "Wirklich löschen?", () => act(giveaway.number, "delete", {}, "Gelöscht")));

        body.replaceChildren(
            facts,
            ...(giveaway.description ? [el("p", "plview__desc", giveaway.description)] : []),
            ...(giveaway.rules.length ? [el("section", "mcside", el("h3", "mcside__title", icon("#i-list-checks"), "Bedingungen"), el("ul", "gwrules", ...giveaway.rules.map((rule) => el("li", "", rule))))] : []),
            winners,
            el("section", "mcside", el("h3", "mcside__title", icon("#i-users"), `Teilnehmer · ${giveaway.entries}`), search, people),
            actions
        );

        if (!dialog.open) dialog.showModal();
    }

    /* ------------------------------------------------------------
       Neues Giveaway
       ------------------------------------------------------------ */
    const preview = el("div", "tkside__body");

    function roleName(id: string): string {
        return id === data!.booster ? "Server-Booster" : `@${data!.guild.roles.find((role) => role.id === id)?.name ?? "Rolle"}`;
    }

    function rules(): string[] {
        const req = draft.requirements;
        const lines: string[] = [];

        if (req.roles.length) lines.push(`${req.allRoles && req.roles.length > 1 ? "Alle diese Rollen" : req.roles.length > 1 ? "Eine dieser Rollen" : "Die Rolle"}: ${req.roles.map(roleName).join(", ")}`);
        if (req.forbidden.length) lines.push(`Nicht mit: ${req.forbidden.map(roleName).join(", ")}`);
        if (req.booster === "only") lines.push("Nur für Server-Booster");
        if (req.booster === "none") lines.push("Keine Server-Booster");
        if (req.serverDays) lines.push(`Mindestens ${req.serverDays} Tage auf ${data!.guild.name}`);
        if (req.accountDays) lines.push(`Discord-Konto älter als ${req.accountDays} Tage`);
        if (req.messages) lines.push(`Mindestens ${req.messages} Nachrichten in den letzten 14 Tagen`);
        if (req.linked) lines.push("Verknüpftes Rocket-League-Konto");

        return lines;
    }

    function paintPreview(): void {
        const accent = draft.settings.accent ?? "#ffc53d";
        const prev = el(
            "div",
            "tkprev",
            el("h2", "", `🎉 ${draft.prize || "Dein Preis"}`),
            ...(draft.description ? [el("p", "", draft.description)] : []),
            ...(draft.image.startsWith("https://") ? [el("div", "tkprev__gallery", Object.assign(el("img", "tkprev__image"), { src: draft.image, alt: "", loading: "lazy" }))] : []),
            el("div", "tkprev__sep"),
            el("p", "", `🏆 ${draft.winners} Gewinner · ⏰ endet in ${DURATIONS.find(([seconds]) => seconds === draft.duration)?.[1] ?? "…"}`),
            el("p", "", "👤 Veranstaltet von dir")
        );
        const lines = rules();

        if (lines.length) prev.append(el("p", "", el("b", "", "Bedingungen")), ...lines.map((line) => el("p", "tkprev__line", `• ${line}`)));
        if (draft.bonus.length) prev.append(el("p", "", el("b", "", "Bonus-Lose")), ...draft.bonus.map((bonus) => el("p", "tkprev__line", `• ${roleName(bonus.roleId)}: +${bonus.tickets}`)));

        prev.append(el("div", "tkprev__sep"), el("p", "tkprev__small", `0 Teilnehmer · Giveaway #${(data!.giveaways[0]?.number ?? 0) + 1}`), el("div", "tkmock", el("span", "tkmock__btn gwmock", "🎉 Teilnehmen")));
        prev.style.setProperty("--accent", accent);
        preview.replaceChildren(prev);
    }

    function number(value: number, min: number, max: number, onChange: (value: number) => void, label: string): HTMLInputElement {
        const input = el("input", "text gwnum");

        input.type = "number";
        input.min = String(min);
        input.max = String(max);
        input.value = String(value);
        input.setAttribute("aria-label", label);
        input.addEventListener("input", () => {
            const parsed = Math.min(Math.max(Math.round(Number(input.value) || 0), min), max);

            onChange(parsed);
            paintPreview();
        });

        return input;
    }

    function form(): HTMLElement[] {
        const limits = data!.limits;
        const req = draft.requirements;

        // Preis.
        const prize = el("input", "text plq");

        prize.maxLength = 200;
        prize.value = draft.prize;
        prize.placeholder = "Rocket Pass Premium, 1100 Credits, Titan-Wheels …";
        prize.addEventListener("input", () => {
            draft.prize = prize.value;
            paintPreview();
        });

        const description = el("textarea", "text mcreason");

        description.rows = 2;
        description.maxLength = 1500;
        description.value = draft.description;
        description.placeholder = "Optional: worum es geht, wer es sponsert …";
        description.addEventListener("input", () => {
            draft.description = description.value;
            paintPreview();
        });

        const image = el("input", "text plq");

        image.type = "url";
        image.value = draft.image;
        image.placeholder = "https://… (optional, ein Bild zum Preis)";
        image.addEventListener("input", () => {
            draft.image = image.value.trim();
            paintPreview();
        });

        // Ablauf.
        const when = el("div", "seg");
        const startField = el("input", "text gwstart");

        startField.type = "datetime-local";
        startField.value = localInput(draft.startsAt);
        startField.min = localInput(Date.now());
        startField.hidden = !draft.scheduled;
        startField.setAttribute("aria-label", "Start");
        startField.addEventListener("change", () => {
            draft.startsAt = new Date(startField.value).getTime();
        });

        for (const [value, label] of [
            [false, "Sofort"],
            [true, "Geplant"],
        ] as [boolean, string][]) {
            const knob = button("", label);

            knob.setAttribute("aria-pressed", String(draft.scheduled === value));
            knob.addEventListener("click", () => {
                draft.scheduled = value;
                startField.hidden = !value;

                for (const other of when.children) other.setAttribute("aria-pressed", String(other === knob));
            });
            when.append(knob);
        }

        const channel = logTargetSelect(
            data!.targets,
            draft.channelId,
            (value) => {
                draft.channelId = value;
            },
            async (forumId) => (await call<{ thread: ILogThread }>("", { action: "logthread", forumId }))?.thread ?? null,
            "— Kanal wählen —"
        );

        // Bonus-Lose.
        const bonusHost = el("div", "gwbonus");
        const paintBonus = (): void => {
            const options: [string, string][] = [[data!.booster, "Server-Booster"], ...data!.guild.roles.map((role): [string, string] => [role.id, `@${role.name}`])];

            bonusHost.replaceChildren(
                ...draft.bonus.map((bonus, index) => {
                    const remove = button("iconbtn is-danger", icon("#i-trash"));

                    remove.setAttribute("aria-label", "Bonus entfernen");
                    remove.addEventListener("click", () => {
                        draft.bonus.splice(index, 1);
                        paintBonus();
                        paintPreview();
                    });

                    return el(
                        "div",
                        "mcstage",
                        select(options, bonus.roleId, (value) => {
                            bonus.roleId = value;
                            paintPreview();
                        }, "Rolle mit Bonus"),
                        el("span", "mcstage__label", "bekommt"),
                        number(bonus.tickets, 1, limits.bonusTickets, (value) => (bonus.tickets = value), "Extra-Lose"),
                        el("span", "mcstage__label", "Extra-Lose"),
                        remove
                    );
                })
            );

            const add = button("tkadd", icon("#i-plus"), el("span", "", draft.bonus.length >= limits.bonusRoles ? `Höchstens ${limits.bonusRoles}` : "Bonus hinzufügen"));

            add.disabled = draft.bonus.length >= limits.bonusRoles;
            add.addEventListener("click", () => {
                const free = options.find(([id]) => !draft.bonus.some((bonus) => bonus.roleId === id));

                if (!free) return;

                draft.bonus.push({ roleId: free[0], tickets: 1 });
                paintBonus();
                paintPreview();
            });
            bonusHost.append(add);
        };

        paintBonus();

        const start = button("btn btn--primary", icon("#i-gift"), "Giveaway starten");

        start.addEventListener("click", async () => {
            start.disabled = true;

            const answer = await call<{ giveaway: IGiveaway }>("", {
                action: "create",
                giveaway: {
                    prize: draft.prize,
                    description: draft.description,
                    image: draft.image || null,
                    winners: draft.winners,
                    startsAt: draft.scheduled ? draft.startsAt : null,
                    duration: draft.duration,
                    channelId: draft.channelId,
                    requirements: draft.requirements,
                    bonus: draft.bonus,
                    settings: draft.settings,
                },
            });

            start.disabled = false;

            if (!answer) return;

            toast("info", answer.giveaway.status === "scheduled" ? `Giveaway #${answer.giveaway.number} ist geplant` : `Giveaway #${answer.giveaway.number} läuft`, answer.giveaway.prize);
            draft.prize = "";
            draft.description = "";
            draft.image = "";
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
                    card(
                        "Preis",
                        "",
                        el("label", "mcfield", el("span", "mcfield__label", "Was gibt es zu gewinnen?"), prize),
                        el("label", "mcfield", el("span", "mcfield__label", "Beschreibung"), description),
                        el("label", "mcfield", el("span", "mcfield__label", "Bild"), image)
                    ),
                    card(
                        "Ablauf",
                        "",
                        row("Gewinner", "Wie viele ausgelost werden", number(draft.winners, 1, limits.winners, (value) => (draft.winners = value), "Gewinner")),
                        row("Start", "Sofort oder zu einem festen Zeitpunkt", el("div", "gwwhen", when, startField)),
                        row(
                            "Dauer",
                            "Wie lange man mitmachen kann",
                            select(DURATIONS.map(([seconds, label]): [string, string] => [String(seconds), label]), String(draft.duration), (value) => {
                                draft.duration = Number(value);
                                paintPreview();
                            }, "Dauer")
                        ),
                        row("Kanal", "Textkanal oder Beitrag in einem Forum", channel),
                        row("Ping", "Beim Start anpingen", pingSelect(data!.guild.roles, draft.settings.ping, (value) => (draft.settings.ping = value)))
                    ),
                    card(
                        "Bedingungen",
                        "Wer mitmachen darf. Geprüft beim Mitmachen – und beim Auslosen noch einmal.",
                        row(
                            "Pflicht-Rollen",
                            req.allRoles ? "Alle davon nötig" : "Eine davon reicht",
                            rolePicker(data!.guild.roles, req.roles, (ids) => {
                                req.roles = ids;
                                paintPreview();
                            })
                        ),
                        row(
                            "Alle Rollen nötig",
                            "Aus: eine der Rollen reicht",
                            toggle(req.allRoles, "Alle Rollen nötig", (on) => {
                                req.allRoles = on;
                                paintPreview();
                            })
                        ),
                        row(
                            "Ausgeschlossen",
                            "Wer eine davon hat, darf nicht – etwa das Team",
                            rolePicker(data!.guild.roles, req.forbidden, (ids) => {
                                req.forbidden = ids;
                                paintPreview();
                            })
                        ),
                        row(
                            "Server-Booster",
                            "Nur Booster – oder gerade keine",
                            select(
                                [
                                    ["any", "Egal"],
                                    ["only", "Nur Booster"],
                                    ["none", "Keine Booster"],
                                ],
                                req.booster,
                                (value) => {
                                    req.booster = value as IRequirements["booster"];
                                    paintPreview();
                                },
                                "Server-Booster"
                            )
                        ),
                        row("Tage auf dem Server", "0 = egal", number(req.serverDays, 0, 3650, (value) => (req.serverDays = value), "Tage auf dem Server")),
                        row("Alter des Discord-Kontos", "In Tagen, 0 = egal – hält Zweitkonten fern", number(req.accountDays, 0, 3650, (value) => (req.accountDays = value), "Kontoalter in Tagen")),
                        row("Nachrichten in 14 Tagen", "Aktivität auf dem Server, 0 = egal", number(req.messages, 0, 10_000, (value) => (req.messages = value), "Nachrichten")),
                        row(
                            "Rocket-League-Konto",
                            "Nur mit verknüpftem Epic-Konto (Dashboard › Einstellungen)",
                            toggle(req.linked, "Verknüpftes Rocket-League-Konto nötig", (on) => {
                                req.linked = on;
                                paintPreview();
                            })
                        )
                    ),
                    card("Bonus-Lose", "Mehr Gewinnchance für bestimmte Rollen – etwa Booster doppelt (+1 Los).", bonusHost),
                    card(
                        "Gewinner",
                        "",
                        row(
                            "DM an die Gewinner",
                            "Mit Knopf zum Annehmen",
                            toggle(draft.settings.dm, "DM an die Gewinner", (on) => {
                                draft.settings.dm = on;
                            })
                        ),
                        row(
                            "Frist zum Annehmen",
                            "Wer sich nicht meldet, wird ersetzt – automatisch",
                            select(
                                limits.claim.map((hours): [string, string] => [String(hours), hours ? (hours >= 48 ? `${hours / 24} Tage` : `${hours} Stunden`) : "Keine Frist"]),
                                String(draft.settings.claimHours),
                                (value) => {
                                    draft.settings.claimHours = Number(value);
                                },
                                "Frist zum Annehmen"
                            )
                        ),
                        el("div", "mcsave", start)
                    )
                ),
                el("aside", "tkside plform__side", el("div", "tkside__head", el("span", "tkside__live", "Live-Vorschau"), el("b", "", "Karte in Discord")), preview)
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
