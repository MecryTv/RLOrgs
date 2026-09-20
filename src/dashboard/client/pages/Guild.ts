/** Seite: Serverdetail. */

import { IGuild, IGuildDetail } from "../interfaces/IGuild.js";
import { IPayload } from "../interfaces/IUser.js";
import { clone, icon, need, maybe } from "../core/Dom.js";
import { countMembers, paintCrest } from "../layout/GuildCard.js";
import { monthOf, numbers } from "../core/Format.js";
import { ROLE_ICONS, ROLE_LABELS } from "../constants/Groups.js";
import { CATEGORIES, IModulePart, MODULES } from "../constants/Modules.js";
import { clickSound } from "../core/Sound.js";
import { BASE } from "../core/Base.js";
import { ActivityResult, fetchActivity, renderOverview } from "./GuildOverview.js";

// Was ein Supporter ohne "Server verwalten" sieht - die Teile des Ticket-Systems.
const SUPPORT_SECTIONS = ["live-tickets", "transcriptions"];

/* ----------------------------------------------------------
   Seite: Serverdetail

   Die Adresse trägt beides: welchen Server und welchen Abschnitt.
   /guild/<id>/uebersicht, /guild/<id>/module, /guild/<id>/tickets - jeder
   Abschnitt ist eine eigene Adresse, die sich teilen lässt und im Verlauf
   zurückgeht. Geladen wird beim Wechsel nichts neu.
   ---------------------------------------------------------- */
const ROUTE = /\/guild\/(\d{17,20})(?:\/([a-z0-9-]+))?\/?$/;

function route(): { id: string; section: string } {
    const found = ROUTE.exec(window.location.pathname);

    return { id: found?.[1] ?? "", section: found?.[2] ?? "uebersicht" };
}

// Beide Abfragen der Serverseite hängen nur an der Adresse, nicht an /api/me -
// sie starten deshalb schon, während die Serverliste noch unterwegs ist. Das
// spart einen ganzen Umlauf, bevor die Übersicht steht.
let pending: { detail: Promise<IGuildDetail | null>; activity: Promise<ActivityResult> } | null = null;

export function prefetchGuild(): void {
    const { id } = route();

    if (!id) return;

    pending = { detail: fetchDetail(id), activity: fetchActivity(id) };
}

export function dayOf(iso: string | null): string | null {
    if (!iso) return null;

    const date = new Date(iso);

    return Number.isNaN(date.getTime())
        ? null
        : date.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
}

export function fact(label: string, value: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "fact";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    description.textContent = value;

    row.append(term, description);

    return row;
}

