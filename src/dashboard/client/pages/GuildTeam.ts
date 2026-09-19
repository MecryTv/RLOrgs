/**
 * Abschnitt: die Moderatoren des Servers - einzelne User und Rollen. Sie gelten
 * für den ganzen Server: Tickets und Moderation. Jede Änderung speichert sofort;
 * mehrere Klicks laufen nacheinander, damit sich keine Liste überholt.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { failureText } from "../core/Gallery.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";

interface IPerson {
    id: string;
    name: string;
    avatar: string | null;
    /** Hat den Server verlassen - steht mit Hinweis da, bis ihn jemand entfernt. */
    gone?: boolean;
}

interface IRole {
    id: string;
    name: string;
    color: string;
}

interface IPayload {
    moderators: { users: IPerson[]; roles: string[] };
    roles: IRole[];
}

// Wie MAX_MODERATORS im Bot: je Liste.
const MAX = 25;

// Was Moderatoren dürfen - und was nicht. Dieselbe Grenze zieht der Bot.
const RIGHTS: [boolean, string][] = [
    [true, "Live Tickets und Transcriptions – alle Tickets, alle Aktionen"],
    [true, "Moderation – Verlauf, Fälle, Bannen, Kicken, Timeouts und Warns"],
    [true, "In Discord: die Ticket-Kanäle, das Aktions-Menü und die Moderations-Befehle"],
    [false, "Einstellungen und Module des Servers"],
    [false, "Transcripts löschen"],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (className) element.className = className;

    element.append(...children);

    return element;
}

function face(person: IPerson): HTMLElement {
    const box = el("span", "travatar");

    if (person.avatar?.startsWith("https://")) box.style.backgroundImage = `url("${person.avatar.replace(/["\\]/g, "")}")`;
    else box.textContent = person.name.trim().slice(0, 1).toUpperCase() || "?";

    return box;
}

