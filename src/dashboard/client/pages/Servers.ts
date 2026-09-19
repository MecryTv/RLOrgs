/** Seite: Serverauswahl. */

import { IGuild } from "../interfaces/IGuild.js";
import { IPayload } from "../interfaces/IUser.js";
import { clone, ghost, link, need } from "../core/Dom.js";
import { countMembers, paintCrest } from "../layout/GuildCard.js";
import { monthOf, numbers } from "../core/Format.js";
import { GROUPS, ROLE_ICONS, ROLE_LABELS, STAFF_GROUPS } from "../constants/Groups.js";
import { KNOWN_MODULES } from "../constants/Modules.js";
import { motionOff } from "../core/Prefs.js";
import { clickSound, hoverSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { BASE, url } from "../core/Base.js";

/* ----------------------------------------------------------
   Seite: Serverauswahl
   ---------------------------------------------------------- */
export const state = { filter: "all", query: "", firstPaint: true };

export function skeletons(count: number): void {
    const grid = need<HTMLElement>("#grid");
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < count; index++) fragment.appendChild(clone("#tpl-skel"));

    grid.replaceChildren(fragment);
}

export function highlight(target: HTMLElement, name: string, query: string): void {
    const index = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;

    if (index < 0) {
        target.textContent = name;
        return;
    }

    const mark = document.createElement("mark");
    mark.textContent = name.slice(index, index + query.length);

    target.replaceChildren(name.slice(0, index), mark, name.slice(index + query.length));
}

export function cardFor(guild: IGuild, position: number, animate: boolean): HTMLElement {
    const card = clone("#tpl-card");

    card.dataset.state = guild.active ? "active" : "idle";
    card.dataset.id = guild.id;
    card.style.setProperty("--accent", guild.active ? "var(--brand)" : "var(--blue)");
    card.style.setProperty("--tint", guild.active ? "color-mix(in srgb,var(--brand) 14%,transparent)" : "color-mix(in srgb,var(--blue) 12%,transparent)");

    if (animate) {
        card.classList.add("enter");
        card.style.setProperty("--d", `${position * 45}ms`);
    }

    paintCrest(card.querySelector<HTMLElement>("[data-crest]")!, guild);
    highlight(card.querySelector<HTMLElement>("[data-name]")!, guild.name, state.query);

    card.querySelector<SVGUseElement>("[data-role-icon]")!.setAttribute("href", ROLE_ICONS[guild.role]);
    card.querySelector<HTMLElement>("[data-role]")!.textContent = ROLE_LABELS[guild.role];

    // Ein Server, den man nur über die eigene RL Nexus-Gruppe sieht, bekommt eine
    // eigene Farbe - sonst ist er von den eigenen Servern nicht zu unterscheiden.
    if (guild.role === "Staff") {
        card.dataset.staff = "true";
        card.style.setProperty("--accent", "var(--purple)");
        card.style.setProperty("--tint", "color-mix(in srgb,var(--purple) 14%,transparent)");

        const pill = card.querySelector<HTMLElement>("[data-role]")!.closest(".pill");

        pill?.classList.replace("pill--role", "pill--staff");
    }

    countMembers(card, guild);

    if (!guild.canManage) card.querySelector<HTMLElement>("[data-view]")!.hidden = false;

    const status = card.querySelector<HTMLElement>("[data-status]")!;
    const facts = card.querySelector<HTMLElement>("[data-facts]")!;
    const hint = card.querySelector<HTMLElement>("[data-hint]")!;
    const foot = card.querySelector<HTMLElement>("[data-foot]")!;

    if (guild.active) {
        status.textContent = "RL Nexus läuft auf diesem Server";

        const teams = card.querySelector<HTMLElement>("[data-teams]")!;
        const modules = card.querySelector<HTMLElement>("[data-modules]")!;

        // Teams führt der Bot noch nicht. Module schon: eingeschaltet werden sie
        // auf der Serverseite, hier steht nur, wie viele es sind. Eine gespeicherte
        // ID, deren Modul es nicht mehr gibt, zählt dabei als aus.
        const on = guild.modules.filter((id) => KNOWN_MODULES.has(id)).length;

        teams.textContent = String(guild.teams);
        teams.classList.toggle("is-empty", guild.teams === 0);
        modules.textContent = String(on);
        modules.classList.toggle("is-empty", on === 0);

        card.querySelector<HTMLElement>("[data-created]")!.textContent = monthOf(guild.created);

        if (guild.role === "Staff") {
            hint.hidden = false;
            hint.textContent =
                "Du bist hier weder Owner noch Admin - sichtbar ist der Server über deine RL Nexus-Gruppe. Öffnen darfst du ihn, Änderungen brauchen „Server verwalten“ auf dem Server selbst.";
        }

        // Supporter landen direkt bei den Tickets - mehr steht für sie nicht offen.
        if (guild.role === "Support") {
            hint.hidden = false;
            hint.textContent = "Du bist hier im Support-Team: Live Tickets und Transcriptions stehen dir offen.";
        }

        foot.append(
            guild.role === "Support"
                ? link("btn btn--primary", "Live Tickets öffnen", `${BASE}/guild/${guild.id}/live-tickets`)
                : link("btn btn--primary", "Dashboard öffnen", `${BASE}/guild/${guild.id}/uebersicht`),
            ghost("#i-sliders", `Kurzinfo zu ${guild.name}`)
        );
    } else {
        status.textContent = "RL Nexus ist hier noch nicht hinzugefügt";
        facts.remove();

        hint.hidden = false;
        hint.textContent =
            "Lade den Bot ein, damit er hier Rang-Rollen vergeben, Ergebnisse posten und Queues fahren kann.";

        foot.append(
            guild.canManage
                ? link("btn btn--warm", "Bot einladen", inviteFor(guild.id), true)
                : link("btn btn--quiet", "Keine Berechtigung", url("/")),
            ghost("#i-info", "Was RL Nexus auf einem Server macht")
        );
    }

    return card;
}