async function fetchDetail(id: string): Promise<IGuildDetail | null> {
    try {
        const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(id)}`, {
            headers: { Accept: "application/json" },
        });

        if (!response.ok) return null;

        return (await response.json()) as IGuildDetail;
    } catch {
        return null;
    }
}

// Zahlen des Servers aus dem Bot-Cache, Angaben zum Nutzer aus guilds.members.read.
// Beide Blöcke bleiben weg, wenn es die Daten nicht gibt - nichts wird erfunden.
function paintDetails(detail: IGuildDetail | null): void {
    if (!detail) return;

    // Zusatzblöcke sind eine Ergänzung. Fehlt das Markup, bleibt die Seite stehen,
    // statt an einem need() zu zerbrechen.
    function fill(block: string, list: string, rows: HTMLElement[]): void {
        const host = maybe<HTMLElement>(list);
        const wrapper = maybe<HTMLElement>(block);

        if (!host || !wrapper || rows.length === 0) return;

        host.replaceChildren(...rows);
        wrapper.hidden = false;
    }

    if (detail.server) {
        const rows = [
            fact("Kanäle", numbers.format(detail.server.channels)),
            fact("Rollen", numbers.format(detail.server.roles)),
            fact("Boosts", `${numbers.format(detail.server.boosts)} (Stufe ${detail.server.boostTier})`),
        ];

        if (detail.server.isOwner) rows.push(fact("Deine Rolle", "Du bist Owner dieses Servers"));

        fill("#serverBlock", "#serverFacts", rows);
    }

    if (detail.member) {
        const joined = dayOf(detail.member.joinedAt);
        const rows: HTMLElement[] = [];

        if (joined) rows.push(fact("Mitglied seit", joined));
        if (detail.member.nick) rows.push(fact("Dein Nickname", detail.member.nick));
        rows.push(fact("Deine Rollen", numbers.format(detail.member.roles)));

        fill("#memberBlock", "#memberFacts", rows);
    }
}

export function renderGuild(data: IPayload): void {
    const { id } = route();
    const guild = data.guilds.find((entry) => entry.id === id);
    const panel = need<HTMLElement>("#panel");
    const empty = need<HTMLElement>("#empty");

    if (!guild) {
        empty.classList.add("is-on", "empty--error");
        need<SVGUseElement>("#emptyIcon use").setAttribute("href", "#i-warn");
        need<HTMLElement>("#emptyTitle").textContent = "Kein Zugriff auf diesen Server";
        need<HTMLElement>("#emptyText").textContent =
            "Entweder gibt es den Server nicht, oder du darfst ihn nicht verwalten.";
        return;
    }

    empty.classList.remove("is-on");
    panel.hidden = false;

    document.title = `RL Nexus · ${guild.name}`;

    paintCrest(need<HTMLElement>("#crest"), guild);
    need<HTMLElement>("#guildName").textContent = guild.name;

    const meta = need<HTMLElement>("#guildMeta");
    const role = document.createElement("span");
    role.className = "pill pill--role";
    role.append(icon(ROLE_ICONS[guild.role]), ROLE_LABELS[guild.role]);

    const members = document.createElement("span");
    members.className = "pill";
    members.append(icon("#i-users"), document.createElement("span"));
    members.lastElementChild!.setAttribute("data-members", "");

    const bots = document.createElement("span");
    bots.className = "pill pill--bots";
    bots.hidden = true;
    bots.setAttribute("data-bots", "");
    bots.append(icon("#i-bot"), document.createElement("span"));
    bots.lastElementChild!.setAttribute("data-botcount", "");

    const created = document.createElement("span");
    created.className = "pill";
    created.textContent = `Erstellt ${monthOf(guild.created)}`;

    meta.replaceChildren(role, members, bots, created);
    countMembers(meta, guild);

    // Moderatoren: kein Verwalten - sie sehen nur Live Tickets, Transcriptions
    // und, wenn sie auf der Moderatoren-Liste stehen, die Moderation.
    const supportOnly = !guild.canManage && guild.role === "Moderator";
    const only = supportOnly ? new Set([...SUPPORT_SECTIONS, ...(guild.canModerate ? ["moderation"] : [])]) : null;

    if (!guild.canManage) {
        const note = need<HTMLElement>("#readonly");

        note.hidden = false;

        if (supportOnly) {
            note.querySelector("span")!.textContent =
                `Du bist hier Moderator: Live Tickets${guild.canModerate ? ", Transcriptions und die Moderation stehen" : " und Transcriptions stehen"} dir offen. Einstellungen brauchen „Server verwalten“ auf dem Server selbst.`;
        }
    }

    // Wurde die Seite direkt aufgerufen, laufen die Abfragen schon; sonst hier.
    const waiting = pending ?? { detail: fetchDetail(guild.id), activity: fetchActivity(guild.id) };

    // Erst die Leiste mit dem Stand aus /api/me, dann die Abschnitte: sonst
    // landete eine Adresse auf einem ausgeschalteten Modul auf dessen Karte.
    const loadModules = bindModules(guild, only);
    const show = bindSections(guild.id, supportOnly ? "live-tickets" : "uebersicht");

    const user = { id: data.user.id, name: data.user.name, avatar: data.user.avatar };

    // Was ein Moderator nicht sehen darf, wird gar nicht erst geladen. Der Rest
    // erst, wenn sein Abschnitt das erste Mal offen ist - Code und Abfragen.
    if (!supportOnly) {
        void renderOverview(guild, data.user.id, waiting.activity);
        whenShown(["gallery"], () => void import("./GuildGallery.js").then((module) => module.renderGallery(guild.id, guild.canManage)));
        whenShown(["tickets"], () => void import("./GuildTickets.js").then((module) => module.renderTickets(guild.id, guild.canManage, user)));

        if (guild.canManage) whenShown(["team"], () => void import("./GuildTeam.js").then((module) => module.renderTeam(guild.id)));

        // Community-Module: Code und Abfragen kommen erst, wenn der Abschnitt aufgeht.
        whenShown(["welcome"], () => void import("./GuildWelcome.js").then((module) => module.renderWelcome(guild.id)));
        whenShown(["custom-message"], () => void import("./GuildMessages.js").then((module) => module.renderMessages(guild.id)));
        whenShown(["levels"], () => void import("./GuildLevels.js").then((module) => module.renderLevels(guild.id)));
        whenShown(["leaderboard"], () => void import("./GuildLeaderboard.js").then((module) => module.renderLeaderboard(guild.id)));
        whenShown(["voice-hub"], () => void import("./GuildVoice.js").then((module) => module.renderVoice(guild.id)));
        whenShown(["twitch-notifier"], () => void import("./GuildStreams.js").then((module) => module.renderStreams(guild.id, "twitch")));
        whenShown(["youtube-notifier"], () => void import("./GuildStreams.js").then((module) => module.renderStreams(guild.id, "youtube")));
        whenShown(["polls"], () => void import("./GuildPolls.js").then((module) => module.renderPolls(guild.id)));
        whenShown(["giveaways"], () => void import("./GuildGiveaways.js").then((module) => module.renderGiveaways(guild.id)));
    }

    whenShown(["transcriptions"], () => void import("./GuildTranscripts.js").then((module) => module.renderTranscripts(guild.id)));

    if (guild.canModerate) whenShown(["moderation"], () => void import("./GuildModeration.js").then((module) => module.renderModeration(guild.id)));
    else maybe<HTMLElement>("#modNote")?.removeAttribute("hidden");
    // Live Tickets meldet fertige Transcripts - der Stream läuft auch, wenn nur Transcriptions offen ist.
    whenShown(["live-tickets", "transcriptions"], () => void import("./GuildLive.js").then((module) => module.renderLive(guild.id, user)));

    void waiting.detail.then((detail) => {
        paintDetails(detail);

        // Kommt keiner der beiden Blöcke an, sagt die Übersicht das, statt leer
        // dazustehen.
        need<HTMLElement>("#noFacts").hidden =
            !need<HTMLElement>("#serverBlock").hidden || !need<HTMLElement>("#memberBlock").hidden;

        loadModules(detail?.modules ?? null);

        // Der Stand aus der Datenbank kann von dem aus /api/me abweichen - erst
        // jetzt steht fest, welcher Abschnitt überhaupt offen sein darf.
        show(route().section);
    });
}

/* ----------------------------------------------------------
   Abschnitte
   ---------------------------------------------------------- */

/**
 * Startet einen Abschnitt, sobald eine seiner Karten zum ersten Mal sichtbar
 * ist. Bis dahin lädt weder sein Code noch fragt er beim Bot nach - wer nur die
 * Übersicht ansieht, lädt keinen Ticket-Editor.
 */
function whenShown(ids: string[], start: () => void): void {
    const sections = ids.map((id) => maybe<HTMLElement>(`#${id}`)).filter((section): section is HTMLElement => section !== null);
    let started = false;

    const check = (): void => {
        if (started || sections.every((section) => section.hidden)) return;

        started = true;
        start();
    };

    for (const section of sections) new MutationObserver(check).observe(section, { attributes: true, attributeFilter: ["hidden"] });

    check();
}

