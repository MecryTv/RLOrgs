/**
 * Abschnitt: Rangliste - der Teil des Level Systems, der die Zahlen zeigt.
 *
 * Steht in der Leiste unter dem Level System, so wie Live Tickets unter dem
 * Ticket System. Hier stehen die Plätze, der Schalter für die öffentliche
 * Liste und die Punkte, die von Hand vergeben werden.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { toast } from "../core/Toast.js";
import { api, button, card, confirmButton, el, face, IPerson, personPicker, row, select, stat, toggle } from "../core/Ui.js";

interface IRank {
    id: string;
    name: string;
    avatar: string | null;
    gone: boolean;
    rank: number;
    level: number;
    xp: number;
    into: number;
    need: number;
    messages: number;
    voiceMinutes: number;
}

interface IPayload {
    settings: { public: boolean; [key: string]: unknown };
    page: number;
    total: number;
    top: IRank[];
}

const NUMBER = new Intl.NumberFormat("de-DE");

export function renderLeaderboard(guildId: string): void {
    const host = need<HTMLElement>("#boardBody");
    const note = need<HTMLElement>("#boardNote");
    const call = api(`${BASE}/api/guild/${encodeURIComponent(guildId)}/levels`, note);
    const link = `${window.location.origin}${BASE}/rangliste/${guildId}`;

    let data: IPayload | null = null;
    let chosen: IPerson | null = null;
    let page = 1;

    /* ------------------------------------------------------------
       Kopf und öffentliche Liste
       ------------------------------------------------------------ */
    function head(): HTMLElement {
        const best = data!.top[0];

        return el(
            "div",
            "tkhead snhead",
            stat("#i-chart-up", "Mit Punkten", NUMBER.format(data!.total)),
            stat("#i-crown", "Spitze", best ? `${best.name} · Level ${best.level}` : "noch niemand"),
            stat("#i-eye", "Öffentlich", data!.settings.public ? "an" : "aus", data!.settings.public ? "is-ok" : "")
        );
    }

    /** Der Schalter speichert sofort - hier gibt es sonst nichts zu speichern. */
    function publicCard(): HTMLElement {
        const copy = button("btn btn--quiet", icon("#i-copy"), "Link kopieren");
        const open = el("a", "btn btn--quiet", icon("#i-external"), "Ansehen");
        const box = toggle(data!.settings.public, "Öffentliche Rangliste", async (on) => {
            const answer = await call<{ settings: IPayload["settings"] }>("", { action: "save", settings: { ...data!.settings, public: on } });

            if (!answer) return;

            data!.settings = answer.settings;
            toast("info", on ? "Öffentlich" : "Nicht mehr öffentlich", on ? "Jeder mit dem Link sieht die Rangliste." : "Die Seite antwortet wieder mit 404.");
            paint();
        });

        (open as HTMLAnchorElement).href = link;
        (open as HTMLAnchorElement).target = "_blank";
        (open as HTMLAnchorElement).rel = "noopener";
        copy.addEventListener("click", async () => {
            await navigator.clipboard.writeText(link).catch(() => undefined);
            toast("info", "Kopiert", "Der Link steht in der Zwischenablage.");
        });

        return card(
            "Öffentliche Rangliste",
            "An heißt: jeder mit dem Link sieht die Liste – ohne Anmeldung, ohne Discord-Konto. Zu sehen sind Platz, Name, Bild, Level und Punkte, sonst nichts.",
            row("Öffentlich", "Gilt sofort", el("label", "snitem__switch", box, el("span", "", data!.settings.public ? "an" : "aus"))),
            ...(data!.settings.public ? [el("div", "lvlink", el("code", "lvlink__url", link), copy, open)] : [])
        );
    }

    /* ------------------------------------------------------------
       Die Plätze
       ------------------------------------------------------------ */
    function board(): HTMLElement {
        const rows = data!.top.map((entry) => {
            const share = entry.need > 0 ? Math.round((entry.into / entry.need) * 100) : 100;
            const fill = el("span", "plbar__fill", "");

            fill.style.width = `${share}%`;

            return el(
                "div",
                `plrow vcrow lvrow${entry.rank <= 3 ? " is-top" : ""}`,
                el("span", "lvplace", `#${entry.rank}`),
                face({ name: entry.name, avatar: entry.avatar }, "travatar"),
                el(
                    "div",
                    "plrow__main",
                    el("div", "plrow__top", el("b", "", entry.name), ...(entry.gone ? [el("span", "chip", "nicht mehr da")] : [])),
                    el(
                        "span",
                        "gwrow__facts",
                        `Level ${entry.level} · ${NUMBER.format(entry.xp)} Punkte · ${NUMBER.format(entry.messages)} Nachrichten · ${NUMBER.format(entry.voiceMinutes)} Min. Voice`
                    )
                ),
                el("div", "plbars", el("div", "plbar", el("span", "plbar__label", `${NUMBER.format(entry.into)} / ${NUMBER.format(entry.need)}`), el("span", "plbar__track", fill), el("span", "plbar__value", `L${entry.level + 1}`)))
            );
        });

        const prev = button("btn btn--quiet", icon("#i-up"), "Zurück");
        const next = button("btn btn--quiet", icon("#i-down"), "Weiter");

        prev.disabled = page <= 1;
        next.disabled = data!.top.length < 25;
        prev.addEventListener("click", () => load(page - 1));
        next.addEventListener("click", () => load(page + 1));

        return card(
            "Rangliste",
            `${NUMBER.format(data!.total)} Mitglieder haben Punkte. In Discord zeigt /level rangliste dieselbe Liste.`,
            ...(rows.length
                ? rows
                : [el("div", "tkempty tkempty--big", icon("#i-chart-up"), el("b", "", "Noch hat niemand Punkte."), el("span", "", "Sobald jemand schreibt oder im Sprachkanal sitzt, steht er hier."))]),
            ...(rows.length || page > 1 ? [el("div", "mcsave lvpager", prev, next)] : [])
        );
    }

    /* ------------------------------------------------------------
       Punkte von Hand
       ------------------------------------------------------------ */
    function manage(): HTMLElement {
        const amount = el("input", "text gwnum");
        const mode = select(
            [
                ["set", "setzen auf"],
                ["add", "dazugeben"],
            ],
            "set",
            () => undefined,
            "Was mit den Punkten passieren soll"
        );
        const go = button("btn btn--primary", icon("#i-check"), "Übernehmen");
        const pickHost = el("div", "snperson");
        const drawPick = (): void => {
            pickHost.replaceChildren(
                personPicker(call, chosen, (person) => {
                    chosen = person;
                    drawPick();
                })
            );
        };

        amount.type = "number";
        amount.min = "-1000000";
        amount.max = "1000000";
        amount.value = "0";
        amount.setAttribute("aria-label", "Punkte");

        drawPick();

        go.addEventListener("click", async () => {
            if (!chosen) {
                toast("info", "Niemand gewählt", "Such zuerst ein Mitglied.");

                return;
            }

            go.disabled = true;

            const answer = await call("", { action: "adjust", userId: chosen.id, mode: mode.value, amount: Number(amount.value) || 0 });

            go.disabled = false;

            if (!answer) return;

            toast("info", "Punkte geändert", `${chosen.name} steht jetzt anders da.`);
            load(page);
        });

        const wipe = confirmButton("btn btn--quiet", "#i-trash", "Punkte zurücksetzen", "Wirklich zurücksetzen?", async () => {
            if (!chosen) {
                toast("info", "Niemand gewählt", "Such zuerst ein Mitglied.");

                return;
            }

            const answer = await call("", { action: "adjust", userId: chosen.id, mode: "reset" });

            if (answer) {
                toast("info", "Zurückgesetzt", `${chosen.name} fängt wieder bei null an.`);
                load(page);
            }
        });

        const clear = confirmButton("btn btn--quiet btn--danger", "#i-eraser", "Ganze Rangliste löschen", "Wirklich alle löschen?", async () => {
            const answer = await call("", { action: "reset" });

            if (answer) {
                toast("info", "Rangliste gelöscht", "Alle fangen wieder bei null an.");
                load(1);
            }
        });

        return card(
            "Punkte von Hand",
            "Für Umzüge, Fehler und kleine Belohnungen. Belohnungsrollen zieht der Bot dabei nach.",
            row("Mitglied", "Nach Name oder ID suchen", pickHost),
            row("Punkte", "Setzen oder dazugeben – negative Zahlen ziehen ab", el("div", "lvrange", mode, amount, go)),
            el("div", "mcsave", clear, wipe)
        );
    }

    /* ------------------------------------------------------------
       Zeichnen und Laden
       ------------------------------------------------------------ */
    function paint(): void {
        if (!data) return;

        host.replaceChildren(head(), publicCard(), board(), manage());
    }

    function load(next: number): void {
        page = Math.max(1, next);

        void call<IPayload>(`?page=${page}`).then((answer) => {
            if (!answer) return;

            data = answer;
            paint();
        });
    }

    host.replaceChildren(el("div", "tkhead", ...Array.from({ length: 3 }, () => el("div", "sb snskel"))));
    load(1);
}