export let inviteBase = "";

export function inviteFor(guildId: string): string {
    if (!inviteBase) return url("/");

    return `${inviteBase}&guild_id=${encodeURIComponent(guildId)}&disable_guild_select=true`;
}

export function matches(guild: IGuild): boolean {
    const byTab =
        state.filter === "all" ||
        (state.filter === "active" && guild.active) ||
        (state.filter === "idle" && !guild.active) ||
        (state.filter === "staff" && guild.role === "Staff");

    if (!byTab) return false;
    if (!state.query) return true;

    return guild.name.toLowerCase().includes(state.query.toLowerCase());
}

export function renderServers(data: IPayload): void {
    const grid = need<HTMLElement>("#grid");
    const empty = need<HTMLElement>("#empty");
    const resultline = need<HTMLElement>("#resultline");
    const search = need<HTMLElement>("#search");
    const input = need<HTMLInputElement>("#q");
    const tabs = need<HTMLElement>("#tabs");
    const glide = need<HTMLElement>("#glide");
    const reset = need<HTMLButtonElement>("#emptyReset");

    inviteBase = data.inviteURL;

    const active = data.guilds.filter((guild) => guild.active);
    const teams = active.reduce((sum, guild) => sum + guild.teams, 0);

    // Administrator und Developer sehen jeden Server, auf dem der Bot sitzt.
    // Bisher standen die einfach mit in der Liste - jetzt sagt die Seite es auch.
    const staff = data.guilds.filter((guild) => guild.role === "Staff");

    // Der Reiter steht für Admin und Developer immer da - auch bei null Servern,
    // sonst ist nicht zu sehen, dass es die Ansicht überhaupt gibt.
    if (STAFF_GROUPS.includes(data.user.group)) {
        need<HTMLElement>("#tab-staff").hidden = false;
        need<HTMLElement>("#count-staff").textContent = String(staff.length);
    }

    if (staff.length > 0 && STAFF_GROUPS.includes(data.user.group)) {
        const banner = need<HTMLElement>("#staffBanner");

        banner.hidden = false;
        need<HTMLElement>("#staffText").textContent =
            `Als ${(GROUPS[data.user.group] ?? GROUPS.testphase).label} siehst du zusätzlich ` +
            (staff.length === 1
                ? "einen Server, auf dem RL Nexus läuft, der dir aber nicht gehört."
                : `${staff.length} Server, auf denen RL Nexus läuft, die dir aber nicht gehören.`) +
            " Sie stehen unten im Abschnitt „Fremde Server“. Öffnen kannst du sie, ändern nur mit eigener Berechtigung auf dem Server.";

        need<HTMLButtonElement>("#staffShow").addEventListener("click", () => {
            const target = tabs.querySelector<HTMLElement>('.tab[data-filter="staff"]');

            target?.click();
            target?.scrollIntoView({ block: "nearest", behavior: motionOff() ? "auto" : "smooth" });
        });
    }

    need<HTMLElement>("#count-all").textContent = String(data.guilds.length);
    need<HTMLElement>("#count-active").textContent = String(active.length);
    need<HTMLElement>("#count-idle").textContent = String(data.guilds.length - active.length);

    countUp(need<HTMLElement>("#statTotal"), data.guilds.length);
    countUp(need<HTMLElement>("#statActive"), active.length);
    countUp(need<HTMLElement>("#statTeams"), teams);

    function moveGlide(): void {
        const current = tabs.querySelector<HTMLElement>('.tab[aria-pressed="true"]');

        if (!current) return;

        // offsetLeft ist bereits an .tabs gemessen und enthält dessen Polsterung.
        // Die 4px, die hier früher abgezogen wurden, haben die Markierung genau
        // um die Polsterung nach links verschoben.
        glide.style.width = `${current.offsetWidth}px`;
        glide.style.transform = `translateX(${current.offsetLeft}px)`;
        glide.style.setProperty("--tab", current.style.getPropertyValue("--tab") || "var(--brand)");
    }

    function render(): void {
        const list = data.guilds.filter(matches);
        const animate = state.firstPaint;

        state.firstPaint = false;

        const fragment = document.createDocumentFragment();

        // Eigene Server zuerst, fremde in einem eigenen Abschnitt darunter.
        // Überschriften nur, wenn wirklich beides in der Ansicht steht.
        const own = list.filter((guild) => guild.role !== "Staff");
        const foreign = list.filter((guild) => guild.role === "Staff");
        const split = own.length > 0 && foreign.length > 0;

        let position = 0;

        function place(guild: IGuild): void {
            fragment.appendChild(cardFor(guild, position++, animate));
        }

        if (split) {
            fragment.appendChild(heading("Deine Server", own.length));
            own.forEach(place);

            fragment.appendChild(heading("Fremde Server", foreign.length));
            foreign.forEach(place);
        } else {
            list.forEach(place);
        }

        grid.replaceChildren(fragment);

        const nothing = list.length === 0;


        grid.hidden = nothing;
        empty.classList.toggle("is-on", nothing);

        if (nothing) {
            const searching = state.query.length > 0;

            need<HTMLElement>("#emptyTitle").textContent = searching
                ? "Kein Server passt zu diesem Namen"
                : state.filter === "staff"
                  ? "Kein Server über deine Gruppe"
                  : "Kein Server in dieser Ansicht";
            need<HTMLElement>("#emptyText").textContent = searching
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

    function clearQuery(): void {
        input.value = "";
        state.query = "";
        search.classList.remove("has-value");
    }

    tabs.addEventListener("click", (event) => {
        const tab = (event.target as Element).closest<HTMLElement>(".tab");

        if (!tab) return;

        for (const other of tabs.querySelectorAll<HTMLElement>(".tab")) {
            other.setAttribute("aria-pressed", String(other === tab));
        }

        state.filter = tab.dataset.filter ?? "all";
        moveGlide();
        clickSound("primary");
        render();
    });

    tabs.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

        const all = [...tabs.querySelectorAll<HTMLElement>(".tab")];
        const index = all.indexOf(document.activeElement as HTMLElement);

        if (index < 0) return;

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

    need<HTMLButtonElement>("#clearSearch").addEventListener("click", () => {
        clearQuery();
        input.focus();
        render();
    });

    reset.addEventListener("click", () => {
        if (state.query) {
            clearQuery();
        } else {
            state.filter = "all";

            for (const tab of tabs.querySelectorAll<HTMLElement>(".tab")) {
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
    if (document.fonts) void document.fonts.ready.then(moveGlide);

    moveGlide();
    render();
}

// Nimmt im Raster eine ganze Zeile ein - deshalb eine Überschrift und keine
// zweite Rasterspalte.
export function heading(title: string, count: number): HTMLElement {
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

export function bindCardEffects(grid: HTMLElement, data: IPayload): void {
    let pending = false;
    let target: HTMLElement | null = null;
    let x = 0;
    let y = 0;

    grid.addEventListener("mousemove", (event) => {
        const card = (event.target as Element).closest<HTMLElement>(".card");

        if (!card) return;

        const box = card.getBoundingClientRect();

        target = card;
        x = event.clientX - box.left;
        y = event.clientY - box.top;

        if (pending) return;

        pending = true;

        requestAnimationFrame(() => {
            pending = false;

            if (!target) return;

            target.style.setProperty("--mx", `${x}px`);
            target.style.setProperty("--my", `${y}px`);
        });
    });

    let hovered: HTMLElement | null = null;

    grid.addEventListener("mouseover", (event) => {
        const card = (event.target as Element).closest<HTMLElement>(".card");

        if (card && card !== hovered) {
            hovered = card;
            hoverSound();
        }

        if (!card) hovered = null;
    });

    grid.addEventListener("click", (event) => {
        const trigger = (event.target as Element).closest<HTMLElement>(".btn");

        if (!trigger) return;

        ripple(trigger, event as MouseEvent);

        const card = trigger.closest<HTMLElement>(".card");
        const guild = card ? data.guilds.find((entry) => entry.id === card.dataset.id) : undefined;

        if (trigger.classList.contains("btn--warm")) {
            clickSound("warm");
            toast("invite", "Discord fragt gleich nach", "Bestätige dort, auf welchem Server RL Nexus landen soll.");
            return;
        }

        clickSound("primary");

        if (!guild) return;

        if (trigger.classList.contains("btn--ghost")) {
            toast(
                "info",
                guild.active ? "Kurzinfo" : "Was RL Nexus macht",
                guild.active
                    ? `${guild.name}: ${numbers.format(guild.members)} Mitglieder, erstellt ${monthOf(guild.created)}.`
                    : "Rang-Rollen, Match-Ergebnisse, Queues und ein Season-Leaderboard."
            );
        }
    });
}

export function ripple(element: HTMLElement, event: MouseEvent): void {
    if (motionOff()) return;

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

export function countUp(element: HTMLElement, target: number): void {
    if (motionOff()) {
        element.textContent = numbers.format(target);
        return;
    }

    const start = performance.now();

    function step(now: number): void {
        const progress = Math.min((now - start) / 900, 1);

        element.textContent = numbers.format(Math.round(target * (1 - Math.pow(1 - progress, 3))));

        if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
}
