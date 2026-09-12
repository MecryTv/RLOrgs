import { LRUCache } from "lru-cache";
import BotClient from "../client/BotClient";
import ComponentV2Builder from "./ComponentV2Builder";
import IDevLogsService, { ILogFile } from "../interfaces/services/devlogs/IDevLogsService";
import { IDevLogsPanelView, IDevLogsState } from "../interfaces/services/devlogs/IDevLogsPanel";
import { ISessionEntry } from "../interfaces/logger/ISessionManifest";
import { Clamp, Colorize, FormatDuration, MAX_INLINE_BYTES } from "../constants/DevLogs";
import logger from "../utils/logger";

export const PANEL_PREFIX = "devlogs:panel";

const MAX_OPTIONS = 25;
const ACCENT = "#5865F2";

export const PanelStates = new LRUCache<string, IDevLogsState>({ max: 50, ttl: 30 * 60_000 });

export function NewPanelState(): IDevLogsState {
    return {
        view: "list",
        listPage: 0,
        session: null,
        part: null,
        page: 0,
        term: null,
        notice: null,
    };
}

function StatusEmoji(entry: ISessionEntry): string {
    if (entry.crashed) return "🔴";

    return entry.endedAt ? "🟢" : "🟡";
}

function StatusLabel(entry: ISessionEntry): string {
    if (entry.crashed) return "Abgestürzt";

    return entry.endedAt ? "Sauber beendet" : "Aktiv / unklar";
}

function Duration(entry: ISessionEntry): string {
    if (!entry.endedAt) return entry.crashed ? "Abgestürzt" : "Unbekannt (evtl. noch aktiv)";

    return FormatDuration(new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime());
}

// Eine Log-Zeile mit ``` würde den Codeblock des Panels aufreissen.
function Fence(text: string): string {
    return text.replaceAll("```", "'''");
}

function Paginate(sessions: ISessionEntry[], page: number) {
    const perPage = Math.min(logger.getSessionsPerPage(), MAX_OPTIONS);
    const pages = Math.max(Math.ceil(sessions.length / perPage), 1);
    const clamped = Clamp(page, pages - 1);

    return { slice: sessions.slice(clamped * perPage, (clamped + 1) * perPage), page: clamped, pages };
}

function SessionMenu(builder: ComponentV2Builder, sessions: ISessionEntry[], state: IDevLogsState): void {
    const { slice } = Paginate(sessions, state.listPage);
    if (slice.length === 0) return;

    builder.select({
        customId: `${PANEL_PREFIX}:session`,
        placeholder: "🗂️ | Session wählen...",
        options: slice.map((entry) => ({
            label: `Session #${entry.sessionNumber}`,
            value: String(entry.sessionNumber),
            description: `${new Date(entry.startedAt).toLocaleString("de-DE")} · ${Duration(entry)}`.slice(0, 100),
            emoji: StatusEmoji(entry),
            default: entry.sessionNumber === state.session,
        })),
    });
}

function Head(state: IDevLogsState, title: string, subtitle?: string): ComponentV2Builder {
    const builder = new ComponentV2Builder({ accentColor: ACCENT }).title(title, subtitle);

    if (state.notice) builder.subtext(state.notice);

    return builder.separator();
}

function List(devlogs: IDevLogsService, state: IDevLogsState): IDevLogsPanelView {
    const sessions = devlogs.Sessions();
    const { page, pages } = Paginate(sessions, state.listPage);

    state.listPage = page;

    const builder = Head(
        state,
        "🗂️ | Development Logs",
        sessions.length > 0 ? `Aktuell läuft Session #${logger.getCurrentSessionNumber()}` : undefined
    );

    if (sessions.length === 0) {
        builder.text("Es sind noch keine Session-Logs vorhanden.");

        return { components: [builder.build()] };
    }

    builder.text(`**${sessions.length}** Session(s) gespeichert${pages > 1 ? ` · Seite ${page + 1}/${pages}` : ""}`);

    SessionMenu(builder, sessions, state);

    if (pages > 1) {
        builder.buttons(
            {
                customId: `${PANEL_PREFIX}:older`,
                label: "Ältere",
                emoji: "◀️",
                disabled: page >= pages - 1,
            },
            {
                customId: `${PANEL_PREFIX}:newer`,
                label: "Neuere",
                emoji: "▶️",
                disabled: page <= 0,
            }
        );
    }

    return { components: [builder.build()] };
}

