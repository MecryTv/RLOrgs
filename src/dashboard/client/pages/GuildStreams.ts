/**
 * Abschnitt: Twitch Notifier und YouTube Notifier - eine Seite, zwei Plattformen.
 *
 * Oben die Zahlen und was dem Bot fehlt (Twitch-App, API-Schlüssel, Presence
 * Intent), darunter "Hinzufügen" und je Streamer bzw. Kanal eine Karte: Stand
 * (live, zuletzt ...), an/aus, und aufgeklappt Kanal, Ping, was gemeldet wird
 * und die eigene Nachricht mit Platzhaltern und Live-Vorschau - derselbe
 * Editor wie bei den Tickets. Bei Twitch unten die Live-Rolle.
 */

import { BASE } from "../core/Base.js";
import { icon, need } from "../core/Dom.js";
import { ago } from "../core/Format.js";
import { ILogTargets, ILogThread, logTargetSelect } from "../core/LogTarget.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { api, button, card, confirmButton, el, face, IRole, pingSelect, row, select, stat, toggle } from "../core/Ui.js";
import { TWITCH_IMAGES, TWITCH_PLACEHOLDERS, YOUTUBE_IMAGES, YOUTUBE_PLACEHOLDERS } from "../constants/Placeholders.js";
import { IServerEmoji } from "../layout/EmojiPicker.js";
import { IEditorContext, IMessageDoc, insertPlaceholder, renderEditor, renderPreview } from "../layout/MessageEditor.js";

type Platform = "twitch" | "youtube";
type Kind = "live" | "video" | "short";

interface IConfig {
    channelId: string | null;
    ping: string | null;
    kinds: Kind[];
    messages: Partial<Record<Kind, IMessageDoc>>;
    update: boolean;
    ended: "summary" | "delete" | "keep";
    /** Der Discord-User hinter dem Kanal - für {streamer.mention} und die Live-Rolle. */
    userId: string | null;
}

interface IPerson {
    id: string;
    name: string;
    avatar: string;
}

interface INotifier {
    id: number;
    accountId: string;
    name: string;
    login: string | null;
    avatar: string | null;
    enabled: boolean;
    config: IConfig;
    /** Wer das ist in Discord - erkannt oder ausgewählt. */
    user: IPerson | null;
    /** Was je Art gilt - die eigene Nachricht oder die Vorlage. */
    messages: Record<Kind, IMessageDoc>;
    /** Die Vorlagen des Bots - für "Vorlage wiederherstellen". */
    defaults: Record<Kind, IMessageDoc>;
    live: { title: string; game: string; viewers: number; startedAt: number } | null;
    last: { id: string; title: string; kind: Kind; at: number } | null;
    status: string;
    problem: string | null;
    url: string;
}

interface IPayload {
    notifiers: INotifier[];
    max: number;
    ready: { twitch: boolean; youtubeLive: boolean; presence: boolean };
    settings: { liveRoleId: string | null; liveRoleFilter?: string | null } | null;
    guild: { name: string; icon: string | null; roles: IRole[]; emojis: IServerEmoji[] };
    targets: ILogTargets;
}

interface IDraft {
    config: IConfig;
    enabled: boolean;
    kind: Kind;
    dirty: boolean;
}

const KIND_LABEL: Record<Kind, string> = { live: "Livestream", video: "Video", short: "Short" };
const KIND_PLURAL: Record<Kind, string> = { live: "Livestreams", video: "Videos", short: "Shorts" };
const KINDS: Record<Platform, Kind[]> = { twitch: ["live"], youtube: ["video", "short", "live"] };
const BRAND: Record<Platform, { name: string; symbol: string; input: string; hint: string }> = {
    twitch: {
        name: "Twitch",
        symbol: "#i-twitch",
        input: "Twitch-Name oder Link – etwa twitch.tv/rocketleague",
        hint: "Der Bot fragt Twitch jede Minute, wer live ist. Die Karte zieht Titel, Spiel und Zuschauer nach und wird am Ende zur Zusammenfassung.",
    },
    youtube: {
        name: "YouTube",
        symbol: "#i-youtube",
        input: "Kanal-Link, @Name oder Kanal-ID (UC…)",
        hint: "Der Bot liest alle fünf Minuten den Feed der Kanäle – neue Videos und Shorts ohne API-Schlüssel, Livestreams mit.",
    },
};

