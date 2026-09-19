/** Seite: Serverdetail. */
import { clone, icon, need, maybe } from "../core/Dom.js";
import { countMembers, paintCrest } from "../layout/GuildCard.js";
import { monthOf, numbers } from "../core/Format.js";
import { ROLE_ICONS, ROLE_LABELS } from "../constants/Groups.js";
import { CATEGORIES, MODULES } from "../constants/Modules.js";
import { clickSound } from "../core/Sound.js";
import { BASE } from "../core/Base.js";
import { fetchActivity, renderOverview } from "./GuildOverview.js";
import { renderGallery } from "./GuildGallery.js";
import { renderTickets } from "./GuildTickets.js";
import { renderTranscripts } from "./GuildTranscripts.js";
import { renderLive } from "./GuildLive.js";
// Was ein Supporter ohne "Server verwalten" sieht - die Teile des Ticket-Systems.
const SUPPORT_SECTIONS = new Set(["live-tickets", "transcriptions"]);
/* ----------------------------------------------------------
   Seite: Serverdetail

   Die Adresse trägt beides: welchen Server und welchen Abschnitt.
   /guild/<id>/uebersicht, /guild/<id>/module, /guild/<id>/tickets - jeder
   Abschnitt ist eine eigene Adresse, die sich teilen lässt und im Verlauf
   zurückgeht. Geladen wird beim Wechsel nichts neu.
   ---------------------------------------------------------- */
