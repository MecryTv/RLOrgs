/** Seite: Serverauswahl. */
import { clone, ghost, icon, link, need } from "../core/Dom.js";
import { paintCrest } from "../layout/GuildCard.js";
import { activeModules, humansOf, showGuildInfo } from "../layout/GuildInfo.js";
import { compact, numbers } from "../core/Format.js";
import { GROUPS, ROLE_ICONS, ROLE_LABELS, STAFF_GROUPS } from "../constants/Groups.js";
import { motionOff } from "../core/Prefs.js";
import { clickSound, hoverSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { BASE, url } from "../core/Base.js";
/* ----------------------------------------------------------
   Seite: Serverauswahl
   ---------------------------------------------------------- */
export const state = { filter: "all", query: "", firstPaint: true };
export function skeletons(count) {
    const grid = need("#grid");
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index++)
        fragment.appendChild(clone("#tpl-skel"));
    grid.replaceChildren(fragment);
}
export function highlight(target, name, query) {
    const index = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (index < 0) {
        target.textContent = name;
        return;
    }
    const mark = document.createElement("mark");
    mark.textContent = name.slice(index, index + query.length);
    target.replaceChildren(name.slice(0, index), mark, name.slice(index + query.length));
}
export function cardFor(guild, position, animate) {
    const card = clone("#tpl-card");
    card.dataset.state = guild.active ? "active" : "idle";
    card.dataset.id = guild.id;
    card.style.setProperty("--accent", guild.active ? "var(--brand)" : "var(--blue)");
    card.style.setProperty("--tint", guild.active ? "color-mix(in srgb,var(--brand) 14%,transparent)" : "color-mix(in srgb,var(--blue) 12%,transparent)");
    if (animate) {
        card.classList.add("enter");
        card.style.setProperty("--d", `${position * 45}ms`);
    }
    paintCrest(card.querySelector("[data-crest]"), guild);
    highlight(card.querySelector("[data-name]"), guild.name, state.query);
    card.querySelector("[data-role-icon]").setAttribute("href", ROLE_ICONS[guild.role]);
    card.querySelector("[data-role]").textContent = ROLE_LABELS[guild.role];
    // Ein Server, den man nur über die eigene RL Nexus-Gruppe sieht, bekommt eine
    // eigene Farbe - sonst ist er von den eigenen Servern nicht zu unterscheiden.
    const pill = card.querySelector("[data-role]").closest(".pill");
    if (guild.role === "Staff") {
        card.dataset.staff = "true";
        card.style.setProperty("--accent", "var(--purple)");
        card.style.setProperty("--tint", "color-mix(in srgb,var(--purple) 14%,transparent)");
        pill?.classList.replace("pill--role", "pill--staff");
    }
    // Moderator: gruen - der Server ist offen, nur nicht zum Einstellen.
    if (guild.role === "Moderator") {
        card.dataset.mod = "true";
        card.style.setProperty("--accent", "var(--live)");
        card.style.setProperty("--tint", "color-mix(in srgb,var(--live) 12%,transparent)");
        pill?.classList.replace("pill--role", "pill--mod");
    }
    if (!guild.canManage && guild.role !== "Moderator")
        card.querySelector("[data-view]").hidden = false;
    const status = card.querySelector("[data-status]");
    const hint = card.querySelector("[data-hint]");
    const foot = card.querySelector("[data-foot]");
    paintStats(card.querySelector("[data-stats]"), guild);
    if (guild.active) {
        // Seit wann, steht gleich im Status - ein Datum ist keine Zahl zum Vergleichen.
        status.textContent = guild.joined
            ? `RL Nexus läuft hier seit ${new Date(guild.joined).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}`
            : "RL Nexus läuft auf diesem Server";
        paintModules(card.querySelector("[data-mods]"), guild);
        if (guild.role === "Staff") {
            hint.hidden = false;
            hint.textContent =
                "Du bist hier weder Owner noch Admin - sichtbar ist der Server über deine RL Nexus-Gruppe. Öffnen darfst du ihn, Änderungen brauchen „Server verwalten“ auf dem Server selbst.";
        }
        // Moderatoren landen direkt bei den Tickets - mehr steht für sie nicht offen.
        if (guild.role === "Moderator") {
            hint.hidden = false;
            hint.textContent = "Du bist hier Moderator: Live Tickets und Transcriptions stehen dir offen.";
        }
        foot.append(guild.role === "Moderator"
            ? link("btn btn--primary", "Live Tickets öffnen", `${BASE}/guild/${guild.id}/live-tickets`)
            : link("btn btn--primary", "Dashboard öffnen", `${BASE}/guild/${guild.id}/uebersicht`), ghost("#i-info", `Kurzinfo zu ${guild.name}`));
    }
    else {
        status.textContent = "RL Nexus ist hier noch nicht hinzugefügt";
        hint.hidden = false;
        hint.textContent =
            "Lade den Bot ein, damit er hier Rang-Rollen vergeben, Ergebnisse posten und Queues fahren kann.";
        foot.append(guild.canManage
            ? link("btn btn--warm", "Bot einladen", inviteFor(guild.id), true)
            : link("btn btn--quiet", "Keine Berechtigung", url("/")), ghost("#i-info", "Was RL Nexus auf einem Server macht"));
    }
    return card;
}
/** Die Zahlen der Karte: Mitglieder und - wenn der Bot sie kennt - Bots. */
function paintStats(box, guild) {
    const stat = (value, label, title) => {
        const cell = document.createElement("div");
        const term = document.createElement("dt");
        const data = document.createElement("dd");
        cell.className = "cstat";
        cell.title = title;
        term.textContent = label;
        data.textContent = value;
        cell.append(term, data);
        return cell;
    };
    const humans = humansOf(guild);
    const cells = [stat(compact(humans), "Mitglieder", `${numbers.format(humans)} Mitglieder${guild.bots === null ? ", Bots inbegriffen" : ""}`)];
    if (guild.bots !== null)
        cells.push(stat(compact(guild.bots), guild.bots === 1 ? "Bot" : "Bots", `${numbers.format(guild.bots)} Bots auf diesem Server`));
    box.replaceChildren(...cells);
}
/** Die eingeschalteten Module als Symbole - höchstens sechs, der Rest als Zahl. */
function paintModules(box, guild) {
    const modules = activeModules(guild);
    const list = box.querySelector("[data-modlist]");
    const label = box.querySelector("[data-modlabel]");
    const shown = modules.length > 6 ? modules.slice(0, 5) : modules;
    box.hidden = false;
    box.classList.toggle("is-empty", modules.length === 0);
    label.textContent = modules.length ? "Module" : "Noch kein Modul aktiv";
    list.replaceChildren(...shown.map((module) => {
        const item = document.createElement("li");
        const name = document.createElement("span");
        item.title = module.name;
        name.className = "sr";
        name.textContent = module.name;
        item.append(icon(module.icon), name);
        return item;
    }));
    if (modules.length > shown.length) {
        const more = document.createElement("li");
        const rest = modules.slice(shown.length);
        more.className = "is-more";
        more.textContent = `+${rest.length}`;
        more.title = rest.map((module) => module.name).join(", ");
        list.append(more);
    }
}
export let inviteBase = "";
export function inviteFor(guildId) {
    if (!inviteBase)
        return url("/");
    return `${inviteBase}&guild_id=${encodeURIComponent(guildId)}&disable_guild_select=true`;
}
export function matches(guild) {
    const byTab = state.filter === "all" ||
        (state.filter === "active" && guild.active) ||
        (state.filter === "idle" && !guild.active) ||
        (state.filter === "mod" && guild.role === "Moderator") ||
        (state.filter === "staff" && guild.role === "Staff");
    if (!byTab)
        return false;
    if (!state.query)
        return true;
    return guild.name.toLowerCase().includes(state.query.toLowerCase());
}
export function renderServers(data) {
    const grid = need("#grid");
    const empty = need("#empty");
    const resultline = need("#resultline");
    const search = need("#search");
    const input = need("#q");
    const tabs = need("#tabs");
    const glide = need("#glide");
    const reset = need("#emptyReset");
    inviteBase = data.inviteURL;
    const active = data.guilds.filter((guild) => guild.active);
    const teams = active.reduce((sum, guild) => sum + guild.teams, 0);
    // Administrator und Developer sehen jeden Server, auf dem der Bot sitzt.
    // Bisher standen die einfach mit in der Liste - jetzt sagt die Seite es auch.
    const staff = data.guilds.filter((guild) => guild.role === "Staff");
    // Der Reiter steht für Admin und Developer immer da - auch bei null Servern,
    // sonst ist nicht zu sehen, dass es die Ansicht überhaupt gibt.
    if (STAFF_GROUPS.includes(data.user.group)) {
        need("#tab-staff").hidden = false;
        need("#count-staff").textContent = String(staff.length);
    }
    if (staff.length > 0 && STAFF_GROUPS.includes(data.user.group)) {
        const banner = need("#staffBanner");
        banner.hidden = false;
        need("#staffText").textContent =
            `Als ${(GROUPS[data.user.group] ?? GROUPS.testphase).label} siehst du zusätzlich ` +
                (staff.length === 1
                    ? "einen Server, auf dem RL Nexus läuft, der dir aber nicht gehört."
                    : `${staff.length} Server, auf denen RL Nexus läuft, die dir aber nicht gehören.`) +
                " Sie stehen unten im Abschnitt „Fremde Server“. Öffnen kannst du sie, ändern nur mit eigener Berechtigung auf dem Server.";
        need("#staffShow").addEventListener("click", () => {
            const target = tabs.querySelector('.tab[data-filter="staff"]');
            target?.click();
            target?.scrollIntoView({ block: "nearest", behavior: motionOff() ? "auto" : "smooth" });
        });
    }
    // Moderation: nur wer auf mindestens einem Server Moderator ist.
    const moderated = data.guilds.filter((guild) => guild.role === "Moderator");
    if (moderated.length > 0) {
        need("#tab-mod").hidden = false;
        need("#count-mod").textContent = String(moderated.length);
    }
    need("#count-all").textContent = String(data.guilds.length);
    need("#count-active").textContent = String(active.length);
    need("#count-idle").textContent = String(data.guilds.length - active.length);
    countUp(need("#statTotal"), data.guilds.length);
    countUp(need("#statActive"), active.length);
    countUp(need("#statTeams"), teams);
    function moveGlide() {
        const current = tabs.querySelector('.tab[aria-pressed="true"]');
        if (!current)
            return;
        // offsetLeft ist bereits an .tabs gemessen und enthält dessen Polsterung.
        // Die 4px, die hier früher abgezogen wurden, haben die Markierung genau
        // um die Polsterung nach links verschoben.
        glide.style.width = `${current.offsetWidth}px`;
        glide.style.transform = `translateX(${current.offsetLeft}px)`;
        glide.style.setProperty("--tab", current.style.getPropertyValue("--tab") || "var(--brand)");
    }
    function render() {
        const list = data.guilds.filter(matches);
        const animate = state.firstPaint;
        state.firstPaint = false;
        const fragment = document.createDocumentFragment();
        // Eigene Server zuerst, dann die als Moderator, fremde darunter.
        // Überschriften nur, wenn mehr als eine Gruppe in der Ansicht steht.
        const groups = [
            ["Deine Server", list.filter((guild) => guild.role === "Owner" || guild.role === "Admin")],
            ["Als Moderator", list.filter((guild) => guild.role === "Moderator")],
            ["Fremde Server", list.filter((guild) => guild.role === "Staff")],
        ];
        const filled = groups.filter(([, entries]) => entries.length > 0);
        let position = 0;
        function place(guild) {
            fragment.appendChild(cardFor(guild, position++, animate));
        }
        if (filled.length > 1) {
            for (const [title, entries] of filled) {
                fragment.appendChild(heading(title, entries.length));
                entries.forEach(place);
            }
        }
        else {
            list.forEach(place);
        }
        grid.replaceChildren(fragment);
        const nothing = list.length === 0;
        grid.hidden = nothing;
        empty.classList.toggle("is-on", nothing);
        if (nothing) {
            const searching = state.query.length > 0;
            need("#emptyTitle").textContent = searching
                ? "Kein Server passt zu diesem Namen"
                : state.filter === "staff"
                    ? "Kein Server über deine Gruppe"
                    : state.filter === "mod"
                        ? "Du bist nirgends Moderator"
                        : "Kein Server in dieser Ansicht";
            need("#emptyText").textContent = searching
                ? "Prüfe die Schreibweise oder leere die Suche, um alle Server zu sehen."
                : state.filter === "staff"
                    ? "Hier stehen Server, auf denen RL Nexus läuft und die dir nicht gehören. Gerade gibt es keinen."
                    : "Wechsle den Filter, um deine übrigen Server zu sehen.";
            reset.textContent = searching ? "Suche leeren" : "Alle Server zeigen";
        }
        resultline.textContent = state.query
            ? `${list.length} Server passen zu „${state.query}“`
            : `${list.length} von ${data.guilds.length} Servern`;
    }
    function clearQuery() {
        input.value = "";
        state.query = "";
        search.classList.remove("has-value");
    }
    tabs.addEventListener("click", (event) => {
        const tab = event.target.closest(".tab");
        if (!tab)
            return;
        for (const other of tabs.querySelectorAll(".tab")) {
            other.setAttribute("aria-pressed", String(other === tab));
        }
        state.filter = tab.dataset.filter ?? "all";
        moveGlide();
        clickSound("primary");
        render();
    });
    tabs.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
            return;
        const all = [...tabs.querySelectorAll(".tab")];
        const index = all.indexOf(document.activeElement);
        if (index < 0)
            return;
        event.preventDefault();
        const next = all[(index + (event.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
        next.focus();
        next.click();
    });
    input.addEventListener("input", () => {
        state.query = input.value.trim();
        search.classList.toggle("has-value", input.value.length > 0);
        render();
    });
    need("#clearSearch").addEventListener("click", () => {
        clearQuery();
        input.focus();
        render();
    });
    reset.addEventListener("click", () => {
        if (state.query) {
            clearQuery();
        }
        else {
            state.filter = "all";
            for (const tab of tabs.querySelectorAll(".tab")) {
                tab.setAttribute("aria-pressed", String(tab.dataset.filter === "all"));
            }
            moveGlide();
        }
        render();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "/" && document.activeElement !== input) {
            event.preventDefault();
            input.focus();
            input.select();
        }
        if (event.key === "Escape" && document.activeElement === input && input.value) {
            clearQuery();
            render();
        }
    });
    bindCardEffects(grid, data);
    window.addEventListener("resize", moveGlide);
    if (document.fonts)
        void document.fonts.ready.then(moveGlide);
    moveGlide();
    render();
}
// Nimmt im Raster eine ganze Zeile ein - deshalb eine Überschrift und keine
// zweite Rasterspalte.
export function heading(title, count) {
    const head = document.createElement("h2");
    const label = document.createElement("span");
    const badge = document.createElement("span");
    head.className = "gridhead";
    label.textContent = title;
    badge.className = "gridhead__count";
    badge.textContent = String(count);
    head.append(label, badge);
    return head;
}
export function bindCardEffects(grid, data) {
    let pending = false;
    let target = null;
    let x = 0;
    let y = 0;
    grid.addEventListener("mousemove", (event) => {
        const card = event.target.closest(".card");
        if (!card)
            return;
        const box = card.getBoundingClientRect();
        target = card;
        x = event.clientX - box.left;
        y = event.clientY - box.top;
        if (pending)
            return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            if (!target)
                return;
            target.style.setProperty("--mx", `${x}px`);
            target.style.setProperty("--my", `${y}px`);
        });
    });
    let hovered = null;
    grid.addEventListener("mouseover", (event) => {
        const card = event.target.closest(".card");
        if (card && card !== hovered) {
            hovered = card;
            hoverSound();
        }
        if (!card)
            hovered = null;
    });
    grid.addEventListener("click", (event) => {
        const trigger = event.target.closest(".btn");
        if (!trigger)
            return;
        ripple(trigger, event);
        const card = trigger.closest(".card");
        const guild = card ? data.guilds.find((entry) => entry.id === card.dataset.id) : undefined;
        if (trigger.classList.contains("btn--warm")) {
            clickSound("warm");
            toast("invite", "Discord fragt gleich nach", "Bestätige dort, auf welchem Server RL Nexus landen soll.");
            return;
        }
        clickSound("primary");
        if (!guild)
            return;
        if (trigger.classList.contains("btn--ghost"))
            showGuildInfo(guild, trigger);
    });
}
export function ripple(element, event) {
    if (motionOff())
        return;
    const box = element.getBoundingClientRect();
    const size = Math.max(box.width, box.height) * 2.2;
    const ink = document.createElement("span");
    ink.className = "ripple";
    ink.style.width = `${size}px`;
    ink.style.height = `${size}px`;
    ink.style.left = `${event.clientX - box.left}px`;
    ink.style.top = `${event.clientY - box.top}px`;
    element.appendChild(ink);
    window.setTimeout(() => ink.remove(), 560);
}
export function countUp(element, target) {
    if (motionOff()) {
        element.textContent = numbers.format(target);
        return;
    }
    const start = performance.now();
    function step(now) {
        const progress = Math.min((now - start) / 900, 1);
        element.textContent = numbers.format(Math.round(target * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1)
            requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}
