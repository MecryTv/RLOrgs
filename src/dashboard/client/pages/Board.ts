/**
 * Die öffentliche Rangliste eines Servers - ohne Anmeldung.
 *
 * Die Server-ID steht in der Adresse (/rangliste/<id>). Geholt wird eine
 * einzige Liste; gibt der Bot 404, hat der Server sie nicht freigegeben.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { el, face, stat } from "../core/Ui.js";

interface IEntry {
    rank: number;
    name: string;
    avatar: string | null;
    level: number;
    xp: number;
    into: number;
    need: number;
    messages: number;
    voiceMinutes: number;
}

interface IBoard {
    guild: { name: string; icon: string | null; members: number };
    total: number;
    top: IEntry[];
}

const NUMBER = new Intl.NumberFormat("de-DE");

function minutes(value: number): string {
    if (value < 60) return `${value} Min.`;

    const hours = Math.floor(value / 60);

    return `${hours} Std.`;
}

function empty(title: string, text: string): HTMLElement {
    return el("div", "tkempty tkempty--big", icon("#i-warn"), el("b", "", title), el("span", "", text));
}

export async function renderBoard(): Promise<void> {
    const host = need<HTMLElement>("#board");
    const id = window.location.pathname.split("/").filter(Boolean).pop() ?? "";
    const response = await fetch(`${BASE}/api/public/levels/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } }).catch(() => null);

    if (!response?.ok) {
        host.replaceChildren(
            empty(
                "Diese Rangliste gibt es nicht",
                response?.status === 404
                    ? "Entweder ist das Level System auf diesem Server aus, oder die Rangliste steht nicht öffentlich."
                    : "Der Bot antwortet gerade nicht. Lade die Seite in einem Moment neu."
            )
        );

        return;
    }

    const board = (await response.json()) as IBoard;

    document.title = `RL Nexus · Rangliste von ${board.guild.name}`;

    const head = el(
        "header",
        "board__head",
        el("div", "board__face", ...(board.guild.icon ? [] : [icon("#i-chart-up")])),
        el("div", "board__title", el("h1", "", board.guild.name), el("p", "", "Punkte fürs Schreiben und für die Zeit im Sprachkanal"))
    );

    if (board.guild.icon) {
        const image = el("img", "board__icon");

        image.src = board.guild.icon;
        image.alt = "";
        head.querySelector(".board__face")!.append(image);
    }

    const rows = board.top.map((entry) => {
        const share = entry.need > 0 ? Math.min(100, Math.round((entry.into / entry.need) * 100)) : 100;
        const bar = el("span", "plbar__fill", "");

        bar.style.width = `${share}%`;

        return el(
            "div",
            `plrow vcrow board__row${entry.rank <= 3 ? " is-top" : ""}`,
            el("span", "lvplace", `#${entry.rank}`),
            face({ name: entry.name, avatar: entry.avatar }, "travatar"),
            el(
                "div",
                "plrow__main",
                el("div", "plrow__top", el("b", "", entry.name), el("span", "chip", `Level ${entry.level}`)),
                el("span", "gwrow__facts", `${NUMBER.format(entry.xp)} Punkte · ${NUMBER.format(entry.messages)} Nachrichten · ${minutes(entry.voiceMinutes)} im Voice`)
            ),
            el("div", "plbars board__bar", el("div", "plbar", el("span", "plbar__track", bar), el("span", "plbar__value", `${share}%`)))
        );
    });

    host.replaceChildren(
        head,
        el(
            "div",
            "tkhead board__stats",
            stat("#i-users", "Mit Punkten", NUMBER.format(board.total)),
            stat("#i-crown", "Spitze", board.top[0] ? `${board.top[0].name} · Level ${board.top[0].level}` : "noch niemand"),
            stat("#i-chart-up", "Mitglieder", NUMBER.format(board.guild.members))
        ),
        el("div", "pllist board__list", ...(rows.length ? rows : [empty("Noch keine Punkte", "Sobald jemand schreibt oder im Sprachkanal sitzt, steht er hier.")])),
        el("p", "hintline board__foot", "Die Liste zeigt die ersten 100 Plätze und aktualisiert sich beim Neuladen.")
    );
}