/**
 * Was man in die Nachricht schreiben kann: alle Platzhalter der Plattform zum
 * Nachlesen. Ein Klick setzt einen dorthin, wo der Cursor zuletzt stand.
 */
function placeholderHint(platform: Platform, host: HTMLElement): HTMLElement {
    const list = platform === "twitch" ? TWITCH_PLACEHOLDERS : YOUTUBE_PLACEHOLDERS;
    const images = platform === "twitch" ? TWITCH_IMAGES : YOUTUBE_IMAGES;
    const chips = el("div", "phhint__list");

    for (const entry of list) {
        const key = `{${entry.key}}`;
        const chip = button("phchip", el("code", "", key), el("span", "phchip__label", entry.label));

        chip.title = `${entry.label} – Beispiel: ${entry.sample || "Bild"}`;

        if (images.includes(key)) chip.classList.add("is-image");

        chip.addEventListener("click", () => {
            if (!insertPlaceholder(key, host)) toast("info", "Kein Textfeld da", "Füge zuerst einen Text-Block hinzu.");
        });
        chips.append(chip);
    }

    return el(
        "div",
        "phhint",
        el("p", "hintline phhint__lead", "Platzhalter setzt der Bot beim Senden ein – Knopf und Ping hängt er selbst an. Ein Klick setzt ihn ins Textfeld:"),
        chips
    );
}

