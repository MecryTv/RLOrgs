/**
 * Kleine Bausteine der Modul-Seiten (Notifier, Umfragen, Giveaways): Elemente,
 * Abfragen mit Fehlerzeile, Rollen- und Ping-Auswahl, der Zwei-Klick-Knopf.
 * Dieselben Klassen wie im Ticket-System - die Seiten sehen aus wie eine.
 */

import { icon } from "./Dom.js";
import { failureText } from "./Gallery.js";

export interface IRole {
    id: string;
    name: string;
    color: string;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (className) element.className = className;

    element.append(...children);

    return element;
}

export function button(className: string, ...children: (Node | string)[]): HTMLButtonElement {
    const element = el("button", className, ...children);

    element.type = "button";

    return element;
}

export function face(person: { name: string; avatar: string | null }, className = "travatar"): HTMLElement {
    const box = el("span", className);

    if (person.avatar?.startsWith("https://")) box.style.backgroundImage = `url("${person.avatar.replace(/["\\]/g, "")}")`;
    else box.textContent = person.name.trim().slice(0, 1).toUpperCase() || "?";

    return box;
}

export function card(title: string, lead: string, ...children: HTMLElement[]): HTMLElement {
    return el("section", "tkcard", el("h3", "tkcard__title", title), ...(lead ? [el("p", "tkcard__lead", lead)] : []), ...children);
}

/** Eine Zeile mit Beschriftung links und dem Feld rechts. */
export function row(label: string, hint: string, control: HTMLElement): HTMLElement {
    if (!control.hasAttribute("aria-label") && control.matches("input, select")) control.setAttribute("aria-label", label);

    return el("div", "row", el("div", "row__text", el("b", "", label), ...(hint ? [el("i", "", hint)] : [])), control);
}

export function toggle(checked: boolean, label: string, onChange: (on: boolean) => void): HTMLInputElement {
    const box = el("input", "switch");

    box.type = "checkbox";
    box.checked = checked;
    box.setAttribute("aria-label", label);
    box.addEventListener("change", () => onChange(box.checked));

    return box;
}

export function select(entries: [string, string][], active: string, onPick: (value: string) => void, label: string): HTMLSelectElement {
    const picker = el("select", "pick");

    picker.append(...entries.map(([value, text]) => new Option(text, value)));
    picker.value = active;
    picker.setAttribute("aria-label", label);
    picker.addEventListener("change", () => onPick(picker.value));

    return picker;
}

/** Wer beim Senden gepingt wird: niemand, @everyone, @here oder eine Rolle. */
export function pingSelect(roles: IRole[], active: string | null, onPick: (value: string | null) => void): HTMLSelectElement {
    return select(
        [["", "Niemand anpingen"], ["everyone", "@everyone"], ["here", "@here"], ...roles.map((role): [string, string] => [role.id, `@${role.name}`])],
        active ?? "",
        (value) => onPick(value || null),
        "Wer angepingt wird"
    );
}

/** Mehrere Rollen: Chips zum Entfernen und ein Feld zum Hinzufügen. */
export function rolePicker(roles: IRole[], active: string[], onChange: (ids: string[]) => void, extra: [string, string][] = [], max = 10): HTMLElement {
    const host = el("div", "tkchips");
    let current = [...active];
    const nameOf = (id: string): string => extra.find(([value]) => value === id)?.[1] ?? `@${roles.find((role) => role.id === id)?.name ?? "gelöschte Rolle"}`;

    function paint(): void {
        const picker = select(
            [
                ["", current.length >= max ? `Höchstens ${max}` : "+ Rolle hinzufügen"],
                ...extra.filter(([value]) => !current.includes(value)),
                ...roles.filter((role) => !current.includes(role.id)).map((role): [string, string] => [role.id, `@${role.name}`]),
            ],
            "",
            (value) => {
                if (!value) return;

                current = [...current, value];
                onChange(current);
                paint();
            },
            "Rolle hinzufügen"
        );

        picker.disabled = current.length >= max;

        host.replaceChildren(
            ...current.map((id) => {
                const remove = button("", icon("#i-x"));
                const dot = el("span", "tkmod__dot");
                const color = roles.find((role) => role.id === id)?.color;

                dot.style.background = color && color !== "#000000" ? color : "var(--text-3)";
                remove.setAttribute("aria-label", `${nameOf(id)} entfernen`);
                remove.addEventListener("click", () => {
                    current = current.filter((entry) => entry !== id);
                    onChange(current);
                    paint();
                });

                return el("span", "tkchip", dot, el("span", "", nameOf(id)), remove);
            }),
            picker
        );
    }

    paint();

    return host;
}

