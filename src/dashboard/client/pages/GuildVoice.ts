/**
 * Abschnitt: Temp Voice.
 *
 * Oben die Zahlen, darunter die Hubs ("Hier klicken"-Kanäle) mit ihren
 * Vorgaben, das Panel (im Chat des eigenen Kanals oder in einem festen Kanal)
 * und die Kanäle, die gerade offen sind.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { ago } from "../core/Format.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { api, button, card, confirmButton, el, row, select, stat, toggle } from "../core/Ui.js";

interface ISettings {
    name: string | null;
    limit: number;
    privacy: "public" | "private";
    stealth: boolean;
    region: string | null;
    trusted: string[];
    blocked: string[];
}

interface IHubConfig {
    name: string;
    categoryId: string | null;
    defaults: ISettings;
    actions: string[];
    presets: boolean;
}

interface IHub {
    id: number;
    channelId: string;
    channelName: string | null;
    config: IHubConfig;
}

interface IOpen {
    channelId: string;
    name: string;
    owner: string;
    members: number;
    privacy: "public" | "private";
    createdAt: number;
}

interface IPayload {
    hubs: IHub[];
    max: number;
    maxPresets: number;
    settings: { panel: "voice" | "channel"; panelChannelId: string | null; panelMessageId: string | null };
    actions: { name: string; value: string; description: string; emoji: string }[];
    regions: [string, string][];
    open: IOpen[];
    guild: {
        name: string;
        channels: { id: string; name: string }[];
        voice: { id: string; name: string }[];
        categories: { id: string; name: string }[];
    };
}

export function renderVoice(guildId: string): void {
    const host = need<HTMLElement>("#voiceBody");
    const note = need<HTMLElement>("#voiceNote");
    const call = api(`${BASE}/api/guild/${encodeURIComponent(guildId)}/voice`, note);

    let data: IPayload | null = null;
    let open: number | null = null;
    const drafts = new Map<number, { config: IHubConfig; dirty: boolean }>();

    function draftOf(hub: IHub): { config: IHubConfig; dirty: boolean } {
        let draft = drafts.get(hub.id);

        if (!draft) {
            draft = { config: structuredClone(hub.config), dirty: false };
            drafts.set(hub.id, draft);
        }

        return draft;
    }

    /* ------------------------------------------------------------
       Kopf und Hinzufügen
       ------------------------------------------------------------ */
    function head(): HTMLElement {
        const panel = data!.settings;
        const channel = panel.panelChannelId ? data!.guild.channels.find((entry) => entry.id === panel.panelChannelId) : null;

        return el(
            "div",
            "tkhead snhead",
            stat("#i-mic", "Hubs", `${data!.hubs.length} / ${data!.max}`),
            stat("#i-users", "Offene Kanäle", String(data!.open.length), data!.open.length ? "is-live" : ""),
            stat("#i-layout", "Panel", panel.panel === "voice" ? "im Sprachkanal" : channel ? `#${channel.name}` : "kein Kanal", panel.panel === "voice" || channel ? "is-ok" : "is-warn"),
            stat("#i-star", "Presets", data!.hubs.some((hub) => hub.config.presets) ? `bis ${data!.maxPresets} je User` : "aus")
        );
    }

    function addBar(): HTMLElement {
        const used = new Set(data!.hubs.map((hub) => hub.channelId));
        const free = data!.guild.voice.filter((entry) => !used.has(entry.id));
        const pick = select(
            [["", free.length ? "— Sprachkanal wählen —" : "Alle Sprachkanäle sind schon Hubs"], ...free.map((entry): [string, string] => [entry.id, `🔊 ${entry.name}`])],
            "",
            () => undefined,
            "Sprachkanal für den Hub"
        );
        const go = button("btn btn--primary snadd__go", icon("#i-plus"), "Hub anlegen");
        const full = data!.hubs.length >= data!.max;

        pick.className = "pick snadd__input";
        go.disabled = full;
        go.addEventListener("click", async () => {
            if (!pick.value) {
                toast("info", "Kein Kanal gewählt", "Wähle den Sprachkanal, den alle zum Anlegen betreten.");

                return;
            }

            go.disabled = true;
            clickSound("primary");

            const answer = await call<{ hub: IHub }>("", { action: "add", channelId: pick.value });

            go.disabled = false;

            if (!answer) return;

            data!.hubs.push(answer.hub);
            open = answer.hub.id;
            toast("info", "Hub angelegt", `Wer „${answer.hub.channelName}" betritt, bekommt jetzt seinen eigenen Kanal.`);
            paint();
        });

        return card(
            "Hub hinzufügen",
            full
                ? `Mehr als ${data!.max} Hubs gehen nicht. Entferne erst einen.`
                : "Ein Sprachkanal zum Anklicken: Wer ihn betritt, bekommt einen eigenen Kanal und wird hineingezogen. Der Hub selbst bleibt leer.",
            el("div", "snadd__row", icon("#i-mic"), pick, go)
        );
    }

    /* ------------------------------------------------------------
       Ein Hub
       ------------------------------------------------------------ */
    function item(hub: IHub): HTMLElement {
        const draft = draftOf(hub);
        const isOpen = open === hub.id;
        const edit = button("btn btn--quiet snitem__edit", icon(isOpen ? "#i-up" : "#i-sliders"), isOpen ? "Zuklappen" : "Bearbeiten");
        const remove = confirmButton("btn btn--quiet btn--icon", "#i-trash", "Hub entfernen", "Wirklich? Offene Kanäle bleiben, bis sie leer sind.", async () => {
            const answer = await call("", { action: "remove", id: hub.id });

            if (!answer) return;

            data!.hubs = data!.hubs.filter((entry) => entry.id !== hub.id);
            drafts.delete(hub.id);
            toast("info", "Hub entfernt", "Hier entsteht kein neuer Kanal mehr.");
            paint();
        });

        edit.addEventListener("click", () => {
            open = isOpen ? null : hub.id;
            paint();
        });

        const box = el(
            "div",
            `snitem${isOpen ? " is-open" : ""}`,
            el(
                "div",
                "snitem__head",
                el("div", "snitem__face", icon("#i-mic")),
                el("div", "snitem__name", el("b", "", hub.channelName ? `🔊 ${hub.channelName}` : "(Kanal gelöscht)"), el("span", "", `Neue Kanäle heißen „${hub.config.name}"`)),
                edit,
                remove
            )
        );

        if (isOpen) box.append(body(hub, draft));

        return box;
    }

    function body(hub: IHub, draft: { config: IHubConfig; dirty: boolean }): HTMLElement {
        const config = draft.config;
        const saveButton = button("btn btn--primary", icon("#i-check"), "Speichern");
        const touch = (): void => {
            draft.dirty = true;
            saveButton.disabled = false;
        };

        saveButton.disabled = !draft.dirty;

        const name = el("input", "text");

        name.type = "text";
        name.value = config.name;
        name.maxLength = 90;
        name.setAttribute("aria-label", "Vorlage für den Namen");
        name.addEventListener("input", () => {
            config.name = name.value;
            touch();
        });

        const category = select(
            [["", "Wie der Hub"], ...data!.guild.categories.map((entry): [string, string] => [entry.id, entry.name])],
            config.categoryId ?? "",
            (value) => {
                config.categoryId = value || null;
                touch();
            },
            "Kategorie für neue Kanäle"
        );

        const limit = el("input", "text gwnum");

        limit.type = "number";
        limit.min = "0";
        limit.max = "99";
        limit.value = String(config.defaults.limit);
        limit.setAttribute("aria-label", "Plätze");
        limit.addEventListener("input", () => {
            config.defaults.limit = Math.max(0, Math.min(99, Number(limit.value) || 0));
            touch();
        });

        const privacy = select(
            [
                ["public", "Offen – jeder darf rein"],
                ["private", "Privat – nur Vertraute"],
            ],
            config.defaults.privacy,
            (value) => {
                config.defaults.privacy = value === "private" ? "private" : "public";
                touch();
            },
            "Zutritt"
        );

        const region = select(
            data!.regions.map(([value, label]): [string, string] => [value, label]),
            config.defaults.region ?? "",
            (value) => {
                config.defaults.region = value || null;
                touch();
            },
            "Region"
        );

        const stealth = toggle(config.defaults.stealth, "Neue Kanäle sind unsichtbar", (on) => {
            config.defaults.stealth = on;
            touch();
        });

        const presets = toggle(config.presets, "Eigene Presets erlauben", (on) => {
            config.presets = on;
            touch();
        });

        const actions = el("div", "vcactions");

        for (const action of data!.actions) {
            const box = toggle(config.actions.includes(action.value), action.name, (on) => {
                config.actions = on ? [...config.actions, action.value] : config.actions.filter((entry) => entry !== action.value);
                touch();
            });

            actions.append(el("label", "snkind", box, el("span", "", `${action.emoji} ${action.name}`)));
        }

        saveButton.addEventListener("click", async () => {
            saveButton.disabled = true;

            const answer = await call<{ hub: IHub }>("", { action: "save", id: hub.id, config });

            if (!answer) {
                saveButton.disabled = false;

                return;
            }

            const index = data!.hubs.findIndex((entry) => entry.id === hub.id);

            data!.hubs[index] = answer.hub;
            drafts.delete(hub.id);
            toast("info", "Gespeichert", "Gilt ab dem nächsten Kanal.");
            paint();
        });

        return el(
            "div",
            "snitem__body",
            el(
                "div",
                "snsettings",
                row("Name der Kanäle", "Vorlage – {user}, {nummer} und {spiel} werden ersetzt", name),
                row("Kategorie", "Wo die neuen Kanäle landen", category),
                row("Plätze", "0 heißt unbegrenzt", limit),
                row("Zutritt", "Gilt für jeden neuen Kanal", privacy),
                row("Region", "Automatisch reicht fast immer", region),
                row("Unsichtbar", "Nur wer eingeladen ist, sieht den Kanal", el("label", "snitem__switch", stealth, el("span", "", "Stealth"))),
                row("Presets", `Bis zu ${data!.maxPresets} eigene Einstellungen je User`, el("label", "snitem__switch", presets, el("span", "", "erlauben")))
            ),
            el("h4", "sneditor__title vctitle", "Was das Panel anbietet"),
            el("p", "hintline", "Abgeschaltete Optionen stehen im Auswahlmenü nicht mehr drin."),
            actions,
            el("div", "mcsave snitem__foot", saveButton)
        );
    }

    /* ------------------------------------------------------------
       Panel und offene Kanäle
       ------------------------------------------------------------ */
    function panelCard(): HTMLElement {
        const settings = { ...data!.settings };
        const saveButton = button("btn btn--primary", icon("#i-check"), "Speichern");
        const send = button("btn btn--quiet", icon("#i-message"), "Panel senden");
        const where = select(
            [
                ["voice", "In den Chat des eigenen Kanals"],
                ["channel", "In einen festen Kanal"],
            ],
            settings.panel,
            (value) => {
                settings.panel = value === "channel" ? "channel" : "voice";
                saveButton.disabled = false;
                target.disabled = settings.panel !== "channel";
            },
            "Wohin das Panel geht"
        );
        const target = select(
            [["", "— Kanal wählen —"], ...data!.guild.channels.map((entry): [string, string] => [entry.id, `# ${entry.name}`])],
            settings.panelChannelId ?? "",
            (value) => {
                settings.panelChannelId = value || null;
                saveButton.disabled = false;
            },
            "Kanal für das Panel"
        );

        target.disabled = settings.panel !== "channel";
        saveButton.disabled = true;
        saveButton.addEventListener("click", async () => {
            saveButton.disabled = true;

            const answer = await call<{ settings: IPayload["settings"] }>("", { action: "settings", settings });

            if (!answer) {
                saveButton.disabled = false;

                return;
            }

            data!.settings = answer.settings;
            toast("info", "Gespeichert", answer.settings.panel === "voice" ? "Das Panel steht künftig im Chat des eigenen Kanals." : "Schick das Panel unten in den Kanal.");
            paint();
        });

        send.addEventListener("click", async () => {
            send.disabled = true;

            const answer = await call<{ url: string }>("", { action: "panel" });

            send.disabled = false;

            if (answer) toast("info", "Panel gesendet", "Es bleibt stehen und gilt für alle.");
        });

        return card(
            "Steuer-Panel",
            "Das Auswahlmenü, mit dem jeder seinen eigenen Kanal einstellt. Im Chat des Sprachkanals steht es automatisch – ein fester Kanal ist praktisch, wenn ihr die Kanal-Chats aus habt.",
            row("Wohin", "Im Sprachkanal-Chat oder an einer festen Stelle", where),
            row("Fester Kanal", "Nur nötig, wenn das Panel an einer Stelle stehen soll", target),
            el("div", "mcsave", ...(data!.settings.panel === "channel" ? [send] : []), saveButton)
        );
    }

    function openList(): HTMLElement {
        if (!data!.open.length) {
            return card(
                "Gerade offen",
                "Keine Kanäle offen. Sobald jemand einen Hub betritt, steht er hier.",
                el("div", "tkempty", icon("#i-mic"), el("span", "", "Noch ruhig."))
            );
        }

        const list = el(
            "div",
            "pllist",
            ...data!.open.map((entry) =>
                el(
                    "div",
                    "plrow vcrow",
                    el("div", "snitem__face vcface", icon("#i-mic")),
                    el(
                        "div",
                        "plrow__main",
                        el("div", "plrow__top", el("b", "", entry.name), el("span", `chip ${entry.privacy === "private" ? "chip--warn" : ""}`, entry.privacy === "private" ? "privat" : "offen")),
                        el("span", "gwrow__facts", `${entry.owner} · ${entry.members} drin · seit ${ago(entry.createdAt)}`)
                    )
                )
            )
        );

        return card("Gerade offen", `${data!.open.length} Kanal${data!.open.length === 1 ? "" : "e"} – sie verschwinden, sobald der letzte rausgeht.`, list);
    }

    /* ------------------------------------------------------------
       Zeichnen und Laden
       ------------------------------------------------------------ */
    function paint(): void {
        if (!data) return;

        const hubs = el(
            "div",
            "snlist",
            ...(data.hubs.length
                ? data.hubs.map(item)
                : [
                      el(
                          "div",
                          "tkempty tkempty--big",
                          icon("#i-mic"),
                          el("b", "", "Noch kein Hub."),
                          el("span", "", "Wähle oben einen Sprachkanal – wer ihn betritt, bekommt seinen eigenen.")
                      ),
                  ])
        );

        host.replaceChildren(head(), addBar(), hubs, panelCard(), openList());
    }

    host.replaceChildren(el("div", "tkhead", ...Array.from({ length: 4 }, () => el("div", "sb snskel"))));

    void call<IPayload>("").then((answer) => {
        if (!answer) return;

        data = answer;
        paint();
    });
}