export function renderStreams(guildId: string, platform: Platform): void {
    const host = need<HTMLElement>(`#${platform}Body`);
    const note = need<HTMLElement>(`#${platform}Note`);
    const call = api(`${BASE}/api/guild/${encodeURIComponent(guildId)}/streams/${platform}`, note);
    const brand = BRAND[platform];

    let data: IPayload | null = null;
    let open: number | null = null;
    const drafts = new Map<number, IDraft>();

    function draftOf(notifier: INotifier): IDraft {
        let draft = drafts.get(notifier.id);

        if (!draft) {
            const config = structuredClone(notifier.config);

            // Der Editor braucht für jede Art ein Dokument - fehlt eine eigene, die Vorlage.
            for (const kind of KINDS[platform]) config.messages[kind] ??= structuredClone(notifier.messages[kind]);

            draft = { config, enabled: notifier.enabled, kind: KINDS[platform].find((kind) => config.kinds.includes(kind)) ?? KINDS[platform][0], dirty: false };
            drafts.set(notifier.id, draft);
        }

        return draft;
    }

    /* ------------------------------------------------------------
       Kopf
       ------------------------------------------------------------ */
    function notices(): HTMLElement[] {
        if (!data) return [];

        const list: HTMLElement[] = [];

        if (platform === "twitch" && !data.ready.twitch) {
            list.push(
                el(
                    "div",
                    "notice snnotice",
                    icon("#i-warn"),
                    el("span", "", "Für Twitch fehlt die Twitch-App: TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET in der .env des Bots. Bis dahin kommen keine Live-Meldungen.")
                )
            );
        }

        return list;
    }

    function head(): HTMLElement {
        const notifiers = data!.notifiers;

        if (platform === "twitch") {
            const live = notifiers.filter((entry) => entry.live).length;
            const role = data!.guild.roles.find((entry) => entry.id === data!.settings?.liveRoleId);

            return el(
                "div",
                "tkhead snhead",
                stat("#i-twitch", "Streamer", `${notifiers.length} / ${data!.max}`),
                stat("#i-play", "Gerade live", String(live), live ? "is-live" : ""),
                stat("#i-badge", "Live-Rolle", role ? `@${role.name}` : "aus", role ? "is-ok" : ""),
                stat("#i-bell", "Meldungen", notifiers.some((entry) => entry.enabled && entry.config.channelId) ? "an" : "noch kein Kanal", notifiers.some((entry) => entry.enabled && entry.config.channelId) ? "is-ok" : "is-warn")
            );
        }

        const latest = notifiers.map((entry) => entry.last).filter((entry): entry is NonNullable<INotifier["last"]> => entry !== null).sort((a, b) => b.at - a.at)[0];
        const ytRole = data!.guild.roles.find((entry) => entry.id === data!.settings?.liveRoleId);

        return el(
            "div",
            "tkhead snhead",
            stat("#i-youtube", "Kanäle", `${notifiers.length} / ${data!.max}`),
            stat("#i-play", "Zuletzt gemeldet", latest ? `${KIND_LABEL[latest.kind]} · ${ago(latest.at)}` : "noch nichts"),
            stat("#i-bell", "Livestreams", data!.ready.youtubeLive ? "an" : "braucht API-Schlüssel", data!.ready.youtubeLive ? "is-ok" : ""),
            stat("#i-badge", "Live-Rolle", ytRole ? `@${ytRole.name}` : "aus", ytRole ? "is-ok" : ""),
            stat("#i-list-checks", "Meldungen", notifiers.some((entry) => entry.enabled && entry.config.channelId) ? "an" : "noch kein Kanal", notifiers.some((entry) => entry.enabled && entry.config.channelId) ? "is-ok" : "is-warn")
        );
    }

    function addBar(): HTMLElement {
        const input = el("input", "text snadd__input");
        const go = button("btn btn--primary snadd__go", icon("#i-plus"), "Hinzufügen");
        const full = data!.notifiers.length >= data!.max;

        input.type = "text";
        input.placeholder = brand.input;
        input.disabled = full;
        input.id = `${platform}Add`;
        go.disabled = full;

        const submit = async (): Promise<void> => {
            if (!input.value.trim()) {
                input.focus();

                return;
            }

            go.disabled = true;
            go.lastChild!.textContent = "Suche …";

            const answer = await call<{ notifier: INotifier }>("", { action: "add", input: input.value });

            go.disabled = false;
            go.lastChild!.textContent = "Hinzufügen";

            if (!answer) return;

            clickSound("primary");
            toast("info", `${answer.notifier.name} ist drin`, "Wähl jetzt den Kanal – dann meldet der Bot sich dort.");
            data!.notifiers.push(answer.notifier);
            open = answer.notifier.id;
            paint();
        };

        go.addEventListener("click", () => void submit());
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") void submit();
        });

        return el(
            "section",
            "tkcard snadd",
            el("label", "snadd__label", el("span", "mcfield__label", `${brand.name} hinzufügen`), el("span", "snadd__row", icon(brand.symbol), input, go)),
            el("p", "tkcard__lead", full ? `Mehr als ${data!.max} gehen je Server nicht.` : brand.hint)
        );
    }

    /* ------------------------------------------------------------
       Eine Karte je Streamer oder Kanal
       ------------------------------------------------------------ */
    function statusChip(notifier: INotifier): HTMLElement {
        if (notifier.live) {
            return el("span", "snlive", el("i", "snlive__dot"), `LIVE · ${notifier.live.viewers} Zuschauer${notifier.live.game ? ` · ${notifier.live.game}` : ""}`);
        }

        return el("span", "mcstate is-ended", notifier.status);
    }

    function item(notifier: INotifier): HTMLElement {
        const draft = draftOf(notifier);
        const expanded = open === notifier.id;
        const edit = button(`btn btn--quiet snitem__edit${expanded ? " is-open" : ""}`, icon("#i-sliders"), expanded ? "Zuklappen" : "Bearbeiten");
        const link = el("a", "iconbtn", icon("#i-external"));
        const active = toggle(draft.enabled, `${notifier.name} aktiv`, (on) => {
            draft.enabled = on;
            void save(notifier, `${notifier.name} ist ${on ? "wieder an" : "pausiert"}.`);
        });

        edit.setAttribute("aria-expanded", String(expanded));
        edit.addEventListener("click", () => {
            open = expanded ? null : notifier.id;
            paint();
            host.querySelector<HTMLElement>(`[data-notifier="${notifier.id}"] .snitem__edit`)?.focus();
        });

        link.href = notifier.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = `${notifier.name} auf ${brand.name}`;
        link.setAttribute("aria-label", link.title);

        const remove = confirmButton("iconbtn is-danger", "#i-trash", "", "", async () => {
            if (await call("", { action: "remove", id: notifier.id })) {
                data!.notifiers = data!.notifiers.filter((entry) => entry.id !== notifier.id);
                drafts.delete(notifier.id);
                toast("info", "Entfernt", `${notifier.name} wird nicht mehr gemeldet.`);
                paint();
            }
        });

        remove.setAttribute("aria-label", `${notifier.name} entfernen`);
        remove.title = "Zweimal klicken zum Entfernen";

        const channel = notifier.config.channelId ? nameOf(notifier.config.channelId) : null;
        const head = el(
            "div",
            "snitem__head",
            face({ name: notifier.name, avatar: notifier.avatar }, "snitem__face"),
            el(
                "div",
                "snitem__name",
                el("b", "", notifier.name),
                el("span", "", `${notifier.login ?? notifier.accountId} · ${channel ? `→ ${channel}` : "kein Kanal gewählt"}`)
            ),
            statusChip(notifier),
            el("label", "snitem__switch", active, el("span", "", draft.enabled ? "Aktiv" : "Pausiert")),
            edit,
            link,
            remove
        );

        const box = el("article", `snitem${notifier.live ? " is-live" : ""}${draft.enabled ? "" : " is-paused"}${expanded ? " is-open" : ""}`, head);

        box.dataset.notifier = String(notifier.id);

        if (notifier.problem) box.append(el("p", "hintline is-warn snitem__problem", notifier.problem));
        if (expanded) box.append(editor(notifier, draft));

        return box;
    }

    function nameOf(channelId: string): string {
        const targets = data!.targets;
        const channel = targets.channels.find((entry) => entry.id === channelId);
        const thread = targets.threads.find((entry) => entry.id === channelId);

        return channel ? `#${channel.name}` : thread ? `#${thread.parentName} › ${thread.name}` : "unbekannter Kanal";
    }

    /* ------------------------------------------------------------
       Aufgeklappt: Einstellungen, Nachricht, Vorschau
       ------------------------------------------------------------ */
    function values(notifier: INotifier, kind: Kind): Record<string, string> {
        if (platform === "twitch") {
            return {
                streamer: notifier.name,
                "streamer.login": notifier.login ?? "",
                "streamer.avatar": notifier.avatar ?? "",
                "stream.title": notifier.live?.title ?? "Ranked 2v2 bis GC – !discord",
                "stream.game": notifier.live?.game ?? "Rocket League",
                "stream.url": notifier.url,
                "stream.viewers": String(notifier.live?.viewers ?? 128),
                // Ein echtes Vorschaubild gibt es nur, solange er live ist - bis dahin das Profilbild.
                "stream.preview": notifier.avatar ?? "",
                "stream.started": "vor 3 Minuten",
                guild: data!.guild.name,
            };
        }

        return {
            channel: notifier.name,
            "channel.avatar": notifier.avatar ?? "",
            "video.title": notifier.last?.title ?? "Die 10 besten Aerial-Tore der Woche",
            "video.url": notifier.last ? `https://youtu.be/${notifier.last.id}` : notifier.url,
            "video.thumbnail": notifier.last ? `https://i.ytimg.com/vi/${notifier.last.id}/hqdefault.jpg` : (notifier.avatar ?? ""),
            "video.kind": KIND_LABEL[kind],
            "video.published": "vor 2 Minuten",
            guild: data!.guild.name,
        };
    }

    function editor(notifier: INotifier, draft: IDraft): HTMLElement {
        const { config } = draft;
        const preview = el("div", "tkside__body");
        const editorHost = el("div", "tkeditor");
        const saveButton = button("btn btn--primary", icon("#i-check"), "Speichern");
        const reset = button("btn btn--quiet", "Verwerfen");
        const touch = (): void => {
            draft.dirty = true;
            saveButton.disabled = false;
            reset.disabled = false;
        };

        saveButton.disabled = !draft.dirty;
        reset.disabled = !draft.dirty;

        const context = (): IEditorContext => ({
            guildId,
            values: values(notifier, draft.kind),
            roles: new Map(data!.guild.roles.map((role) => [role.id, role.name])),
            channels: new Map(data!.targets.channels.map((channel) => [channel.id, channel.name])),
            emojis: data!.guild.emojis,
            placeholders: platform === "twitch" ? TWITCH_PLACEHOLDERS : YOUTUBE_PLACEHOLDERS,
            imagePlaceholders: platform === "twitch" ? TWITCH_IMAGES : YOUTUBE_IMAGES,
            onChange: (structural?: boolean) => {
                touch();
                paintPreview();

                if (structural) renderEditor(editorHost, config.messages[draft.kind]!, context());
            },
        });

        const paintPreview = (): void => {
            const ping = config.ping
                ? el("p", "snprev__ping", config.ping === "everyone" || config.ping === "here" ? `@${config.ping}` : `@${data!.guild.roles.find((role) => role.id === config.ping)?.name ?? "Rolle"}`)
                : null;
            const body = el("div", "");
            const mock = el(
                "div",
                "tkmock",
                el("span", "tkmock__btn", platform === "twitch" ? "📺 Zum Stream" : draft.kind === "live" ? "▶️ Zum Livestream" : "▶️ Ansehen")
            );

            renderPreview(body, config.messages[draft.kind]!, context(), mock);
            preview.replaceChildren(...(ping ? [ping] : []), body);
        };

        // Kanal, Ping, was gemeldet wird.
        const target = logTargetSelect(
            data!.targets,
            config.channelId,
            (value) => {
                config.channelId = value;
                touch();
            },
            async (forumId) => {
                const answer = await call<{ thread: ILogThread }>("", { action: "logthread", forumId });

                if (answer) toast("info", "Beitrag angelegt", `„${answer.thread.name}“ in #${answer.thread.parentName} – speichern nicht vergessen.`);

                return answer?.thread ?? null;
            },
            "— Kanal wählen —"
        );

        const ping = pingSelect(data!.guild.roles, config.ping, (value) => {
            config.ping = value;
            touch();
            paintPreview();
        });

        // Wer das in Discord ist: für {streamer.mention} und die Live-Rolle.
        const personHost = el("div", "snperson");
        const drawPerson = (person: IPerson | null): void => {
            personHost.replaceChildren(
                personPicker(person, (picked) => {
                    draft.config.userId = picked?.id ?? null;
                    notifier.user = picked;
                    touch();
                    drawPerson(picked);
                })
            );
        };

        drawPerson(notifier.user);

        const settings = el(
            "div",
            "snsettings",
            row("Kanal", "Textkanal oder Beitrag in einem Forum", target),
            row("Ping", "Wer bei jeder Meldung benachrichtigt wird", ping),
            row("Discord-User", platform === "twitch" ? "Für {streamer.mention} und die Live-Rolle – erkennt der Bot auch am Streaming-Status" : "Für {channel.mention} und die Live-Rolle bei Livestreams", personHost)
        );

        if (platform === "twitch") {
            settings.append(
                row(
                    "Karte live aktualisieren",
                    "Titel, Spiel, Zuschauer und Vorschaubild ziehen alle paar Minuten nach",
                    toggle(config.update, "Karte live aktualisieren", (on) => {
                        config.update = on;
                        touch();
                    })
                ),
                row(
                    "Nach dem Stream",
                    "Was aus der Live-Karte wird",
                    select(
                        [
                            ["summary", "Zusammenfassung mit Dauer und VOD"],
                            ["delete", "Karte löschen"],
                            ["keep", "Stehen lassen"],
                        ],
                        config.ended,
                        (value) => {
                            config.ended = value as IConfig["ended"];
                            touch();
                        },
                        "Nach dem Stream"
                    )
                )
            );
        } else {
            const kinds = el("div", "snkinds");

            for (const kind of KINDS.youtube) {
                const locked = kind === "live" && !data!.ready.youtubeLive;
                const box = toggle(config.kinds.includes(kind), KIND_LABEL[kind], (on) => {
                    config.kinds = on ? [...config.kinds, kind] : config.kinds.filter((entry) => entry !== kind);
                    touch();
                });

                box.disabled = locked;
                kinds.append(el("label", `snkind${locked ? " is-locked" : ""}`, box, el("span", "", KIND_PLURAL[kind])));
            }

            settings.append(row("Was melden", data!.ready.youtubeLive ? "Jede Art mit eigener Nachricht" : "Livestreams brauchen YOUTUBE_API_KEY in der .env", kinds));
        }

        // Die Nachricht je Art - bei YouTube umschaltbar.
        const kindTabs = el("div", "seg sneditor__kinds");

        if (KINDS[platform].length > 1) {
            kindTabs.setAttribute("role", "group");
            kindTabs.setAttribute("aria-label", "Welche Nachricht bearbeiten");

            for (const kind of KINDS[platform]) {
                const tab = button("", KIND_LABEL[kind]);

                tab.setAttribute("aria-pressed", String(kind === draft.kind));
                tab.addEventListener("click", () => {
                    draft.kind = kind;

                    for (const other of kindTabs.children) other.setAttribute("aria-pressed", String(other === tab));

                    renderEditor(editorHost, config.messages[kind]!, context());
                    paintPreview();
                });
                kindTabs.append(tab);
            }
        }

        const template = button("btn btn--quiet sneditor__reset", icon("#i-refresh"), "Vorlage");

        template.title = "Die Nachricht auf die Vorlage zurücksetzen";
        template.addEventListener("click", () => {
            config.messages[draft.kind] = structuredClone(notifier.defaults[draft.kind]);
            touch();
            renderEditor(editorHost, config.messages[draft.kind]!, context());
            paintPreview();
        });

        renderEditor(editorHost, config.messages[draft.kind]!, context());
        paintPreview();

        const test = button("btn btn--quiet", icon("#i-play"), "Test senden");

        test.addEventListener("click", async () => {
            test.disabled = true;

            if (draft.dirty && !(await save(notifier, null))) {
                test.disabled = false;

                return;
            }

            if (await call("", { action: "test", id: notifier.id, kind: draft.kind })) toast("info", "Test gesendet", "Schau in den Kanal – so sieht die echte Meldung aus.");

            test.disabled = false;
        });

        saveButton.addEventListener("click", () => void save(notifier, "Gespeichert"));
        reset.addEventListener("click", () => {
            drafts.delete(notifier.id);
            paint();
        });

        return el(
            "div",
            "snitem__body",
            el(
                "div",
                "sneditor",
                el(
                    "div",
                    "sneditor__main",
                    settings,
                    el("div", "sneditor__bar", el("h4", "sneditor__title", "Nachricht"), kindTabs, template),
                    placeholderHint(platform, editorHost),
                    editorHost
                ),
                el("aside", "sneditor__side", el("div", "tkside__head", el("span", "tkside__live", "Live-Vorschau"), el("b", "", KIND_LABEL[draft.kind])), preview)
            ),
            el("div", "mcsave snitem__foot", test, reset, saveButton)
        );
    }

    async function save(notifier: INotifier, done: string | null): Promise<boolean> {
        const draft = draftOf(notifier);
        const answer = await call<{ notifier: INotifier }>("", { action: "save", id: notifier.id, config: { ...draft.config, enabled: draft.enabled } });

        if (!answer) return false;

        const index = data!.notifiers.findIndex((entry) => entry.id === notifier.id);

        data!.notifiers[index] = answer.notifier;
        drafts.delete(notifier.id);

        if (done) toast("info", done, `${answer.notifier.name}: so meldet der Bot sich ab jetzt.`);

        paint();

        return true;
    }

    /* ------------------------------------------------------------
       Twitch: Live-Rolle
       ------------------------------------------------------------ */
    function liveRole(): HTMLElement {
        const settings: { liveRoleId: string | null; liveRoleFilter?: string | null } = { ...(data!.settings ?? { liveRoleId: null }) };
        const roles = data!.guild.roles;
        const saveButton = button("btn btn--primary", icon("#i-check"), "Speichern");
        const role = select([["", "Keine Live-Rolle"], ...roles.map((entry): [string, string] => [entry.id, `@${entry.name}`])], settings.liveRoleId ?? "", (value) => {
            settings.liveRoleId = value || null;
            saveButton.disabled = false;
        }, "Live-Rolle");
        const filter = select([["", "Alle Mitglieder"], ...roles.map((entry): [string, string] => [entry.id, `Nur mit @${entry.name}`])], settings.liveRoleFilter ?? "", (value) => {
            settings.liveRoleFilter = value || null;
            saveButton.disabled = false;
        }, "Wer die Live-Rolle bekommen kann");

        saveButton.disabled = true;
        saveButton.addEventListener("click", async () => {
            saveButton.disabled = true;

            const answer = await call<{ settings: IPayload["settings"] }>("", { action: "settings", settings });

            if (!answer) {
                saveButton.disabled = false;

                return;
            }

            data!.settings = answer.settings;
            toast("info", "Gespeichert", settings.liveRoleId ? "Wer live geht, bekommt jetzt die Rolle." : "Keine Live-Rolle mehr.");
            paint();
        });

        // Twitch sieht Discord selbst (Streaming-Status), bei YouTube weiß es nur
        // der Bot - darum zählt dort, wer am Kanal als Discord-User steht.
        const missing = platform === "youtube" ? data!.notifiers.filter((entry) => !entry.config.userId).length : 0;

        return card(
            "Live-Rolle",
            platform === "twitch"
                ? "Wer in Discord als „streamt auf Twitch“ angezeigt wird, bekommt diese Rolle – und verliert sie nach dem Stream. Die Streamer aus der Liste bekommen sie auch, sobald der Bot sie live sieht."
                : "Wer an einem Kanal als Discord-User steht, bekommt diese Rolle, solange sein Livestream läuft – und verliert sie danach.",
            ...(platform === "twitch" && !data!.ready.presence
                ? [el("div", "notice", icon("#i-warn"), el("span", "", "Für den Streaming-Status braucht der Bot das Presence Intent: GUILD_PRESENCE_INTENT=\"true\" in der .env und im Developer Portal. Die Streamer aus der Liste bekommen die Rolle auch ohne."))]
                : []),
            ...(platform === "youtube" && !data!.ready.youtubeLive
                ? [el("div", "notice", icon("#i-warn"), el("span", "", "Livestreams erkennt der Bot nur mit YOUTUBE_API_KEY – ohne den passiert hier nichts."))]
                : []),
            ...(missing
                ? [el("div", "notice", icon("#i-info"), el("span", "", `${missing === 1 ? "Ein Kanal hat" : `${missing} Kanäle haben`} noch keinen Discord-User – ohne den weiß der Bot nicht, wem die Rolle gehört.`))]
                : []),
            row("Rolle", "Muss unter der höchsten Rolle des Bots stehen", role),
            ...(platform === "twitch" ? [row("Für wen", "Gilt für den Streaming-Status – etwa nur für eure Streamer-Rolle", filter)] : []),
            el("div", "mcsave", saveButton)
        );
    }

    /* ------------------------------------------------------------
       Wer ist das in Discord?
       ------------------------------------------------------------ */
    function personPicker(chosen: IPerson | null, onPick: (person: IPerson | null) => void): HTMLElement {
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
        input.placeholder = "Mitglied suchen: Name oder ID …";
        input.setAttribute("aria-label", "Discord-User suchen");
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

    /* ------------------------------------------------------------
       Zeichnen und Laden
       ------------------------------------------------------------ */
    function paint(): void {
        if (!data) return;

        const list = el(
            "div",
            "snlist",
            ...(data.notifiers.length
                ? data.notifiers.map(item)
                : [
                      el(
                          "div",
                          "tkempty tkempty--big",
                          icon(brand.symbol),
                          el("b", "", platform === "twitch" ? "Noch kein Streamer." : "Noch kein Kanal."),
                          el("span", "", "Oben hinzufügen, Kanal wählen – fertig. Die Nachricht lässt sich danach anpassen.")
                      ),
                  ])
        );

        host.replaceChildren(...notices(), head(), addBar(), list, liveRole());
    }

    host.replaceChildren(el("div", "tkhead", ...Array.from({ length: 4 }, () => el("div", "sb snskel"))));

    void call<IPayload>("").then((answer) => {
        if (!answer) return;

        data = answer;
        paint();
    });
}
