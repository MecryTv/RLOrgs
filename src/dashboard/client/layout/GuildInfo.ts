/**
 * Die Kurzinfo zu einem Server auf der Startseite: ein natives Popover am Knopf
 * der Karte (popover="auto" - Klick daneben und Escape schließen es). Was darin
 * steht, kennt die Seite schon aus /api/me; nachgeladen wird nichts.
 */
import { IGuild } from "../interfaces/IGuild.js";
import { icon } from "../core/Dom.js";
import { monthOf, numbers } from "../core/Format.js";
import { BASE } from "../core/Base.js";
import { MODULES } from "../constants/Modules.js";
import { ROLE_ICONS, ROLE_LABELS } from "../constants/Groups.js";
import { paintCrest } from "./GuildCard.js";

const DAY = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

// Was RL Nexus auf einem Server macht - für Server ohne Bot.
const FEATURES: [string, string][] = [
    ["#i-badge", "Rang-Rollen nach dem aktuellen Rocket-League-Rang"],
    ["#i-gamepad", "6Mans-Queues mit Match-Ergebnissen und Rangliste"],
    ["#i-ticket", "Ticket-System mit Live Tickets und Transcripts"],
    ["#i-image", "Galerie für Logos, Grafiken und Vorlagen"],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (className) element.className = className;

    element.append(...children);

    return element;
}

/** Die eingeschalteten Module, in der Reihenfolge der Modul-Übersicht. Feste zählen immer mit. */
export function activeModules(guild: IGuild): typeof MODULES {
    return MODULES.filter((module) => module.always || guild.modules.includes(module.id));
}

/** Ohne die Bots, wenn der Bot sie kennt - sonst die Gesamtzahl. */
export function humansOf(guild: IGuild): number {
    return guild.bots === null ? guild.members : Math.max(guild.members - guild.bots, 0);
}

let pop: HTMLDivElement | null = null;
let anchor: HTMLElement | null = null;
// Ein Klick auf den Knopf schließt das offene Popover schon beim Drücken (daneben
// geklickt) - der Klick danach darf es nicht gleich wieder öffnen.
let closedAt = 0;
let closedFor: HTMLElement | null = null;

function popover(): HTMLDivElement {
    if (pop) return pop;

    const panel = el("div", "ginfo");

    panel.popover = "auto";
    panel.tabIndex = -1;
    panel.setAttribute("role", "dialog");
    document.body.append(panel);

    const follow = (): void => {
        if (anchor && panel.matches(":popover-open")) place(panel, anchor);
    };

    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow);

    // "beforetoggle" kommt sofort, "toggle" erst später - zu spät für den Klick,
    // der das Popover gerade geschlossen hat.
    panel.addEventListener("beforetoggle", (event) => {
        if ((event as Event & { newState?: string }).newState !== "closed") return;

        closedAt = performance.now();
        closedFor = anchor;
    });

    // Escape schließt auch ohne den Weg des Browsers - der Fokus steht nach dem Öffnen im Popover.
    panel.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && panel.matches(":popover-open")) panel.hidePopover();
    });

    // Escape oder Klick daneben: der Fokus gehört zurück an den Knopf.
    panel.addEventListener("toggle", (event) => {
        const closed = (event as Event & { newState?: string }).newState === "closed";

        if (closed && (document.activeElement === document.body || panel.contains(document.activeElement))) anchor?.focus();
    });

    pop = panel;

    return panel;
}

/** Rechtsbündig am Knopf, darüber - bei zu wenig Platz darunter, nie aus dem Fenster. */
function place(panel: HTMLElement, trigger: HTMLElement): void {
    const box = trigger.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);

    panel.style.width = `${width}px`;

    const height = panel.offsetHeight;
    const above = box.top - 10 - height;
    const top = above >= 8 ? above : Math.min(box.bottom + 10, window.innerHeight - height - 8);

    panel.style.left = `${Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, top)}px`;
}

function head(guild: IGuild): HTMLElement {
    const crest = el("span", "crest ginfo__crest");

    crest.setAttribute("aria-hidden", "true");
    paintCrest(crest, guild);

    return el(
        "div",
        "ginfo__head",
        crest,
        el("div", "ginfo__title", el("b", "ginfo__name", guild.name), el("span", "ginfo__role", icon(ROLE_ICONS[guild.role]), ROLE_LABELS[guild.role]))
    );
}

function action(label: string, href: string, primary = false): HTMLAnchorElement {
    const link = el("a", `ginfo__link${primary ? " is-primary" : ""}`, label, icon("#i-arrow"));

    link.href = href;

    return link;
}

function content(guild: IGuild): HTMLElement[] {
    if (!guild.active) {
        return [
            head(guild),
            el("p", "ginfo__lead", "RL Nexus ist hier noch nicht dabei. Eingeladen bringt der Bot:"),
            el("ul", "ginfo__features", ...FEATURES.map(([symbol, text]) => el("li", "", icon(symbol), el("span", "", text)))),
        ];
    }

    const facts: [string, string][] = [
        ["Mitglieder", numbers.format(humansOf(guild))],
        ...(guild.bots === null ? [] : ([["Bots", numbers.format(guild.bots)]] as [string, string][])),
        ["Server erstellt", monthOf(guild.created)],
        ...(guild.joined ? ([["RL Nexus dabei seit", DAY.format(new Date(guild.joined))]] as [string, string][]) : []),
        ...(guild.teams ? ([["Teams", numbers.format(guild.teams)]] as [string, string][]) : []),
    ];
    const modules = activeModules(guild);
    const moderator = guild.role === "Moderator" && !guild.canManage;
    const base = `${BASE}/guild/${encodeURIComponent(guild.id)}`;

    return [
        head(guild),
        el("dl", "ginfo__facts", ...facts.flatMap(([term, value]) => [el("dt", "", term), el("dd", "", value)])),
        el(
            "div",
            "ginfo__mods",
            el("b", "ginfo__label", modules.length ? `${modules.length} ${modules.length === 1 ? "Modul" : "Module"} aktiv` : "Noch kein Modul aktiv"),
            ...(modules.length ? [el("ul", "ginfo__modlist", ...modules.map((module) => el("li", "", icon(module.icon), el("span", "", module.name))))] : [])
        ),
        el(
            "p",
            "ginfo__rights",
            guild.canManage
                ? "Du kannst hier alles einstellen."
                : moderator
                  ? "Als Moderator stehen dir Live Tickets und Transcriptions offen."
                  : "Sichtbar über deine RL Nexus-Gruppe – ändern nur mit eigener Berechtigung auf dem Server."
        ),
        el(
            "div",
            "ginfo__links",
            ...(moderator
                ? [action("Live Tickets", `${base}/live-tickets`, true), action("Transcriptions", `${base}/transcriptions`)]
                : [action("Übersicht", `${base}/uebersicht`, true), action("Module", `${base}/module`)])
        ),
    ];
}

/** Öffnet die Kurzinfo am Knopf - ein zweiter Klick auf denselben Knopf schließt sie. */
export function showGuildInfo(guild: IGuild, trigger: HTMLElement): void {
    const panel = popover();

    if (panel.matches(":popover-open") && anchor === trigger) {
        panel.hidePopover();

        return;
    }

    if (closedFor === trigger && performance.now() - closedAt < 400) return;

    anchor = trigger;
    panel.setAttribute("aria-label", `Kurzinfo zu ${guild.name}`);
    panel.replaceChildren(...content(guild));

    if (!panel.matches(":popover-open")) panel.showPopover();

    place(panel, trigger);
    panel.focus();
}