async function Overview(
    devlogs: IDevLogsService,
    state: IDevLogsState,
    file: ILogFile
): Promise<IDevLogsPanelView> {
    const { entry } = file;
    const huge = file.size > MAX_INLINE_BYTES;
    const stats = huge ? null : await devlogs.Stats(file);

    const started = Math.floor(new Date(entry.startedAt).getTime() / 1000);
    const part = file.parts > 1 ? `\n🧩 **Teil:** ${file.part + 1}/${file.parts}` : "";

    const summary = stats
        ? `📄 **Zeilen:** ${stats.lines} • ${stats.errors ? "🔴" : "⚪"} **Fehler:** ${stats.errors} • ` +
          `${stats.warnings ? "🟡" : "⚪"} **Warnungen:** ${stats.warnings}`
        : "⏳ *Für sehr große Dateien wird die Statistik übersprungen — bitte herunterladen.*";

    const builder = Head(state, `📄 | Session #${entry.sessionNumber}`, StatusLabel(entry));

    builder.text(
        `${StatusEmoji(entry)} **Status:** ${StatusLabel(entry)}\n` +
            `📅 **Gestartet:** <t:${started}:f>\n` +
            `⏱️ **Laufzeit:** ${Duration(entry)}\n` +
            `📦 **Commands:** ${entry.commandCount ?? "?"} • 🧩 **Events:** ${entry.eventCount ?? "?"}\n` +
            `💾 **Größe:** ${(file.size / 1024).toFixed(1)} KB${part}\n` +
            summary
    );

    builder.buttons(
        { customId: `${PANEL_PREFIX}:read`, label: "Volltext", emoji: "📄", tone: "primary", disabled: huge },
        { customId: `${PANEL_PREFIX}:search`, label: "Durchsuchen", emoji: "🔍", disabled: huge },
        { customId: `${PANEL_PREFIX}:download`, label: "Herunterladen", emoji: "⬇️" },
        { customId: `${PANEL_PREFIX}:list`, label: "Zur Liste", emoji: "⬅️", tone: "danger" }
    );

    if (stats?.errorPages.length) {
        builder.buttons({
            customId: `${PANEL_PREFIX}:errfirst`,
            label: `Zum 1. von ${stats.errorPages.length} Fehler(n)`,
            emoji: "🔴",
            tone: "danger",
        });
    }

    if (file.parts > 1) {
        builder.buttons(
            {
                customId: `${PANEL_PREFIX}:partprev`,
                label: "Vorheriger Teil",
                emoji: "◀️",
                disabled: file.part <= 0,
            },
            {
                customId: `${PANEL_PREFIX}:partnext`,
                label: "Nächster Teil",
                emoji: "▶️",
                disabled: file.part >= file.parts - 1,
            }
        );
    }

    SessionMenu(builder, devlogs.Sessions(), state);

    return { components: [builder.build()] };
}

