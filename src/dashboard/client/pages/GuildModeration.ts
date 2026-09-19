/**
 * Abschnitt: die Moderation eines Servers.
 *
 * Oben die Zahlen (was gerade gilt), darunter drei Bereiche: der Verlauf aller
 * Fälle mit Suche und Filtern, "Neue Aktion" und - für wer den Server
 * verwaltet - die Einstellungen mit den Stufen für Verwarnungen. Ein Klick auf
 * einen Fall öffnet ihn groß: alles über ihn, Notizen, Beweise, Aufheben.
 *
 * Die Adresse kennt zwei Zusätze: ?fall=12 öffnet einen Fall (so verlinkt die
 * Karte im Log-Kanal), ?user=<id> zeigt den Verlauf eines Users (/verlauf).
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { ago } from "../core/Format.js";
import { failureText } from "../core/Gallery.js";
import { ILogTargets, ILogThread, logTargetSelect } from "../core/LogTarget.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";

type Action = "ban" | "unban" | "kick" | "timeout" | "untimeout" | "warn" | "unwarn" | "purge";
type Tab = "history" | "act" | "settings";

interface IPerson {
    id: string;
    name: string;
    avatar: string | null;
}

interface INote {
    id: number;
    by: string;
    byName: string;
    at: number;
    text: string;
}

interface IEvidence {
    id: number;
    kind: "image" | "link";
    url: string;
    name: string | null;
    by: string;
    byName: string;
    at: number;
}

interface IStage {
    warns: number;
    action: "timeout" | "kick" | "ban";
    duration: number | null;
}

interface IDetails {
    deleteSeconds?: number;
    channelId?: string;
    channelName?: string;
    deleted?: number;
    requested?: number;
    dm?: boolean;
    warns?: number;
    stage?: IStage & { case: number | null; error?: string };
    ended?: { how: "lifted" | "replaced" | "expired" | "discord"; at: number; byName: string | null; reason: string | null; case: number | null };
}

interface ICase {
    number: number;
    action: Action;
    active: boolean;
    source: "discord" | "dashboard" | "auto";
    related: number | null;
    reason: string | null;
    duration: number | null;
    expiresAt: number | null;
    createdAt: number;
    target: IPerson | null;
    moderator: IPerson;
    details: IDetails;
    notes: INote[];
    evidence: IEvidence[];
    logged: boolean;
    logUrl: string | null;
}

interface IConfig {
    logChannelId: string | null;
    dm: boolean;
    warnDays: number;
    stages: IStage[];
}

interface IStats {
    bans: number;
    timeouts: number;
    warns: number;
    month: number;
    total: number;
}

interface ITarget {
    id: string;
    name: string;
    username: string | null;
    avatar: string | null;
    member: boolean;
    banned: boolean;
    timeoutUntil: number | null;
    joinedAt: number | null;
    counts: Partial<Record<Action, number>>;
}

interface IMeta {
    me: { id: string; name: string; manage: boolean; actions: Action[] };
    config: IConfig;
    presets: { durations: [string, number][]; deletes: [number, string][] };
    channels: { id: string; name: string }[];
    targets?: ILogTargets;
}

interface IList extends Partial<IMeta> {
    cases: ICase[];
    more: boolean;
    stats?: IStats;
    target?: ITarget;
}

interface IDetail {
    case: ICase;
    related: ICase[];
    target: ITarget | null;
    me: { id: string; manage: boolean };
}

const ACTIONS: Record<Action, { label: string; verb: string; symbol: string; tone: "warn" | "danger" | "ok" | "info" }> = {
    warn: { label: "Verwarnung", verb: "Verwarnen", symbol: "#i-warn", tone: "warn" },
    timeout: { label: "Timeout", verb: "Stummschalten", symbol: "#i-clock", tone: "warn" },
    kick: { label: "Kick", verb: "Kicken", symbol: "#i-user-x", tone: "danger" },
    ban: { label: "Bann", verb: "Bannen", symbol: "#i-gavel", tone: "danger" },
    unwarn: { label: "Verwarnung entfernt", verb: "Verwarnung entfernen", symbol: "#i-eraser", tone: "ok" },
    untimeout: { label: "Timeout aufgehoben", verb: "Timeout aufheben", symbol: "#i-volume", tone: "ok" },
    unban: { label: "Entbannt", verb: "Entbannen", symbol: "#i-unlock", tone: "ok" },
    purge: { label: "Nachrichten gelöscht", verb: "Nachrichten löschen", symbol: "#i-message-x", tone: "info" },
};

const ORDER: Action[] = ["warn", "timeout", "kick", "ban", "unwarn", "untimeout", "unban", "purge"];
const SOURCES: Record<ICase["source"], string> = { discord: "per Befehl", dashboard: "im Dashboard", auto: "automatisch" };
// Diese brauchen einen zweiten Klick - danach ist es passiert.
const CONFIRM = new Set<Action>(["ban", "kick", "purge"]);
// Aufheben aus der großen Ansicht: was hebt welchen Fall auf.
const LIFT: Partial<Record<Action, Action>> = { ban: "unban", timeout: "untimeout", warn: "unwarn" };

const WHEN = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const PAGE = 30;

const UNITS: Record<string, number> = {
    s: 1, sek: 1, m: 60, min: 60, h: 3_600, std: 3_600, d: 86_400, t: 86_400, tag: 86_400, tage: 86_400, w: 604_800, wo: 604_800, woche: 604_800, wochen: 604_800,
};

// Wie ParseDuration() im Bot: "1h30m", "2 tage", "90" (Minuten).
function parseDuration(text: string): number | null {
    const value = text.trim().toLowerCase().replace(",", ".");

    if (!value) return null;
    if (/^\d+$/.test(value)) return Number(value) * 60;

    let total = 0;
    let rest = value;

    for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*([a-zäöü]+)/g)) {
        const unit = UNITS[match[2]];

        if (!unit) return null;

        total += Number(match[1]) * unit;
        rest = rest.replace(match[0], "");
    }

    return total > 0 && !rest.trim() ? Math.round(total) : null;
}

// Wie FormatDuration() im Bot.
function formatDuration(seconds: number): string {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const parts: string[] = [];

    if (days) parts.push(`${days} ${days === 1 ? "Tag" : "Tage"}`);
    if (hours) parts.push(`${hours} Std.`);
    if (minutes && !days) parts.push(`${minutes} Min.`);

    return parts.join(" ") || `${seconds} Sek.`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (className) element.className = className;

    element.append(...children);

    return element;
}

function button(className: string, ...children: (Node | string)[]): HTMLButtonElement {
    const element = el("button", className, ...children);

    element.type = "button";

    return element;
}

function face(person: { name: string; avatar: string | null }, className = "travatar"): HTMLElement {
    const box = el("span", className);

    if (person.avatar?.startsWith("https://")) box.style.backgroundImage = `url("${person.avatar.replace(/["\\]/g, "")}")`;
    else box.textContent = person.name.trim().slice(0, 1).toUpperCase() || "?";

    return box;
}

function badge(action: Action): HTMLElement {
    const box = el("span", `mcb mcb--${ACTIONS[action].tone}`, icon(ACTIONS[action].symbol));

    box.setAttribute("aria-hidden", "true");

    return box;
}

/** Status eines Falls als kurzer Text mit Ton: gilt, aufgehoben, abgelaufen - oder nichts. */
function status(entry: ICase): { text: string; tone: string } | null {
    const ended = entry.details.ended;

    if (entry.active) return { text: entry.expiresAt ? `gilt bis ${WHEN.format(entry.expiresAt)}` : "gilt", tone: "is-active" };
    if (!ended) return null;
    if (ended.how === "expired") return { text: "abgelaufen", tone: "is-expired" };
    if (ended.how === "discord") return { text: "in Discord aufgehoben", tone: "is-ended" };
    if (ended.how === "replaced") return { text: ended.case ? `ersetzt durch #${ended.case}` : "ersetzt", tone: "is-ended" };

    return { text: ended.case ? `aufgehoben durch #${ended.case}` : "aufgehoben", tone: "is-ended" };
}