/**
 * Ein Knopf, der einen zweiten Klick will - für alles, was sich nicht
 * zurücknehmen lässt. Nach vier Sekunden ist er wieder entschärft.
 */
export function confirmButton(className: string, symbol: string, label: string, sure: string, run: () => Promise<unknown>): HTMLButtonElement {
    const knob = button(className, icon(symbol), label);
    let armed: ReturnType<typeof setTimeout> | null = null;

    knob.addEventListener("click", async () => {
        if (!armed) {
            knob.classList.add("is-sure");
            knob.lastChild!.textContent = sure;
            armed = setTimeout(() => {
                armed = null;
                knob.classList.remove("is-sure");
                knob.lastChild!.textContent = label;
            }, 4000);

            return;
        }

        clearTimeout(armed);
        armed = null;
        knob.disabled = true;
        await run();
        knob.disabled = false;
        knob.classList.remove("is-sure");
        knob.lastChild!.textContent = label;
    });

    return knob;
}

/** Abfragen an eine Modul-Route. Fehler landen in der Hinweiszeile, zurück kommt dann null. */
export function api(base: string, note: HTMLElement): <T>(query: string, body?: Record<string, unknown>) => Promise<T | null> {
    const warn = (text: string | null): void => {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    };

    return async <T>(query: string, body?: Record<string, unknown>): Promise<T | null> => {
        try {
            const response = await fetch(`${base}${query}`, {
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
    };
}

export interface IPerson {
    id: string;
    name: string;
    avatar: string;
}

/**
 * Ein Mitglied suchen und auswählen. Gesucht wird über die Modul-Route des
 * Aufrufers (Aktion "members"), gezeigt wird, wer gewählt ist.
 */
export function personPicker(
    call: <T>(query: string, body?: Record<string, unknown>) => Promise<T | null>,
    chosen: IPerson | null,
    onPick: (person: IPerson | null) => void,
    placeholder = "Mitglied suchen: Name oder ID …"
): HTMLElement {
    if (chosen) {
        const change = button("btn btn--quiet mcchosen__change", "Ändern");

        change.addEventListener("click", () => onPick(null));

        return el("div", "mcchosen", face(chosen, "mcchosen__face"), el("div", "mcchosen__name", el("b", "", chosen.name), el("code", "mcid", chosen.id)), change);
    }

    const input = el("input", "text");
    const results = el("div", "mcpeople");
    let asked = 0;
    let timer = 0;

    input.type = "search";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder);
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

/** Eine Kennzahl oben auf der Seite - wie im Ticket-System. */
export function stat(symbol: string, label: string, value: string, tone = ""): HTMLElement {
    return el("div", `tkstat ${tone}`.trim(), el("span", "tkstat__mark", icon(symbol)), el("span", "tkstat__text", el("small", "", label), el("b", "", value)));
}

/** Dauer-Vorschläge für Auswahlfelder: Sekunden und Wort. */
export const DURATIONS: [number, string][] = [
    [600, "10 Minuten"],
    [1_800, "30 Minuten"],
    [3_600, "1 Stunde"],
    [21_600, "6 Stunden"],
    [43_200, "12 Stunden"],
    [86_400, "1 Tag"],
    [259_200, "3 Tage"],
    [604_800, "1 Woche"],
    [1_209_600, "2 Wochen"],
    [2_592_000, "30 Tage"],
];

/** Für datetime-local: die lokale Zeit ohne Zeitzone. */
export function localInput(ms: number): string {
    const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);

    return date.toISOString().slice(0, 16);
}

export const WHEN = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