// Den markierten Eintrag in den sichtbaren Teil der Leiste holen: bei einem Link
// auf ein Modul weit unten stünde er sonst außer Sicht. Es scrollt nur die
// Leiste, nie die Seite, und erst mit den Schriften - vorher stimmen die Höhen
// der Einträge noch nicht.
function reveal(link: HTMLElement, nav: HTMLElement): void {
    void document.fonts.ready.then(() => {
        const item = link.getBoundingClientRect();
        const box = nav.getBoundingClientRect();
        // Ganz oben ragt die Leiste noch unter den Fensterrand.
        const bottom = Math.min(box.bottom, window.innerHeight);

        if (item.bottom > bottom) nav.scrollTop += item.bottom - bottom;
        else if (item.top < box.top) nav.scrollTop -= box.top - item.top;

        if (item.right > box.right) nav.scrollLeft += item.right - box.right;
        else if (item.left < box.left) nav.scrollLeft -= box.left - item.left;
    });
}

/**
 * Verbindet Leiste und Karten mit der Adresse. Ein Klick tauscht die Karte und
 * hängt einen Eintrag in den Verlauf - neu geladen wird nichts, die Seite hat
 * schon alles. Zurück und Vorwärts funktionieren trotzdem.
 */
function bindSections(guildId: string, fallback: string): (section: string) => void {
    const nav = need<HTMLElement>("#setNav");
    const cards = [...document.querySelectorAll<HTMLElement>("#moduleCards > section")];
    const links = (): HTMLAnchorElement[] => [...nav.querySelectorAll<HTMLAnchorElement>("a[data-section]")];

    // Die beiden festen Einträge stehen im HTML, ihre Adresse kann erst hier
    // stehen: vorher ist nicht klar, um welchen Server es geht.
    for (const link of links()) link.href = `${BASE}/guild/${guildId}/${link.dataset.section ?? "uebersicht"}`;

    function show(wanted: string): void {
        // Unbekannt oder ausgeschaltet: dann die Übersicht (für Supporter Live
        // Tickets) - und die Adresse sagt danach auch, was zu sehen ist.
        const open = links().find((link) => !link.hidden && link.dataset.section === wanted);
        // Ist auch der Rückfall versteckt (Moderator ohne Tickets), dann der erste offene Eintrag.
        const first = links().find((link) => !link.hidden && link.dataset.section === fallback) ?? links().find((link) => !link.hidden);
        const section = open?.dataset.section ?? first?.dataset.section ?? fallback;

        for (const card of cards) card.hidden = card.id !== section;

        for (const link of links()) {
            if (link.dataset.section !== section) {
                link.removeAttribute("aria-current");
                continue;
            }

            link.setAttribute("aria-current", "page");
            reveal(link, nav);
        }

        const path = `${BASE}/guild/${guildId}/${section}`;

        if (window.location.pathname !== path) history.replaceState(null, "", path);
    }

    nav.addEventListener("click", (event) => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-section]");

        // Mit Strg, Shift oder Mittelklick will jemand einen neuen Tab - dann
        // gehört die Adresse dem Browser.
        if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

        event.preventDefault();
        history.pushState(null, "", link.href);
        show(link.dataset.section ?? "uebersicht");
        clickSound("primary");
    });

    window.addEventListener("popstate", () => show(route().section));

    show(route().section);

    return show;
}