export function renderTeam(guildId: string): void {
    const host = need<HTMLElement>("#teamBody");
    const note = need<HTMLElement>("#teamNote");
    const api = `${BASE}/api/guild/${encodeURIComponent(guildId)}/moderators`;

    let data: IPayload | null = null;
    let queue: Promise<void> = Promise.resolve();
    let timer = 0;
    let asked = 0;

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    async function call<T>(body?: Record<string, unknown>): Promise<T | null> {
        try {
            const response = await fetch(api, {
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

    /** Speichert die neue Liste. Scheitert es, steht wieder der letzte gespeicherte Stand da. */
    function save(users: string[], roles: string[], done: string): void {
        clickSound("primary");

        queue = queue.then(async () => {
            const answer = await call<IPayload>({ action: "save", moderators: { users, roles } });

            if (answer) {
                data = answer;
                toast("info", "Gespeichert", done);
            }

            paint();
        });
    }

    function chip(parts: Node[], name: string, remove: () => void): HTMLElement {
        const button = el("button", "", icon("#i-x"));

        button.type = "button";
        button.setAttribute("aria-label", `${name} entfernen`);
        button.addEventListener("click", remove);

        return el("span", "tkchip", ...parts, button);
    }

    function rights(): HTMLElement {
        return el(
            "section",
            "tkcard",
            el("h3", "tkcard__title", "Was Moderatoren dürfen"),
            el(
                "ul",
                "teamrights",
                ...RIGHTS.map(([allowed, text]) =>
                    el("li", allowed ? "is-yes" : "is-no", icon(allowed ? "#i-check" : "#i-x"), el("span", "", text))
                )
            )
        );
    }

    function roles(current: IPayload): HTMLElement {
        const { moderators } = current;
        const picker = el("select", "pick", el("option", "", "+ Rolle hinzufügen"));

        (picker.firstElementChild as HTMLOptionElement).value = "";

        for (const role of current.roles.filter((entry) => !moderators.roles.includes(entry.id))) {
            const option = el("option", "", `@${role.name}`);

            option.value = role.id;
            picker.append(option);
        }

        picker.disabled = moderators.roles.length >= MAX;
        picker.setAttribute("aria-label", "Moderatoren-Rolle hinzufügen");
        picker.addEventListener("change", () => {
            const role = current.roles.find((entry) => entry.id === picker.value);

            if (!role) return;

            save(
                moderators.users.map((person) => person.id),
                [...moderators.roles, role.id],
                `@${role.name} ist jetzt Moderatoren-Rolle.`
            );
        });

        const list = el(
            "div",
            "tkchips",
            ...moderators.roles.map((id) => {
                const role = current.roles.find((entry) => entry.id === id);
                const dot = el("span", "tkmod__dot");
                const name = `@${role?.name ?? "gelöschte Rolle"}`;

                dot.style.background = role && role.color !== "#000000" ? role.color : "var(--text-3)";

                return chip([dot, el("span", "", name)], name, () =>
                    save(
                        moderators.users.map((person) => person.id),
                        moderators.roles.filter((entry) => entry !== id),
                        `${name} ist keine Moderatoren-Rolle mehr.`
                    )
                );
            }),
            picker
        );

        return el(
            "section",
            "tkcard",
            el("h3", "tkcard__title", "Rollen"),
            el("p", "tkcard__lead", "Jeder mit einer dieser Rollen ist Moderator – auch wer die Rolle später bekommt."),
            list
        );
    }

    function users(current: IPayload): HTMLElement {
        const { moderators } = current;
        const results = el("div", "tkmod__results");
        const query = el("input", "text tkmod__search");

        query.type = "search";
        query.placeholder = "User suchen: Name oder User-ID …";
        query.disabled = moderators.users.length >= MAX;
        query.setAttribute("aria-label", "User als Moderator suchen");
        query.addEventListener("input", () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(async () => {
                const mine = ++asked;
                const text = query.value.trim();

                if (!text) {
                    results.replaceChildren();

                    return;
                }

                const answer = await call<{ members: IPerson[] }>({ action: "members", query: text });

                if (mine !== asked) return;

                const found = (answer?.members ?? []).filter((person) => !moderators.users.some((entry) => entry.id === person.id));

                results.replaceChildren(
                    ...(found.length
                        ? found.map((person) => {
                              const button = el("button", "ltperson", face(person), el("span", "", person.name));

                              button.type = "button";
                              button.addEventListener("click", () =>
                                  save(
                                      [...moderators.users.map((entry) => entry.id), person.id],
                                      moderators.roles,
                                      `${person.name} ist jetzt Moderator.`
                                  )
                              );

                              return button;
                          })
                        : [el("span", "tkempty", "Niemand gefunden – oder schon eingetragen.")])
                );
            }, 300);
        });

        const list = el(
            "div",
            "tkchips",
            ...(moderators.users.length
                ? moderators.users.map((person) => {
                      const parts: Node[] = [face(person), el("span", "", person.name)];

                      if (person.gone) parts.push(el("em", "tkmod__gone", "nicht mehr auf dem Server"));

                      return chip(parts, person.name, () =>
                          save(
                              moderators.users.filter((entry) => entry.id !== person.id).map((entry) => entry.id),
                              moderators.roles,
                              `${person.name} ist kein Moderator mehr.`
                          )
                      );
                  })
                : [el("span", "tkempty", "Noch niemand einzeln eingetragen.")])
        );

        return el(
            "section",
            "tkcard",
            el("h3", "tkcard__title", "Einzelne User"),
            el("p", "tkcard__lead", "Auch ohne passende Rolle – gilt, solange sie auf dem Server sind."),
            list,
            query,
            results
        );
    }

    function paint(): void {
        if (!data) return;

        host.replaceChildren(el("div", "teamgrid", rights(), roles(data), users(data)));
    }

    void call<IPayload>().then((answer) => {
        if (!answer) return;

        data = answer;
        paint();
    });
}