function chip(entry: ICase): HTMLElement | null {
    const state = status(entry);

    return state ? el("span", `mcstate ${state.tone}`, state.text) : null;
}

export function renderModeration(guildId: string): void {
    const section = need<HTMLElement>("#moderation");
    const host = need<HTMLElement>("#modBody");
    const note = need<HTMLElement>("#modNote");
    const api = `${BASE}/api/guild/${encodeURIComponent(guildId)}/moderation`;

    let meta: IMeta | null = null;
    let entries: ICase[] = [];
    let hasMore = false;
    let stats: IStats | null = null;
    let target: ITarget | null = null;
    let tab: Tab = "history";
    let ticket = 0;
    let timer = 0;

    const params = new URLSearchParams(window.location.search);
    const filter = {
        q: "",
        action: "" as Action | "",
        active: false,
        user: /^\d{17,20}$/.test(params.get("user") ?? "") ? params.get("user") : null,
    };

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    async function call<T>(query: string, body?: Record<string, unknown>): Promise<T | null> {
        try {
            const response = await fetch(`${api}${query}`, {
                method: body ? "POST" : "GET",
                headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
                body: body ? JSON.stringify(body) : undefined,
            });
            const failure = await failureText(response);

            if (failure !== null) {
                warn(failure);

                return null;
            }

            warn(null);

            return (await response.json()) as T;
        } catch {
            warn("Der Bot antwortet gerade nicht.");

            return null;
        }
    }

    /* ------------------------------------------------------------
       Gerüst: Zahlen, Tabs, Bereich
       ------------------------------------------------------------ */
    const head = el("div", "tkhead mchead");
    const tabs = el("div", "tktabs");
    const pane = el("div", "tkpane");

    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Bereiche der Moderation");
    pane.id = "mcPane";
    pane.setAttribute("role", "tabpanel");
    host.replaceChildren(head, tabs, pane);

    function paintHead(): void {
        const numbers = stats ?? { bans: 0, timeouts: 0, warns: 0, month: 0, total: 0 };
        const tiles: [string, string, number, Action | "", boolean][] = [
            ["#i-gavel", "Aktive Banns", numbers.bans, "ban", true],
            ["#i-clock", "Aktive Timeouts", numbers.timeouts, "timeout", true],
            ["#i-warn", "Aktive Warns", numbers.warns, "warn", true],
            ["#i-scroll", "Fälle in 30 Tagen", numbers.month, "", false],
        ];

        head.replaceChildren(
            ...tiles.map(([symbol, label, value, action, active]) => {
                const tile = button(`tkstat${value && action ? " is-warn" : ""}`, el("span", "tkstat__mark", icon(symbol)), el("span", "tkstat__text", el("small", "", label), el("b", "", String(value))));

                tile.title = action ? `Zeigt nur ${label.toLowerCase()}` : "Zeigt alle Fälle";
                tile.addEventListener("click", () => {
                    filter.action = action;
                    filter.active = active;
                    filter.user = null;
                    open("history");
                    void load(true);
                });

                return tile;
            })
        );
    }

    function paintTabs(): void {
        const list: [Tab, string, string][] = [
            ["history", "#i-scroll", "Verlauf"],
            ["act", "#i-gavel", "Neue Aktion"],
            ...(meta?.me.manage ? ([["settings", "#i-sliders", "Einstellungen"]] as [Tab, string, string][]) : []),
        ];

        tabs.replaceChildren(
            ...list.map(([id, symbol, label]) => {
                const tabButton = button("tktab", icon(symbol), el("span", "", label));

                tabButton.id = `mctab-${id}`;
                tabButton.tabIndex = id === tab ? 0 : -1;
                tabButton.setAttribute("role", "tab");
                tabButton.setAttribute("aria-selected", String(id === tab));
                tabButton.setAttribute("aria-controls", "mcPane");
                tabButton.addEventListener("click", () => open(id));

                if (id === "history" && stats?.total) tabButton.append(el("span", "tktab__count", String(stats.total)));

                return tabButton;
            })
        );
    }

    tabs.addEventListener("keydown", (event) => {
        const ids = [...tabs.querySelectorAll<HTMLElement>("[role=tab]")].map((entry) => entry.id.replace("mctab-", "") as Tab);
        const index = ids.indexOf(tab);
        const next = event.key === "ArrowRight" ? (index + 1) % ids.length : event.key === "ArrowLeft" ? (index - 1 + ids.length) % ids.length : -1;

        if (next < 0) return;

        event.preventDefault();
        open(ids[next]);
        document.getElementById(`mctab-${ids[next]}`)?.focus();
    });

    function open(next: Tab): void {
        if (next !== tab) clickSound("primary");

        tab = next;
        paintTabs();
        paintPane();
    }

    function paintPane(): void {
        pane.setAttribute("aria-labelledby", `mctab-${tab}`);
        pane.replaceChildren(...(tab === "history" ? historyPane() : tab === "act" ? actPane() : settingsPane()));
    }

    /* ------------------------------------------------------------
       Verlauf
       ------------------------------------------------------------ */
    const search = el("input", "text mcsearch__input");
    const kind = el("select", "pick");
    const onlyActive = el("input", "switch");
    const listHost = el("div", "mclist");
    const targetHost = el("div", "");
    const more = button("btn btn--quiet trmore", "Ältere laden");

    search.type = "search";
    search.placeholder = "Fall-Nr., Name, Discord-ID oder Grund";
    search.setAttribute("aria-label", "Fälle durchsuchen");
    search.addEventListener("input", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            filter.q = search.value.trim();
            void load(true);
        }, 250);
    });

    kind.setAttribute("aria-label", "Nach Art filtern");
    kind.append(new Option("Alle Arten", ""), ...ORDER.map((action) => new Option(ACTIONS[action].label, action)));
    kind.addEventListener("change", () => {
        filter.action = kind.value as Action | "";
        void load(true);
    });

    onlyActive.type = "checkbox";
    onlyActive.setAttribute("aria-label", "Nur Fälle, die noch gelten");
    onlyActive.addEventListener("change", () => {
        filter.active = onlyActive.checked;
        void load(true);
    });

    more.addEventListener("click", () => void load(false));

    const toolbar = el(
        "div",
        "mcbar",
        el("label", "trsearch mcsearch", icon("#i-search"), search),
        kind,
        el("label", "mcswitch", onlyActive, el("span", "", "Nur aktive"))
    );

    function historyPane(): HTMLElement[] {
        kind.value = filter.action;
        onlyActive.checked = filter.active;

        if (search.value.trim() !== filter.q) search.value = filter.q;

        return [toolbar, targetHost, listHost, more];
    }

    function row(entry: ICase): HTMLElement {
        const info = ACTIONS[entry.action];
        const who = entry.target
            ? el("span", "mcrow__who", face(entry.target), el("span", "", entry.target.name))
            : el("span", "mcrow__who", el("span", "", entry.details.channelName ? `#${entry.details.channelName}` : "–"));
        const top = el("span", "mcrow__top", el("b", "", info.label), el("span", "mcrow__num", `#${entry.number}`));
        const state = chip(entry);

        if (state) top.append(state);

        const main = el("span", "mcrow__main", top, who);

        if (entry.reason) main.append(el("span", "mcrow__reason", `„${entry.reason}“`));

        const side = el(
            "span",
            "mcrow__side",
            el("span", "", `von ${entry.moderator.name}`),
            el("time", "", ago(entry.createdAt)),
            el("span", "mcrow__src", SOURCES[entry.source])
        );
        const item = button("mcrow", badge(entry.action), main, side);

        item.setAttribute("aria-label", `Fall ${entry.number}: ${info.label}${entry.target ? ` gegen ${entry.target.name}` : ""}`);
        item.addEventListener("click", () => void view(entry.number));

        return item;
    }

    function paintTarget(): void {
        if (!filter.user || !target) {
            targetHost.replaceChildren();

            return;
        }

        const person = target;
        const flags = [
            person.banned ? el("span", "mcstate is-active", "gebannt") : person.member ? el("span", "mcstate is-ok", "auf dem Server") : el("span", "mcstate is-ended", "nicht auf dem Server"),
            ...(person.timeoutUntil && person.timeoutUntil > Date.now() ? [el("span", "mcstate is-active", `stumm bis ${WHEN.format(person.timeoutUntil)}`)] : []),
        ];
        const counts = el(
            "div",
            "mctarget__counts",
            ...(["warn", "timeout", "kick", "ban"] as Action[]).map((action) =>
                el("span", `mccount mcb--${ACTIONS[action].tone}`, icon(ACTIONS[action].symbol), el("b", "", String(person.counts[action] ?? 0)), el("small", "", ACTIONS[action].label))
            )
        );
        const clear = button("btn btn--quiet", icon("#i-x"), "Alle Fälle");

        clear.addEventListener("click", () => {
            filter.user = null;
            void load(true);
        });

        const quick = el("div", "mctarget__acts", clear);

        for (const action of (person.banned ? ["unban"] : ["warn", "timeout", "kick", "ban"]) as Action[]) {
            if (!meta?.me.actions.includes(action) || (!person.member && action !== "ban" && action !== "unban")) continue;

            const go = button(`btn btn--quiet mcgo mcgo--${ACTIONS[action].tone}`, icon(ACTIONS[action].symbol), ACTIONS[action].verb);

            go.addEventListener("click", () => {
                draft.action = action;
                draft.target = { id: person.id, name: person.name, avatar: person.avatar };
                open("act");
            });
            quick.append(go);
        }

        targetHost.replaceChildren(
            el(
                "section",
                "tkcard mctarget",
                el(
                    "div",
                    "mctarget__head",
                    face(person, "mctarget__face"),
                    el("div", "mctarget__name", el("b", "", person.name), el("span", "", [person.username, person.id].filter(Boolean).join(" · "))),
                    el("div", "mctarget__flags", ...flags)
                ),
                counts,
                quick
            )
        );
    }

    function paintList(): void {
        listHost.replaceChildren(
            ...(entries.length
                ? entries.map(row)
                : [
                      el(
                          "div",
                          "tkempty tkempty--big",
                          icon(filter.q || filter.action || filter.active || filter.user ? "#i-search" : "#i-shield-check"),
                          el("b", "", filter.q || filter.action || filter.active || filter.user ? "Keine passenden Fälle." : "Noch keine Fälle."),
                          el(
                              "span",
                              "",
                              filter.q || filter.action || filter.active || filter.user
                                  ? "Andere Suche oder weniger Filter – oder alle Fälle zeigen."
                                  : "Jede Aktion – hier oder mit /ban, /kick, /timeout und /warn in Discord – wird ein Fall mit Nummer."
                          )
                      ),
                  ])
        );
        more.hidden = !hasMore;
    }

    function skeleton(): void {
        listHost.replaceChildren(...Array.from({ length: 5 }, () => el("div", "mcrow mcrow--skel", el("span", "sb mcskel__badge"), el("span", "sb mcskel__line"), el("span", "sb mcskel__side"))));
    }

    async function load(reset: boolean, quiet = false): Promise<void> {
        const mine = ++ticket;
        const query = new URLSearchParams();

        if (filter.q) query.set("q", filter.q);
        if (filter.action) query.set("action", filter.action);
        if (filter.active) query.set("status", "active");
        if (filter.user) query.set("user", filter.user);
        if (!reset && entries.length) query.set("before", String(entries[entries.length - 1].number));
        if (!meta) query.set("meta", "1");

        if (reset && !quiet && tab === "history") skeleton();

        more.disabled = true;

        const data = await call<IList>(`?${query}`);

        more.disabled = false;

        if (mine !== ticket || !data) return;

        if (data.me && data.config && data.presets && data.channels) {
            meta = { me: data.me, config: data.config, presets: data.presets, channels: data.channels, targets: data.targets };
            settingsDraft = structuredClone(data.config);
        }

        entries = reset ? data.cases : [...entries, ...data.cases.filter((entry) => !entries.some((known) => known.number === entry.number))];
        hasMore = data.more && data.cases.length >= PAGE;

        if (data.stats) stats = data.stats;
        if (reset) target = data.target ?? null;

        paintHead();
        paintTabs();

        if (tab === "history") {
            if (!pane.contains(toolbar)) paintPane();

            paintTarget();
            paintList();
        }
    }

    /* ------------------------------------------------------------
       Ein Fall groß
       ------------------------------------------------------------ */
    const viewBadge = el("span", "");
    const viewTitle = el("h2", "", "");
    const viewSub = el("p", "", "");
    const viewState = el("span", "mcview__state");
    const viewMain = el("div", "mcview__main");
    const viewSide = el("div", "mcview__side");
    const closeView = button("iconbtn modal__x", icon("#i-x"));
    const dialog = el(
        "dialog",
        "modal mcview",
        el("div", "modal__head mcview__head", viewBadge, el("div", "mcview__title", viewTitle, viewSub), viewState, closeView),
        el("div", "modal__body mcview__body", viewMain, viewSide)
    );
    let shown: IDetail | null = null;

    viewTitle.id = "mcViewTitle";
    dialog.setAttribute("aria-labelledby", "mcViewTitle");
    closeView.autofocus = true;
    closeView.setAttribute("aria-label", "Schließen");
    document.body.append(dialog);

    /** Zu: ?fall= raus aus der Adresse. Auch ohne close-Event - das feuert nicht überall. */
    function hide(): void {
        shown = null;

        const url = new URL(window.location.href);

        if (url.searchParams.has("fall")) {
            url.searchParams.delete("fall");
            replaceUrl(url);
        }

        if (dialog.open) dialog.close();
    }

    closeView.addEventListener("click", hide);
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) hide();
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        event.preventDefault();
        hide();
    });
    dialog.addEventListener("close", () => {
        if (shown) hide();
    });

    function replaceUrl(url: URL): void {
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }

    async function view(number: number): Promise<void> {
        const data = await call<IDetail>(`?case=${number}`);

        if (!data) return;

        shown = data;
        paintView();

        const url = new URL(window.location.href);

        url.searchParams.set("fall", String(number));
        replaceUrl(url);

        if (!dialog.open) dialog.showModal();
    }

    function fact(term: string, ...value: (Node | string)[]): HTMLElement {
        return el("div", "mcfact", el("dt", "", term), el("dd", "", ...value));
    }

    function paintView(): void {
        if (!shown) return;

        const { case: entry, related, target: person, me } = shown;
        const info = ACTIONS[entry.action];
        const state = chip(entry);

        viewBadge.replaceChildren(badge(entry.action));
        viewTitle.textContent = `${info.label} · Fall #${entry.number}`;
        viewSub.textContent = `${SOURCES[entry.source]} · ${WHEN.format(entry.createdAt)}`;
        viewState.replaceChildren(...(state ? [state] : []));

        const facts = el("dl", "mcfacts");

        if (entry.target) {
            const past = button("uid", "Verlauf");

            past.title = `Alle Fälle von ${entry.target.name}`;
            past.addEventListener("click", () => {
                hide();
                filter.user = entry.target!.id;
                filter.q = "";
                filter.action = "";
                filter.active = false;
                open("history");
                void load(true);
            });

            facts.append(
                fact(
                    "User",
                    face(entry.target),
                    el("span", "", person?.name ?? entry.target.name),
                    el("code", "mcid", entry.target.id),
                    past,
                    ...(person ? [el("span", `mcstate ${person.banned ? "is-active" : person.member ? "is-ok" : "is-ended"}`, person.banned ? "gebannt" : person.member ? "auf dem Server" : "nicht auf dem Server")] : [])
                )
            );
        }

        facts.append(fact("Moderator", face(entry.moderator), el("span", "", entry.moderator.name)));
        facts.append(fact("Grund", entry.reason ?? el("i", "mcmuted", "ohne Grund")));

        if (entry.duration) {
            facts.append(fact("Dauer", `${formatDuration(entry.duration)}${entry.expiresAt ? ` · bis ${WHEN.format(entry.expiresAt)}` : ""}`));
        } else if (entry.action === "ban") {
            facts.append(fact("Dauer", "dauerhaft"));
        }

        if (entry.details.deleteSeconds) facts.append(fact("Mitgelöscht", `Nachrichten der letzten ${formatDuration(entry.details.deleteSeconds)}`));
        if (entry.action === "purge") facts.append(fact("Kanal", `#${entry.details.channelName ?? "?"} · ${entry.details.deleted ?? 0} von ${entry.details.requested ?? 0} gelöscht`));

        if (entry.action === "warn" && entry.details.warns) {
            const stage = entry.details.stage;

            facts.append(
                fact(
                    "Verwarnungen",
                    `${entry.details.warns} aktiv`,
                    ...(stage
                        ? [
                              el(
                                  "span",
                                  stage.case ? "mcstate is-active" : "mcstate is-ended",
                                  stage.case ? `Stufe: ${ACTIONS[stage.action].label} (#${stage.case})` : `Stufe ging nicht: ${stage.error ?? "abgelehnt"}`
                              ),
                          ]
                        : [])
                )
            );
        }

        if (entry.details.dm !== undefined) facts.append(fact("DM", entry.details.dm ? "zugestellt" : "nicht zustellbar – DMs zu"));

        if (entry.details.ended) {
            const ended = entry.details.ended;

            facts.append(fact("Beendet", `${WHEN.format(ended.at)}${ended.byName ? ` · ${ended.byName}` : ""}${ended.reason ? ` – „${ended.reason}“` : ""}`));
        }

        if (entry.logUrl) {
            const link = el("a", "", "Karte in Discord öffnen");

            link.href = entry.logUrl;
            link.target = "_blank";
            link.rel = "noopener";
            facts.append(fact("Log", link));
        }

        viewMain.replaceChildren(facts);

        if (related.length) {
            viewMain.append(
                el(
                    "section",
                    "mcrelated",
                    el("h3", "mcside__title", "Zusammenhang"),
                    ...related.map((other) => {
                        const link = button("mcrel", badge(other.action), el("span", "mcrel__label", `#${other.number} · ${ACTIONS[other.action].label}`), el("time", "", ago(other.createdAt)));

                        link.addEventListener("click", () => void view(other.number));

                        return link;
                    })
                )
            );
        }

        const lift = LIFT[entry.action];

        if (entry.active && lift && meta?.me.actions.includes(lift)) viewMain.append(liftBox(entry, lift));

        viewSide.replaceChildren(notes(entry, me), evidence(entry, me));
    }

    /** Aufheben direkt am Fall: Grund dazu, dann der Knopf. */
    function liftBox(entry: ICase, lift: Action): HTMLElement {
        const reason = el("input", "text");
        const go = button(`btn btn--quiet mcgo mcgo--ok`, icon(ACTIONS[lift].symbol), ACTIONS[lift].verb);

        reason.placeholder = "Grund (optional)";
        reason.maxLength = 500;
        reason.setAttribute("aria-label", `Grund für: ${ACTIONS[lift].verb}`);
        go.addEventListener("click", async () => {
            go.disabled = true;

            const answer = await act({
                action: lift,
                targetId: entry.target?.id ?? null,
                caseNumber: lift === "unwarn" ? entry.number : null,
                reason: reason.value.trim() || null,
            });

            go.disabled = false;

            if (answer) await view(entry.number);
        });

        return el("section", "mclift", el("h3", "mcside__title", "Aufheben"), el("div", "mclift__row", reason, go));
    }

    function notes(entry: ICase, me: IDetail["me"]): HTMLElement {
        const text = el("textarea", "text mcnote__input");
        const save = button("btn btn--quiet", icon("#i-plus"), "Notiz speichern");

        text.rows = 3;
        text.maxLength = 1000;
        text.placeholder = "Was das Team wissen sollte – nur intern.";
        text.setAttribute("aria-label", "Neue Notiz");
        save.addEventListener("click", async () => {
            if (!text.value.trim()) return;

            save.disabled = true;

            const answer = await call<{ case: ICase }>("", { action: "note", case: entry.number, text: text.value });

            save.disabled = false;

            if (answer && shown) {
                shown.case = answer.case;
                paintView();
                toast("info", "Notiz gespeichert", `An Fall #${entry.number}.`);
            }
        });

        const list = el(
            "div",
            "mcnotes",
            ...(entry.notes.length
                ? entry.notes.map((item) => {
                      const line = el("article", "mcnote", el("div", "mcnote__head", el("b", "", item.byName), el("time", "", ago(item.at))), el("p", "", item.text));

                      if (item.by === me.id || me.manage) {
                          const remove = button("iconbtn is-danger mcnote__x", icon("#i-trash"));

                          remove.setAttribute("aria-label", "Notiz entfernen");
                          remove.addEventListener("click", async () => {
                              const answer = await call<{ case: ICase }>("", { action: "note-remove", case: entry.number, id: item.id });

                              if (answer && shown) {
                                  shown.case = answer.case;
                                  paintView();
                              }
                          });
                          line.querySelector(".mcnote__head")!.append(remove);
                      }

                      return line;
                  })
                : [el("p", "mcmuted", "Noch keine Notiz.")])
        );

        return el("section", "mcside", el("h3", "mcside__title", icon("#i-note"), "Notizen"), list, text, save);
    }

    function evidence(entry: ICase, me: IDetail["me"]): HTMLElement {
        const file = el("input", "");
        const upload = button("btn btn--quiet", icon("#i-upload"), "Bild hochladen");
        const link = el("input", "text");
        const add = button("iconbtn", icon("#i-plus"));

        file.type = "file";
        file.accept = "image/png,image/jpeg,image/gif,image/webp";
        file.hidden = true;
        upload.addEventListener("click", () => file.click());
        file.addEventListener("change", async () => {
            const chosen = file.files?.[0];

            file.value = "";

            if (!chosen) return;

            if (chosen.size > 8 * 1024 * 1024) {
                warn("Das Bild ist größer als 8 MB.");

                return;
            }

            upload.disabled = true;

            try {
                const response = await fetch(`${api}/evidence/${entry.number}?name=${encodeURIComponent(chosen.name)}`, {
                    method: "POST",
                    headers: { "Content-Type": chosen.type, Accept: "application/json" },
                    body: chosen,
                });
                const failure = await failureText(response);

                warn(failure);

                if (failure === null) {
                    toast("info", "Beweis angehängt", `„${chosen.name}“ hängt an Fall #${entry.number}.`);
                    await view(entry.number);
                }
            } catch {
                warn("Der Bot antwortet gerade nicht.");
            } finally {
                upload.disabled = false;
            }
        });

        link.type = "url";
        link.placeholder = "https://… (Link als Beweis)";
        link.setAttribute("aria-label", "Link als Beweis");
        add.setAttribute("aria-label", "Link anhängen");
        add.addEventListener("click", async () => {
            if (!link.value.trim()) return;

            const answer = await call<{ case: ICase }>("", { action: "link", case: entry.number, url: link.value.trim() });

            if (answer && shown) {
                shown.case = answer.case;
                paintView();
            }
        });

        const grid = el(
            "div",
            "mcevid",
            ...(entry.evidence.length
                ? entry.evidence.map((item) => {
                      const open = el("a", `mcevid__item mcevid__item--${item.kind}`);

                      open.href = item.url;
                      open.target = "_blank";
                      open.rel = "noopener noreferrer";
                      open.title = `${item.name ?? item.url} · ${item.byName}`;

                      if (item.kind === "image") {
                          const image = el("img", "");

                          image.src = item.url;
                          image.alt = item.name ?? "Beweisbild";
                          image.loading = "lazy";
                          open.append(image);
                      } else {
                          open.append(icon("#i-link"), el("span", "", item.name ?? new URL(item.url).hostname));
                      }

                      const box = el("div", "mcevid__cell", open);

                      if (item.by === me.id || me.manage) {
                          const remove = button("iconbtn is-danger mcevid__x", icon("#i-x"));

                          remove.setAttribute("aria-label", "Beweis entfernen");
                          remove.addEventListener("click", async () => {
                              const answer = await call<{ case: ICase }>("", { action: "evidence-remove", case: entry.number, id: item.id });

                              if (answer && shown) {
                                  shown.case = answer.case;
                                  paintView();
                              }
                          });
                          box.append(remove);
                      }

                      return box;
                  })
                : [el("p", "mcmuted", "Noch kein Beweis.")])
        );

        return el("section", "mcside", el("h3", "mcside__title", icon("#i-paperclip"), "Beweise"), grid, el("div", "mcevid__add", upload, file, link, add));
    }

    /* ------------------------------------------------------------
       Neue Aktion
       ------------------------------------------------------------ */
    const draft = {
        action: "warn" as Action,
        target: null as IPerson | null,
        reason: "",
        duration: 3_600 as number | null,
        custom: "",
        deleteSeconds: 0,
        count: 20,
        channelId: null as string | null,
        caseNumber: null as number | null,
    };
    // Zeitpunkt des ersten Klicks bei Bann, Kick und Löschen - der zweite zählt.
    let sure = 0;
    let pickTimer = 0;

    async function act(request: Record<string, unknown>): Promise<ICase | null> {
        const answer = await call<{ case: ICase }>("", { action: "act", request });

        if (!answer) return null;

        const entry = answer.case;

        toast("info", `${ACTIONS[entry.action].label} · Fall #${entry.number}`, entry.target ? `${entry.target.name} – erledigt.` : "Erledigt.");
        void load(true, true);

        return entry;
    }

    function card(title: string, lead: string, ...children: HTMLElement[]): HTMLElement {
        return el("section", "tkcard", el("h3", "tkcard__title", title), ...(lead ? [el("p", "tkcard__lead", lead)] : []), ...children);
    }

    function field(label: string, control: HTMLElement, hint = ""): HTMLElement {
        return el("label", "mcfield", el("span", "mcfield__label", label), control, ...(hint ? [el("small", "mcfield__hint", hint)] : []));
    }

    /** Wen: Suche unter Mitgliedern oder in der Bannliste - ausgewählt steht er als Karte da. */
    function personPicker(kind: "members" | "bans", chosen: IPerson | null, onPick: (person: IPerson | null) => void, placeholder: string): HTMLElement {
        if (chosen) {
            const change = button("btn btn--quiet mcchosen__change", "Ändern");

            change.addEventListener("click", () => onPick(null));

            return el("div", "mcchosen", face(chosen, "mcchosen__face"), el("div", "mcchosen__name", el("b", "", chosen.name), el("code", "mcid", chosen.id)), change);
        }

        const input = el("input", "text");
        const results = el("div", "mcpeople");
        let asked = 0;

        const ask = async (text: string): Promise<void> => {
            const mine = ++asked;
            const answer = await call<{ members?: IPerson[]; bans?: IPerson[] }>("", { action: kind, query: text });

            if (mine !== asked) return;

            const found = (kind === "members" ? answer?.members : answer?.bans) ?? [];

            results.replaceChildren(
                ...(found.length
                    ? found.map((person) => {
                          const pick = button("ltperson", face(person), el("span", "", person.name));

                          pick.addEventListener("click", () => onPick({ id: person.id, name: person.name, avatar: person.avatar }));

                          return pick;
                      })
                    : text || kind === "bans"
                      ? [el("span", "tkempty", kind === "bans" ? "Niemand in der Bannliste gefunden." : "Niemand gefunden.")]
                      : [])
            );
        };

        input.type = "search";
        input.placeholder = placeholder;
        input.dataset.key = `pick-${kind}`;
        input.setAttribute("aria-label", placeholder);
        input.addEventListener("input", () => {
            window.clearTimeout(pickTimer);
            pickTimer = window.setTimeout(() => {
                const text = input.value.trim();

                if (text || kind === "bans") void ask(text);
                else results.replaceChildren();
            }, 250);
        });

        // Die Bannliste steht gleich da - sie ist meist kurz.
        if (kind === "bans") void ask("");

        return el("div", "mcpick", input, results);
    }

    /** Die aktiven Verwarnungen des gewählten Users zum Auswählen - für "Verwarnung entfernen". */
    function warnPicker(person: IPerson): HTMLElement {
        const list = el("div", "mcwarns", el("span", "tkempty", "Verwarnungen laden …"));

        void call<IList>(`?user=${person.id}&action=warn&status=active`).then((data) => {
            const warns = data?.cases ?? [];

            if (!warns.length) {
                list.replaceChildren(el("span", "tkempty", `${person.name} hat keine aktive Verwarnung.`));

                return;
            }

            if (!warns.some((warn) => warn.number === draft.caseNumber)) draft.caseNumber = warns[0].number;

            list.replaceChildren(
                ...warns.map((warn) => {
                    const pick = button("mcwarn", el("b", "", `#${warn.number}`), el("span", "", warn.reason ?? "ohne Grund"), el("time", "", ago(warn.createdAt)));

                    pick.setAttribute("role", "radio");
                    pick.setAttribute("aria-checked", String(warn.number === draft.caseNumber));
                    pick.addEventListener("click", () => {
                        draft.caseNumber = warn.number;

                        for (const other of list.querySelectorAll("[role=radio]")) other.setAttribute("aria-checked", String(other === pick));

                        paintSubmit();
                    });

                    return pick;
                })
            );
            list.setAttribute("role", "radiogroup");
            list.setAttribute("aria-label", "Welche Verwarnung");
            paintSubmit();
        });

        return list;
    }

    const submitHost = el("div", "mcsubmit");

    /** Der Satz, was gleich passiert - und was noch fehlt. */
    function summary(): { text: string; missing: string | null } {
        const who = draft.target?.name ?? "";
        const duration = draft.duration ? formatDuration(draft.duration) : null;

        switch (draft.action) {
            case "warn":
                return { text: `${who} wird verwarnt.`, missing: !draft.target ? "Wähle, wen." : !draft.reason.trim() ? "Eine Verwarnung braucht einen Grund." : null };
            case "timeout":
                return {
                    text: `${who} wird ${duration ? `für ${duration} ` : ""}stummgeschaltet.`,
                    missing: !draft.target ? "Wähle, wen." : !draft.duration ? "Wie lange? Wähle eine Dauer." : null,
                };
            case "kick":
                return { text: `${who} fliegt vom Server – und kann mit einer Einladung zurück.`, missing: draft.target ? null : "Wähle, wen." };
            case "ban": {
                const wipe = meta?.presets.deletes.find(([seconds]) => seconds === draft.deleteSeconds);

                return {
                    text: `${who} wird ${duration ? `für ${duration}` : "dauerhaft"} gebannt${draft.deleteSeconds && wipe ? ` – Nachrichten (${wipe[1].toLowerCase()}) verschwinden` : ""}.`,
                    missing: draft.target ? null : "Wähle, wen.",
                };
            }
            case "unban":
                return { text: `${who} darf wieder auf den Server.`, missing: draft.target ? null : "Wähle, wen – aus der Bannliste." };
            case "untimeout":
                return { text: `${who} darf wieder schreiben und sprechen.`, missing: draft.target ? null : "Wähle, wen." };
            case "unwarn":
                return { text: `Verwarnung #${draft.caseNumber ?? "?"} zählt nicht mehr.`, missing: draft.caseNumber ? null : "Wähle die Verwarnung." };
            case "purge": {
                const channel = meta?.channels.find((entry) => entry.id === draft.channelId);

                return {
                    text: `Die letzten ${draft.count} Nachrichten${draft.target ? ` von ${draft.target.name}` : ""} in #${channel?.name ?? "?"} verschwinden.`,
                    missing: channel ? null : "Wähle den Kanal.",
                };
            }
        }
    }

    function paintSubmit(): void {
        const { text, missing } = summary();
        const info = ACTIONS[draft.action];
        const armed = CONFIRM.has(draft.action) && Date.now() - sure < 4_000;
        const go = button(`btn btn--primary mcgo-main${armed ? " is-sure" : ""}`, icon(info.symbol), armed ? `Wirklich: ${info.verb}?` : info.verb);

        go.disabled = missing !== null;
        go.dataset.key = "mc-submit";
        go.addEventListener("click", async () => {
            if (CONFIRM.has(draft.action) && Date.now() - sure >= 4_000) {
                sure = Date.now();
                paintSubmit();
                submitHost.querySelector<HTMLElement>("[data-key=mc-submit]")?.focus();
                window.setTimeout(() => paintSubmit(), 4_000);

                return;
            }

            sure = 0;
            go.disabled = true;

            const entry = await act({
                action: draft.action,
                targetId: draft.target?.id ?? null,
                reason: draft.reason.trim() || null,
                duration: draft.action === "timeout" || draft.action === "ban" ? draft.duration : null,
                deleteSeconds: draft.action === "ban" ? draft.deleteSeconds : null,
                count: draft.action === "purge" ? draft.count : null,
                channelId: draft.action === "purge" ? draft.channelId : null,
                caseNumber: draft.action === "unwarn" ? draft.caseNumber : null,
            });

            if (!entry) {
                paintSubmit();

                return;
            }

            draft.target = null;
            draft.reason = "";
            draft.caseNumber = null;
            paintPane();
            await view(entry.number);
        });

        submitHost.replaceChildren(
            el("p", `mcsum${missing ? " is-missing" : ""}`, missing ?? text),
            go
        );
    }

    function durationPicker(permanent: boolean, max: number): HTMLElement {
        const presets = (meta?.presets.durations ?? []).filter(([, seconds]) => seconds <= max && (!permanent || seconds >= 3_600));
        const chips = el("div", "mcdur");
        const custom = el("input", "text mcdur__custom");
        const said = el("small", "mcfield__hint", "");

        const paint = (): void => {
            chips.replaceChildren(
                ...(permanent ? [["Dauerhaft", 0] as [string, number]] : []).concat(presets).map(([label, seconds]) => {
                    const pick = button("mcdur__chip", label);
                    const value = seconds || null;

                    pick.setAttribute("aria-pressed", String(draft.duration === value && !draft.custom));
                    pick.addEventListener("click", () => {
                        draft.duration = value;
                        draft.custom = "";
                        custom.value = "";
                        said.textContent = "";
                        paint();
                        paintSubmit();
                    });

                    return pick;
                })
            );
        };

        custom.type = "text";
        custom.placeholder = "Eigene Dauer, z. B. 2h 30m";
        custom.value = draft.custom;
        custom.setAttribute("aria-label", "Eigene Dauer");
        custom.addEventListener("input", () => {
            draft.custom = custom.value;

            const seconds = parseDuration(custom.value);

            if (!custom.value.trim()) {
                said.textContent = "";
            } else if (seconds === null || seconds < 60 || seconds > max) {
                draft.duration = null;
                said.textContent = seconds === null ? "Verstehe ich nicht – etwa 10m, 2h, 3d oder 1w." : `Zwischen 60 Sekunden und ${formatDuration(max)}.`;
            } else {
                draft.duration = seconds;
                said.textContent = `= ${formatDuration(seconds)}`;
            }

            paint();
            paintSubmit();
        });

        paint();

        return el("div", "mcdurbox", chips, custom, said);
    }

    function actPane(): HTMLElement[] {
        if (!meta) return [el("p", "mcmuted", "Lädt …")];

        const allowed = ORDER.filter((action) => meta!.me.actions.includes(action));

        if (!allowed.length) {
            return [
                el(
                    "div",
                    "tkempty tkempty--big",
                    icon("#i-lock"),
                    el("b", "", "Hier ist keine Aktion frei."),
                    el("span", "", "Dafür braucht es einen Platz auf der Moderatoren-Liste oder die passenden Rechte in Discord.")
                ),
            ];
        }

        if (!allowed.includes(draft.action)) draft.action = allowed[0];

        // 1. Was
        const picker = el("div", "mcacts");

        picker.setAttribute("role", "radiogroup");
        picker.setAttribute("aria-label", "Aktion");

        for (const action of allowed) {
            const tile = button(`mcact mcact--${ACTIONS[action].tone}`, badge(action), el("span", "", ACTIONS[action].verb));

            tile.dataset.key = `act-${action}`;
            tile.setAttribute("role", "radio");
            tile.setAttribute("aria-checked", String(action === draft.action));
            tile.addEventListener("click", () => {
                if (draft.action === action) return;

                clickSound("primary");

                // Wer aus der Bannliste kommt, ist kein Mitglied - und umgekehrt.
                if ((action === "unban") !== (draft.action === "unban")) draft.target = null;

                draft.action = action;
                draft.caseNumber = null;
                draft.custom = "";
                draft.duration = action === "timeout" ? 3_600 : null;
                sure = 0;
                paintPane();
                pane.querySelector<HTMLElement>(`[data-key="act-${action}"]`)?.focus();
            });
            picker.append(tile);
        }

        // 2. Wer oder wo
        const who: HTMLElement[] = [];
        const pickPerson = (person: IPerson | null): void => {
            draft.target = person;
            draft.caseNumber = null;
            paintPane();

            if (!person) pane.querySelector<HTMLElement>("[data-key^=pick-]")?.focus();
        };

        if (draft.action === "unban") {
            who.push(personPicker("bans", draft.target, pickPerson, "In der Bannliste suchen: Name oder ID …"));
        } else if (draft.action === "purge") {
            const channel = el("select", "pick");
            const count = el("input", "text mccount__input");

            channel.append(new Option("— Kanal wählen —", ""), ...meta.channels.map((entry) => new Option(`# ${entry.name}`, entry.id)));
            channel.value = draft.channelId ?? "";
            channel.addEventListener("change", () => {
                draft.channelId = channel.value || null;
                paintSubmit();
            });

            count.type = "number";
            count.min = "1";
            count.max = "100";
            count.value = String(draft.count);
            count.addEventListener("input", () => {
                draft.count = Math.min(Math.max(Math.round(Number(count.value) || 1), 1), 100);
                paintSubmit();
            });

            who.push(
                el("div", "mcgrid2", field("Kanal", channel), field("Wie viele", count, "1 bis 100 – nur die letzten 14 Tage, angeheftete bleiben.")),
                field("Nur von einem User (optional)", personPicker("members", draft.target, pickPerson, "Mitglied suchen: Name oder ID …"))
            );
        } else {
            who.push(personPicker("members", draft.target, pickPerson, "Mitglied suchen: Name oder ID …"));

            if (draft.action === "unwarn" && draft.target) who.push(field("Welche Verwarnung", warnPicker(draft.target)));
        }

        // 3. Details
        const reason = el("textarea", "text mcreason");

        reason.rows = 3;
        reason.maxLength = 500;
        reason.value = draft.reason;
        reason.dataset.key = "mc-reason";
        reason.placeholder =
            draft.action === "warn" ? "Was ist passiert? Steht im Log und in der DM." : "Warum? Steht im Log – und, wo es eine gibt, in der DM.";
        reason.addEventListener("input", () => {
            draft.reason = reason.value;
            paintSubmit();
        });

        const details: HTMLElement[] = [field(draft.action === "warn" ? "Grund (Pflicht)" : "Grund", reason)];

        if (draft.action === "timeout") details.push(field("Dauer", durationPicker(false, 28 * 86_400)));

        if (draft.action === "ban") {
            const wipe = el("select", "pick");

            wipe.append(...meta.presets.deletes.map(([seconds, label]) => new Option(label, String(seconds))));
            wipe.value = String(draft.deleteSeconds);
            wipe.addEventListener("change", () => {
                draft.deleteSeconds = Number(wipe.value);
                paintSubmit();
            });

            details.push(field("Dauer", durationPicker(true, 365 * 86_400)), field("Nachrichten mitlöschen", wipe));
        }

        if (draft.action === "warn" && meta.config.stages.length) {
            details.push(
                el(
                    "p",
                    "hintline",
                    `Stufen: ${meta.config.stages
                        .map((stage) => `${stage.warns} → ${ACTIONS[stage.action].label}${stage.duration ? ` ${formatDuration(stage.duration)}` : ""}`)
                        .join(" · ")} – greifen von selbst.`
                )
            );
        }

        if (meta.config.dm && ["warn", "timeout", "kick", "ban", "untimeout", "unwarn"].includes(draft.action)) {
            details.push(el("p", "hintline", "Der User bekommt eine DM mit Grund und Dauer – ohne deinen Namen."));
        }

        paintSubmit();

        return [
            card("Was passiert?", "", picker),
            card(draft.action === "purge" ? "Wo?" : "Wen betrifft es?", "", ...who),
            card("Details", "", ...details, submitHost),
        ];
    }

    /* ------------------------------------------------------------
       Einstellungen
       ------------------------------------------------------------ */
    let settingsDraft: IConfig | null = null;
    let settingsDirty = false;

    function settingsPane(): HTMLElement[] {
        if (!meta || !settingsDraft) return [el("p", "mcmuted", "Lädt …")];

        const cfg = settingsDraft;
        const save = button("btn btn--primary", icon("#i-check"), "Speichern");
        const reset = button("btn btn--quiet", "Verwerfen");
        const touch = (): void => {
            settingsDirty = true;
            save.disabled = false;
            reset.disabled = false;
        };

        save.disabled = !settingsDirty;
        reset.disabled = !settingsDirty;

        const log = logTargetSelect(
            meta.targets ?? { channels: [], forums: [], threads: [] },
            cfg.logChannelId,
            (value) => {
                cfg.logChannelId = value;
                touch();
            },
            async (forumId) => {
                const answer = await call<{ thread: ILogThread }>("", { action: "logthread", forumId });

                if (answer) toast("info", "Beitrag angelegt", `„${answer.thread.name}“ in #${answer.thread.parentName} – speichern nicht vergessen.`);

                return answer?.thread ?? null;
            },
            "— kein Log —"
        );

        const dm = el("input", "switch");

        dm.type = "checkbox";
        dm.checked = cfg.dm;
        dm.setAttribute("aria-label", "DM an den User");
        dm.addEventListener("change", () => {
            cfg.dm = dm.checked;
            touch();
        });

        const days = el("select", "pick");

        days.append(...[0, 30, 60, 90, 180, 365].map((value) => new Option(value ? `${value} Tage` : "für immer", String(value))));
        days.value = String(cfg.warnDays);
        days.setAttribute("aria-label", "Wie lange Verwarnungen zählen");
        days.addEventListener("change", () => {
            cfg.warnDays = Number(days.value);
            touch();
        });

        const stages = el("div", "mcstages");
        const paintStages = (): void => {
            stages.replaceChildren(
                ...(cfg.stages.length
                    ? cfg.stages.map((stage, index) => {
                          const warns = el("input", "text mcstage__warns");
                          const action = el("select", "pick");
                          const length = el("select", "pick");
                          const remove = button("iconbtn is-danger", icon("#i-trash"));

                          warns.type = "number";
                          warns.min = "1";
                          warns.max = "50";
                          warns.value = String(stage.warns);
                          warns.setAttribute("aria-label", `Stufe ${index + 1}: ab so vielen Verwarnungen`);
                          warns.addEventListener("change", () => {
                              stage.warns = Math.min(Math.max(Math.round(Number(warns.value) || 1), 1), 50);
                              warns.value = String(stage.warns);
                              touch();
                          });

                          action.append(new Option("Timeout", "timeout"), new Option("Kick", "kick"), new Option("Bann", "ban"));
                          action.value = stage.action;
                          action.setAttribute("aria-label", `Stufe ${index + 1}: was passiert`);
                          action.addEventListener("change", () => {
                              stage.action = action.value as IStage["action"];
                              stage.duration = stage.action === "timeout" ? 3_600 : null;
                              touch();
                              paintStages();
                          });

                          const choices = (meta!.presets.durations ?? []).filter(([, seconds]) => seconds <= 28 * 86_400 || stage.action === "ban");

                          length.append(
                              ...(stage.action === "ban" ? [new Option("dauerhaft", "")] : []),
                              ...choices.map(([label, seconds]) => new Option(label, String(seconds)))
                          );
                          length.value = stage.duration ? String(stage.duration) : "";
                          length.hidden = stage.action === "kick";
                          length.setAttribute("aria-label", `Stufe ${index + 1}: wie lange`);
                          length.addEventListener("change", () => {
                              stage.duration = length.value ? Number(length.value) : null;
                              touch();
                          });

                          remove.setAttribute("aria-label", `Stufe ${index + 1} entfernen`);
                          remove.addEventListener("click", () => {
                              cfg.stages.splice(index, 1);
                              touch();
                              paintStages();
                          });

                          return el(
                              "div",
                              "mcstage",
                              el("span", "mcstage__label", "ab"),
                              warns,
                              el("span", "mcstage__label", "Verwarnungen"),
                              icon("#i-arrow"),
                              action,
                              length,
                              remove
                          );
                      })
                    : [el("p", "mcmuted", "Keine Stufen – Verwarnungen bleiben dann ohne Folgen.")])
            );
        };

        const add = button("tkadd", icon("#i-plus"), el("span", "", "Stufe hinzufügen"));

        add.addEventListener("click", () => {
            if (cfg.stages.length >= 10) return;

            const next = Math.max(0, ...cfg.stages.map((stage) => stage.warns)) + 1;

            cfg.stages.push({ warns: Math.min(next, 50), action: "timeout", duration: 3_600 });
            touch();
            paintStages();
        });

        paintStages();

        save.addEventListener("click", async () => {
            save.disabled = true;

            const answer = await call<{ config: IConfig; targets: ILogTargets }>("", { action: "save", config: cfg });

            if (!answer) {
                save.disabled = false;

                return;
            }

            meta!.config = answer.config;
            meta!.targets = answer.targets;
            settingsDraft = structuredClone(answer.config);
            settingsDirty = false;
            toast("info", "Gespeichert", "Die Moderation arbeitet ab jetzt so.");
            paintPane();
        });

        reset.addEventListener("click", () => {
            settingsDraft = structuredClone(meta!.config);
            settingsDirty = false;
            paintPane();
        });

        return [
            card(
                "Log und Benachrichtigung",
                "Jeder Fall als Karte im Log – ein Textkanal oder ein Beitrag in einem Forum. Die Karte zieht nach, wenn sich am Fall etwas ändert.",
                el("div", "row", el("div", "row__text", el("b", "", "Log-Kanal"), el("i", "", "Textkanal oder Forum-Beitrag")), log),
                el("div", "row", el("div", "row__text", el("b", "", "DM an den User"), el("i", "", "Grund und Dauer – ohne den Namen des Moderators")), dm)
            ),
            card(
                "Verwarnungen und Stufen",
                "Erreicht ein User so viele aktive Verwarnungen, folgt die Strafe von selbst – als eigener Fall mit Verweis auf die Verwarnung.",
                el("div", "row", el("div", "row__text", el("b", "", "Verwarnungen zählen"), el("i", "", "Ältere zählen für die Stufen nicht mehr mit")), days),
                stages,
                add
            ),
            el("div", "mcsave", reset, save),
        ];
    }

    /* ------------------------------------------------------------
       Start
       ------------------------------------------------------------ */
    let visible = !section.hidden;

    new MutationObserver(() => {
        if (!section.hidden && !visible) void load(true, true);

        visible = !section.hidden;
    }).observe(section, { attributes: true, attributeFilter: ["hidden"] });

    paintHead();
    paintTabs();
    paintPane();

    void load(true).then(() => {
        const wanted = Number(params.get("fall"));

        if (Number.isInteger(wanted) && wanted > 0) void view(wanted);
    });
}