const ROUTE = /\/guild\/(\d{17,20})(?:\/([a-z0-9-]+))?\/?$/;
function route() {
    const found = ROUTE.exec(window.location.pathname);
    return { id: found?.[1] ?? "", section: found?.[2] ?? "uebersicht" };
}
// Beide Abfragen der Serverseite hängen nur an der Adresse, nicht an /api/me -
// sie starten deshalb schon, während die Serverliste noch unterwegs ist. Das
// spart einen ganzen Umlauf, bevor die Übersicht steht.
let pending = null;
export function prefetchGuild() {
    const { id } = route();
    if (!id)
        return;
    pending = { detail: fetchDetail(id), activity: fetchActivity(id) };
}
export function dayOf(iso) {
    if (!iso)
        return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? null
        : date.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
}
export function fact(label, value) {
    const row = document.createElement("div");
    row.className = "fact";
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    row.append(term, description);
    return row;
}
async function fetchDetail(id) {
    try {
        const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(id)}`, {
            headers: { Accept: "application/json" },
        });
        if (!response.ok)
            return null;
        return (await response.json());
    }
    catch {
        return null;
    }
}
// Zahlen des Servers aus dem Bot-Cache, Angaben zum Nutzer aus guilds.members.read.
// Beide Blöcke bleiben weg, wenn es die Daten nicht gibt - nichts wird erfunden.
function paintDetails(detail) {
    if (!detail)
        return;
    // Zusatzblöcke sind eine Ergänzung. Fehlt das Markup, bleibt die Seite stehen,
    // statt an einem need() zu zerbrechen.
    function fill(block, list, rows) {
        const host = maybe(list);
        const wrapper = maybe(block);
        if (!host || !wrapper || rows.length === 0)
            return;
        host.replaceChildren(...rows);
        wrapper.hidden = false;
    }
    if (detail.server) {
        const rows = [
            fact("Kanäle", numbers.format(detail.server.channels)),
            fact("Rollen", numbers.format(detail.server.roles)),
            fact("Boosts", `${numbers.format(detail.server.boosts)} (Stufe ${detail.server.boostTier})`),
        ];
        if (detail.server.isOwner)
            rows.push(fact("Deine Rolle", "Du bist Owner dieses Servers"));
        fill("#serverBlock", "#serverFacts", rows);
    }
    if (detail.member) {
        const joined = dayOf(detail.member.joinedAt);
        const rows = [];
        if (joined)
            rows.push(fact("Mitglied seit", joined));
        if (detail.member.nick)
            rows.push(fact("Dein Nickname", detail.member.nick));
        rows.push(fact("Deine Rollen", numbers.format(detail.member.roles)));
        fill("#memberBlock", "#memberFacts", rows);
    }
}
export function renderGuild(data) {
    const { id } = route();
    const guild = data.guilds.find((entry) => entry.id === id);
    const panel = need("#panel");
    const empty = need("#empty");
    if (!guild) {
        empty.classList.add("is-on", "empty--error");
        need("#emptyIcon use").setAttribute("href", "#i-warn");
        need("#emptyTitle").textContent = "Kein Zugriff auf diesen Server";
        need("#emptyText").textContent =
            "Entweder gibt es den Server nicht, oder du darfst ihn nicht verwalten.";
        return;
    }
    empty.classList.remove("is-on");
    panel.hidden = false;
    document.title = `RL Nexus · ${guild.name}`;
    paintCrest(need("#crest"), guild);
    need("#guildName").textContent = guild.name;
    const meta = need("#guildMeta");
    const role = document.createElement("span");
    role.className = "pill pill--role";
    role.append(icon(ROLE_ICONS[guild.role]), ROLE_LABELS[guild.role]);
    const members = document.createElement("span");
    members.className = "pill";
    members.append(icon("#i-users"), document.createElement("span"));
    members.lastElementChild.setAttribute("data-members", "");
    const bots = document.createElement("span");
    bots.className = "pill pill--bots";
    bots.hidden = true;
    bots.setAttribute("data-bots", "");
    bots.append(icon("#i-bot"), document.createElement("span"));
    bots.lastElementChild.setAttribute("data-botcount", "");
    const created = document.createElement("span");
    created.className = "pill";
    created.textContent = `Erstellt ${monthOf(guild.created)}`;
    meta.replaceChildren(role, members, bots, created);
    countMembers(meta, guild);
    // Moderatoren: kein Verwalten - sie sehen nur Live Tickets und Transcriptions.
    const supportOnly = !guild.canManage && guild.role === "Moderator";
    if (!guild.canManage) {
        const note = need("#readonly");
        note.hidden = false;
        if (supportOnly) {
            note.querySelector("span").textContent =
                "Du bist hier Moderator: Live Tickets und Transcriptions stehen dir offen. Einstellungen brauchen „Server verwalten“ auf dem Server selbst.";
        }
    }
    // Wurde die Seite direkt aufgerufen, laufen die Abfragen schon; sonst hier.
    const waiting = pending ?? { detail: fetchDetail(guild.id), activity: fetchActivity(guild.id) };
    // Erst die Leiste mit dem Stand aus /api/me, dann die Abschnitte: sonst
    // landete eine Adresse auf einem ausgeschalteten Modul auf dessen Karte.
    const loadModules = bindModules(guild, supportOnly ? SUPPORT_SECTIONS : null);
    const show = bindSections(guild.id, supportOnly ? "live-tickets" : "uebersicht");
    const user = { id: data.user.id, name: data.user.name, avatar: data.user.avatar };
    // Was ein Supporter nicht sehen darf, wird gar nicht erst geladen.
    if (!supportOnly) {
        void renderOverview(guild, data.user.id, waiting.activity);
        renderGallery(guild.id, guild.canManage);
        renderTickets(guild.id, guild.canManage, user);
    }
    renderTranscripts(guild.id);
    renderLive(guild.id, user);
    void waiting.detail.then((detail) => {
        paintDetails(detail);
        // Kommt keiner der beiden Blöcke an, sagt die Übersicht das, statt leer
        // dazustehen.
        need("#noFacts").hidden =
            !need("#serverBlock").hidden || !need("#memberBlock").hidden;
        loadModules(detail?.modules ?? null);
        // Der Stand aus der Datenbank kann von dem aus /api/me abweichen - erst
        // jetzt steht fest, welcher Abschnitt überhaupt offen sein darf.
        show(route().section);
    });
}
/* ----------------------------------------------------------
   Abschnitte
   ---------------------------------------------------------- */
// Den markierten Eintrag in den sichtbaren Teil der Leiste holen: bei einem Link
// auf ein Modul weit unten stünde er sonst außer Sicht. Es scrollt nur die
// Leiste, nie die Seite, und erst mit den Schriften - vorher stimmen die Höhen
// der Einträge noch nicht.
function reveal(link, nav) {
    void document.fonts.ready.then(() => {
        const item = link.getBoundingClientRect();
        const box = nav.getBoundingClientRect();
        // Ganz oben ragt die Leiste noch unter den Fensterrand.
        const bottom = Math.min(box.bottom, window.innerHeight);
        if (item.bottom > bottom)
            nav.scrollTop += item.bottom - bottom;
        else if (item.top < box.top)
            nav.scrollTop -= box.top - item.top;
        if (item.right > box.right)
            nav.scrollLeft += item.right - box.right;
        else if (item.left < box.left)
            nav.scrollLeft -= box.left - item.left;
    });
}
/**
 * Verbindet Leiste und Karten mit der Adresse. Ein Klick tauscht die Karte und
 * hängt einen Eintrag in den Verlauf - neu geladen wird nichts, die Seite hat
 * schon alles. Zurück und Vorwärts funktionieren trotzdem.
 */
function bindSections(guildId, fallback) {
    const nav = need("#setNav");
    const cards = [...document.querySelectorAll("#moduleCards > section")];
    const links = () => [...nav.querySelectorAll("a[data-section]")];
    // Die beiden festen Einträge stehen im HTML, ihre Adresse kann erst hier
    // stehen: vorher ist nicht klar, um welchen Server es geht.
    for (const link of links())
        link.href = `${BASE}/guild/${guildId}/${link.dataset.section ?? "uebersicht"}`;
    function show(wanted) {
        // Unbekannt oder ausgeschaltet: dann die Übersicht (für Supporter Live
        // Tickets) - und die Adresse sagt danach auch, was zu sehen ist.
        const open = links().find((link) => !link.hidden && link.dataset.section === wanted);
        const section = open?.dataset.section ?? fallback;
        for (const card of cards)
            card.hidden = card.id !== section;
        for (const link of links()) {
            if (link.dataset.section !== section) {
                link.removeAttribute("aria-current");
                continue;
            }
            link.setAttribute("aria-current", "page");
            reveal(link, nav);
        }
        const path = `${BASE}/guild/${guildId}/${section}`;
        if (window.location.pathname !== path)
            history.replaceState(null, "", path);
    }
    nav.addEventListener("click", (event) => {
        const link = event.target.closest("a[data-section]");
        // Mit Strg, Shift oder Mittelklick will jemand einen neuen Tab - dann
        // gehört die Adresse dem Browser.
        if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
            return;
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
const FAILED = {
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
function bindModules(guild, only) {
    const nav = need("#setNav");
    const cards = need("#moduleCards");
    const list = need("#moduleList");
    const note = need("#moduleNote");
    // Bis der Stand aus der Datenbank da ist, zeigt die Leiste den aus /api/me,
    // und die Schalter bleiben gesperrt - vorher ist nicht klar, ob es überhaupt
    // eine Datenbank gibt.
    let saved = new Set(guild.modules);
    let shown = new Set(saved);
    let ready = false;
    function link(entry, sub) {
        const anchor = document.createElement("a");
        anchor.href = `${BASE}/guild/${guild.id}/${entry.id}`;
        anchor.dataset.section = entry.id;
        anchor.hidden = true;
        if (sub)
            anchor.className = "is-sub";
        anchor.append(icon(entry.icon), entry.name);
        nav.append(anchor);
        return anchor;
    }
    function card(entry) {
        // Steht die Sektion schon im HTML, gehoert sie einem gebauten Modul und
        // fuellt sich selbst. Nur was es noch nicht gibt, bekommt die Platzkarte.
        if (document.getElementById(entry.id))
            return;
        const box = clone("#moduleCard");
        box.id = entry.id;
        box.querySelector(".modhead").append(icon(entry.icon), entry.name);
        box.querySelector(".modlead").textContent = entry.description;
        cards.append(box);
    }
    // Je Modul: seine Eintraege in der Leiste (das Modul selbst und seine Teile),
    // seine Kachel, sein Schalter und ob es fest dazugehoert.
    const entries = new Map();
    // Die Leiste steht nach Kategorien: erst die Ueberschrift, dann ihre Module.
    // Die Kacheln unter "Module" bleiben flach - dort gibt es keine Kategorien.
    const groups = [];
    const bars = new Map();
    for (const category of CATEGORIES) {
        const members = MODULES.filter((entry) => entry.category === category.id);
        if (members.length === 0)
            continue;
        const cap = document.createElement("p");
        cap.className = "setnav__cap";
        cap.textContent = category.name;
        cap.hidden = true;
        nav.append(cap);
        for (const module of members) {
            const own = [link(module, false)];
            for (const part of module.parts ?? [])
                own.push(link(part, true));
            bars.set(module.id, own);
        }
        groups.push({ cap, ids: members.map((entry) => entry.id) });
    }
    for (const module of MODULES) {
        card(module);
        const tile = clone("#moduleTile");
        tile.querySelector(".acct__mark").append(icon(module.icon));
        tile.querySelector("b").textContent = module.name;
        tile.querySelector(".acct__text span").textContent = module.description;
        if (module.parts) {
            // Was mit angeht, steht auf der Kachel - sonst tauchen zwei Einträge
            // in der Leiste auf, die niemand eingeschaltet hat.
            const parts = document.createElement("span");
            parts.className = "modparts";
            parts.textContent = `Mit dabei: ${module.parts.map((part) => part.name).join(" · ")}`;
            tile.querySelector(".acct__text").append(parts);
            for (const part of module.parts)
                card(part);
        }
        if (module.always) {
            const fixed = document.createElement("span");
            fixed.className = "modalways";
            fixed.textContent = "Immer an – dieses Modul gehört fest dazu.";
            tile.querySelector(".acct__text").append(fixed);
        }
        list.append(tile);
        const input = tile.querySelector("input");
        if (!module.always)
            input.addEventListener("change", () => toggle(module.id, input.checked));
        entries.set(module.id, {
            links: bars.get(module.id) ?? [],
            tile,
            input,
            always: Boolean(module.always),
        });
    }
    // Supporter sehen weder Übersicht noch Module - nur, was in only steht.
    if (only) {
        for (const fixed of nav.querySelectorAll('a[data-section="uebersicht"], a[data-section="module"]'))
            fixed.hidden = true;
    }
    function paint() {
        for (const [id, entry] of entries) {
            const on = shown.has(id) || entry.always;
            for (const anchor of entry.links)
                anchor.hidden = !on || (only !== null && !only.has(anchor.dataset.section ?? ""));
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
    function warn(text) {
        note.hidden = text === null;
        note.querySelector("span").textContent = text ?? "";
    }
    // Die Schalter antworten sofort, die Anfragen laufen nacheinander: der Bot
    // liest und schreibt jedes Mal die ganze Liste, zwei zugleich könnten sich
    // gegenseitig überschreiben. Ist die Schlange leer, gilt der Stand des Bots -
    // ein abgelehnter Schalter springt damit von selbst zurück.
    let queue = Promise.resolve();
    let waiting = 0;
    let failure = null;
    function toggle(id, on) {
        if (on)
            shown.add(id);
        else
            shown.delete(id);
        paint();
        clickSound("primary");
        waiting++;
        queue = queue.then(async () => {
            failure = (await save(id, on)) ?? failure;
            if (--waiting > 0)
                return;
            shown = new Set(saved);
            warn(failure === null ? null : `Nicht gespeichert: ${failure}`);
            failure = null;
            paint();
        });
    }
    // Gibt den Grund zurück, wenn der Bot den Schalter nicht übernommen hat.
    async function save(id, on) {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guild.id)}/modules`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ module: id, on }),
            });
            const data = (await response.json().catch(() => ({})));
            if (response.ok && Array.isArray(data.modules)) {
                saved = new Set(data.modules);
                return null;
            }
            return FAILED[response.status] ?? `Der Bot hat abgelehnt (${response.status}).`;
        }
        catch {
            return "Der Bot antwortet gerade nicht.";
        }
    }
    paint();
    return (modules) => {
        if (modules === null) {
            warn("Module lassen sich gerade nicht schalten, der Bot erreicht seine Datenbank nicht.");
        }
        else {
            saved = new Set(modules);
            shown = new Set(modules);
            ready = true;
        }
        paint();
    };
}