async function Page(devlogs: IDevLogsService, state: IDevLogsState, file: ILogFile): Promise<IDevLogsPanelView> {
    const { text, page, pages } = await devlogs.Page(file, state.page);
    const { errorPages } = await devlogs.Stats(file);

    state.page = page;

    const colored = Fence(text).split("\n").map(Colorize).join("\n");
    const here = errorPages.indexOf(page);

    const hint = !errorPages.length
        ? ""
        : here === -1
          ? `\n🔴 **${errorPages.length}** Fehlerstelle(n) in dieser Datei — nutze die Fehler-Navigation.`
          : `\n🔴 **Fehlerstelle ${here + 1}/${errorPages.length}** — auf dieser Seite.`;

    const builder = Head(state, `📄 | Session #${file.entry.sessionNumber}`, `Seite ${page + 1}/${pages}`);

    builder.text(`\`\`\`ansi\n${colored || "(leer)"}\n\`\`\`${hint}`);

    builder.buttons(
        { customId: `${PANEL_PREFIX}:prev`, label: "Zurück", emoji: "◀️", disabled: page <= 0 },
        { customId: `${PANEL_PREFIX}:next`, label: "Weiter", emoji: "▶️", disabled: page >= pages - 1 },
        { customId: `${PANEL_PREFIX}:jump`, label: "Seite…", emoji: "🔢", disabled: pages <= 1 },
        { customId: `${PANEL_PREFIX}:overview`, label: "Übersicht", emoji: "📋", tone: "primary" },
        { customId: `${PANEL_PREFIX}:list`, label: "Zur Liste", emoji: "⬅️", tone: "danger" }
    );

    if (errorPages.length) {
        builder.buttons(
            {
                customId: `${PANEL_PREFIX}:errprev`,
                label: "Fehler zurück",
                emoji: "⏪",
                tone: "danger",
                disabled: !errorPages.some((candidate) => candidate < page),
            },
            {
                customId: `${PANEL_PREFIX}:errnext`,
                label: "Nächster Fehler",
                emoji: "⏩",
                tone: "danger",
                disabled: !errorPages.some((candidate) => candidate > page),
            }
        );
    }

    return { components: [builder.build()] };
}

async function Search(devlogs: IDevLogsService, state: IDevLogsState, file: ILogFile): Promise<IDevLogsPanelView> {
    const term = state.term ?? "";
    const { matches, total } = await devlogs.Search(file, term);

    const builder = Head(state, `🔍 | ${total} Treffer`, `Session #${file.entry.sessionNumber} · "${term}"`);

    if (total === 0) {
        builder.text(`Keine Zeile in Session #${file.entry.sessionNumber} enthält \`${Fence(term)}\`.`);
    } else {
        const body = matches
            .map((match) => Colorize(`${String(match.line).padStart(5, " ")} │ ${Fence(match.text)}`))
            .join("\n");

        const rest =
            total > matches.length
                ? `\n\n… und ${total - matches.length} weitere Treffer. Bitte präziser suchen oder herunterladen.`
                : "";

        builder.text(`\`\`\`ansi\n${body}\n\`\`\`${rest}`);
    }

    builder.buttons(
        { customId: `${PANEL_PREFIX}:search`, label: "Neue Suche", emoji: "🔍", tone: "primary" },
        { customId: `${PANEL_PREFIX}:overview`, label: "Übersicht", emoji: "📋" },
        { customId: `${PANEL_PREFIX}:list`, label: "Zur Liste", emoji: "⬅️", tone: "danger" }
    );

    return { components: [builder.build()] };
}

export async function RenderPanel(client: BotClient, state: IDevLogsState): Promise<IDevLogsPanelView> {
    const devlogs = client.devLogsService;

    if (state.view === "list" || state.session === null) return List(devlogs, state);

    const file = await devlogs.Resolve(state.session, state.part);

    if (!file) {
        state.view = "list";
        state.session = null;
        state.notice = "❌ Diese Session gibt es nicht mehr — evtl. automatisch aufgeräumt.";

        return List(devlogs, state);
    }

    state.part = file.part;

    if (state.view === "search" && state.term) return Search(devlogs, state, file);
    if (state.view === "page" && file.size <= MAX_INLINE_BYTES) return Page(devlogs, state, file);

    state.view = "overview";

    return Overview(devlogs, state, file);
}