/* ----------------------------------------------------------
   Module

   Eingeschaltet wird unter "Module", gespeichert in guild_settings.modules -
   für den ganzen Server, nicht für diesen Browser. In der Leiste steht ein
   Modul erst, wenn es an ist: ein frischer Server beginnt mit zwei Einträgen
   statt mit zwei Dutzend.

   Teile eines Moduls (Live Tickets, Transcriptions) haben keinen eigenen
   Schalter. Sie stehen eingerückt unter ihrem Modul und kommen mit ihm.
   ---------------------------------------------------------- */

// Warum ein Schalter nicht gespeichert wurde - die Codes, die hier vorkommen.
const FAILED: Record<number, string> = {
    401: "Deine Sitzung ist abgelaufen, lade die Seite neu.",
    403: "Diesen Server darfst du nicht verwalten.",
    429: "Zu viele Schalter auf einmal, warte einen Moment.",
    503: "Der Bot erreicht gerade seine Datenbank nicht.",
};

/**
 * Baut Leiste, Modulkarten und die Schalter unter "Module" und hält sie auf
 * einem Stand. Zurück kommt der Weg, den Stand aus der Datenbank nachzureichen;
 * null heißt, es gibt keinen, und die Schalter bleiben gesperrt.
 */
function bindModules(guild: IGuild, only: Set<string> | null): (modules: string[] | null) => void {
    const nav = need<HTMLElement>("#setNav");
    const cards = need<HTMLElement>("#moduleCards");
    const list = need<HTMLElement>("#moduleList");
    const note = need<HTMLElement>("#moduleNote");

    // Bis der Stand aus der Datenbank da ist, zeigt die Leiste den aus /api/me,
    // und die Schalter bleiben gesperrt - vorher ist nicht klar, ob es überhaupt
    // eine Datenbank gibt.
    let saved = new Set(guild.modules);
    let shown = new Set(saved);
    let ready = false;

    function link(entry: IModulePart, sub: boolean): HTMLAnchorElement {
        const anchor = document.createElement("a");

        anchor.href = `${BASE}/guild/${guild.id}/${entry.id}`;
        anchor.dataset.section = entry.id;
        anchor.hidden = true;

        if (sub) anchor.className = "is-sub";

        anchor.append(icon(entry.icon), entry.name);
        nav.append(anchor);

        return anchor;
    }

    function card(entry: IModulePart): void {
        // Steht die Sektion schon im HTML, gehoert sie einem gebauten Modul und
        // fuellt sich selbst. Nur was es noch nicht gibt, bekommt die Platzkarte.
        if (document.getElementById(entry.id)) return;

        const box = clone("#moduleCard");

        box.id = entry.id;
        box.querySelector(".modhead")!.append(icon(entry.icon), entry.name);
        box.querySelector(".modlead")!.textContent = entry.description;
        cards.append(box);
    }

    // Je Modul: seine Eintraege in der Leiste (das Modul selbst und seine Teile),
    // seine Kachel, sein Schalter und ob es fest dazugehoert.
    const entries = new Map<
        string,
        { links: HTMLElement[]; tile: HTMLElement; input: HTMLInputElement; always: boolean }
    >();

    // Die Leiste steht nach Kategorien: erst die Ueberschrift, dann ihre Module.
    // Die Kacheln unter "Module" bleiben flach - dort gibt es keine Kategorien.
    const groups: { cap: HTMLElement; ids: string[] }[] = [];
    const bars = new Map<string, HTMLElement[]>();

    for (const category of CATEGORIES) {
        const members = MODULES.filter((entry) => entry.category === category.id);

        if (members.length === 0) continue;

        const cap = document.createElement("p");

        cap.className = "setnav__cap";
        cap.textContent = category.name;
        cap.hidden = true;
        nav.append(cap);

        for (const module of members) {
            const own = [link(module, false)];

            for (const part of module.parts ?? []) own.push(link(part, true));

            bars.set(module.id, own);
        }

        groups.push({ cap, ids: members.map((entry) => entry.id) });
    }

    for (const module of MODULES) {
        card(module);

        const tile = clone("#moduleTile");

        tile.querySelector(".acct__mark")!.append(icon(module.icon));
        tile.querySelector("b")!.textContent = module.name;
        tile.querySelector(".acct__text span")!.textContent = module.description;

        if (module.parts) {
            // Was mit angeht, steht auf der Kachel - sonst tauchen zwei Einträge
            // in der Leiste auf, die niemand eingeschaltet hat.
            const parts = document.createElement("span");

            parts.className = "modparts";
            parts.textContent = `Mit dabei: ${module.parts.map((part) => part.name).join(" · ")}`;
            tile.querySelector(".acct__text")!.append(parts);

            for (const part of module.parts) card(part);
        }

        if (module.always) {
            const fixed = document.createElement("span");

            fixed.className = "modalways";
            fixed.textContent = "Immer an – dieses Modul gehört fest dazu.";
            tile.querySelector(".acct__text")!.append(fixed);
        }

        list.append(tile);

        const input = tile.querySelector<HTMLInputElement>("input")!;

        if (!module.always) input.addEventListener("change", () => toggle(module.id, input.checked));

        entries.set(module.id, {
            links: bars.get(module.id) ?? [],
            tile,
            input,
            always: Boolean(module.always),
        });
    }

    // Moderatoren sehen weder Übersicht noch Module - nur, was in only steht.
    if (only) {
        for (const fixed of nav.querySelectorAll<HTMLElement>('a[data-section="uebersicht"], a[data-section="module"]')) fixed.hidden = true;
    }

    // Die Moderatoren stellt nur ein, wer den Server verwalten darf.
    nav.querySelector<HTMLElement>('a[data-section="team"]')!.hidden = !guild.canManage || only !== null;

    function paint(): void {
        for (const [id, entry] of entries) {
            const on = shown.has(id) || entry.always;

            for (const anchor of entry.links) anchor.hidden = !on || (only !== null && !only.has(anchor.dataset.section ?? ""));

            entry.input.checked = on;
            entry.input.disabled = entry.always || !ready || !guild.canManage;
            entry.tile.classList.toggle("acct--on", on);
        }

        // Eine Ueberschrift ohne eingeschaltetes Modul darunter waere eine
        // Zeile, die auf nichts zeigt.
        for (const group of groups) {
            group.cap.hidden = !group.ids.some((id) => entries.get(id)?.links.some((anchor) => !anchor.hidden));
        }
    }

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    // Die Schalter antworten sofort, die Anfragen laufen nacheinander: der Bot
    // liest und schreibt jedes Mal die ganze Liste, zwei zugleich könnten sich
    // gegenseitig überschreiben. Ist die Schlange leer, gilt der Stand des Bots -
    // ein abgelehnter Schalter springt damit von selbst zurück.
    let queue: Promise<void> = Promise.resolve();
    let waiting = 0;
    let failure: string | null = null;

    function toggle(id: string, on: boolean): void {
        if (on) shown.add(id);
        else shown.delete(id);

        paint();
        clickSound("primary");
        waiting++;

        queue = queue.then(async () => {
            failure = (await save(id, on)) ?? failure;

            if (--waiting > 0) return;

            shown = new Set(saved);
            warn(failure === null ? null : `Nicht gespeichert: ${failure}`);
            failure = null;
            paint();
        });
    }

    // Gibt den Grund zurück, wenn der Bot den Schalter nicht übernommen hat.
    async function save(id: string, on: boolean): Promise<string | null> {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guild.id)}/modules`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ module: id, on }),
            });
            const data = (await response.json().catch(() => ({}))) as { modules?: string[] };

            if (response.ok && Array.isArray(data.modules)) {
                saved = new Set(data.modules);

                return null;
            }

            return FAILED[response.status] ?? `Der Bot hat abgelehnt (${response.status}).`;
        } catch {
            return "Der Bot antwortet gerade nicht.";
        }
    }

    paint();

    return (modules) => {
        if (modules === null) {
            warn("Module lassen sich gerade nicht schalten, der Bot erreicht seine Datenbank nicht.");
        } else {
            saved = new Set(modules);
            shown = new Set(modules);
            ready = true;
        }

        paint();
    };
}
