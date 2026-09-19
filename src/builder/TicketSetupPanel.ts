import { ChannelType, Guild } from "discord.js";
import { LRUCache } from "lru-cache";
import BotClient from "../client/BotClient";
import ComponentV2Builder from "./ComponentV2Builder";
import { ActionEntries, ITicketView } from "./TicketPanel";
import {
    CONTACT_LABELS,
    CORE_ACTIONS,
    DELETE_AFTER_HOURS,
    DeleteLabel,
    MAX_LIMIT,
    MESSAGE_KEYS,
    MESSAGE_LABELS,
    SETUP_PREFIX,
    STYLE_LABELS,
    SURFACE_LABELS,
} from "../constants/Tickets";
import { ITicketConfig } from "../interfaces/services/tickets/ITicket";

export const SETUP_PAGES = ["start", "options", "actions", "messages", "transcripts", "panel"] as const;
export type SetupPage = (typeof SETUP_PAGES)[number];

const PAGE_LABELS: Record<SetupPage, { name: string; description: string; emoji: string }> = {
    start: { name: "Grundlagen", description: "Kontakt, Oberfläche, Support-Rolle, Grenzen", emoji: "⚙️" },
    options: { name: "Öffnungs-Optionen", description: "Wofür Tickets aufgemacht werden", emoji: "🗂️" },
    actions: { name: "Aktionen", description: "Was im Ticket zur Auswahl steht", emoji: "🧰" },
    messages: { name: "Nachrichten", description: "Panel, Eröffnung, Abschluss und mehr", emoji: "✉️" },
    transcripts: { name: "Transcripts", description: "Verlauf speichern, Log-Kanal, Kopie per DM", emoji: "📄" },
    panel: { name: "Panel senden", description: "Wo das Ticket-Panel steht", emoji: "📮" },
};

export interface ISetupState {
    guildId: string;
    page: SetupPage;
    /** Welche Öffnungs-Option gerade bearbeitet wird. */
    optionId: string | null;
    /** Wohin das Panel gehen soll, bevor es abgeschickt ist. */
    panelChannelId: string | null;
    notice: string | null;
}

/** Der Zustand lebt im Speicher, wie beim Galerie-Panel - die customId ist zu kurz dafür. */
export const SetupStates = new LRUCache<string, ISetupState>({ max: 200, ttl: 30 * 60_000 });

export function NewSetupState(guildId: string): ISetupState {
    return { guildId, page: "start", optionId: null, panelChannelId: null, notice: null };
}

function Mention(id: string | null, kind: "role" | "channel"): string {
    if (!id) return "_nicht gesetzt_";

    return kind === "role" ? `<@&${id}>` : `<#${id}>`;
}

/** Die Zeile unter der Überschrift: der ganze Aufbau in einem Satz. */
function Summary(config: ITicketConfig): string {
    return [
        CONTACT_LABELS[config.contact],
        SURFACE_LABELS[config.surface],
        STYLE_LABELS[config.style],
        `${config.options.length} Option(en)`,
    ].join(" · ");
}

function Start(builder: ComponentV2Builder, config: ITicketConfig): void {
    builder
        .text(
            [
                `**Kontakt:** ${CONTACT_LABELS[config.contact]} – ${config.contact === "direct" ? "der User sitzt im Ticket" : "der User schreibt dem Bot per DM"}`,
                `**Oberfläche:** ${config.surface === "channel" ? "ein Textkanal je Ticket" : "ein Forum-Post je Ticket (mit Tags)"}`,
                `**Panel:** ${STYLE_LABELS[config.style]}`,
                `**Support-Rolle:** ${Mention(config.supportRoleId, "role")}`,
                ...(config.surface === "forum" ? [`**Forum:** ${Mention(config.forumId, "channel")}`] : []),
                `**Offene Tickets je User:** ${config.limit === 0 ? "ohne Grenze" : config.limit}`,
                `**Kanal löschen:** ${DeleteLabel(config.deleteAfter)}`,
            ].join("\n")
        )
        .subtext("Ein Klick auf die Knöpfe wechselt den Wert.")
        .buttons(
            { customId: `${SETUP_PREFIX}:contact`, label: `Kontakt: ${CONTACT_LABELS[config.contact]}`, emoji: "🔁" },
            { customId: `${SETUP_PREFIX}:surface`, label: `Oberfläche: ${SURFACE_LABELS[config.surface]}`, emoji: "🔁" },
            { customId: `${SETUP_PREFIX}:style`, label: `Panel: ${STYLE_LABELS[config.style]}`, emoji: "🔁" }
        )
        .roleSelect({ customId: `${SETUP_PREFIX}:role`, placeholder: "Support-Rolle wählen …" });

    if (config.surface === "forum") {
        builder.channelSelect({
            customId: `${SETUP_PREFIX}:forum`,
            channelTypes: [ChannelType.GuildForum],
            placeholder: "Forum für die Tickets wählen …",
        });
    }

    builder
        .select({
            customId: `${SETUP_PREFIX}:limit`,
            placeholder: "Offene Tickets je User …",
            options: Array.from({ length: MAX_LIMIT + 1 }, (_, value) => ({
                label: value === 0 ? "Ohne Grenze" : `${value} offene(s) Ticket(s)`,
                value: String(value),
                default: config.limit === value,
            })),
        })
        .select({
            customId: `${SETUP_PREFIX}:delete`,
            placeholder: "Kanal nach dem Schließen löschen …",
            options: DELETE_AFTER_HOURS.map((hours) => ({
                label: DeleteLabel(hours),
                value: String(hours),
                default: config.deleteAfter === hours,
            })),
        });
}

function Options(builder: ComponentV2Builder, config: ITicketConfig, state: ISetupState): void {
    const chosen = config.options.find((option) => option.id === state.optionId) ?? null;

    builder.text(
        config.options.length === 0
            ? "Es gibt noch keine Option. Ohne Option kann niemand ein Ticket öffnen."
            : config.options
                  .map((option, index) => {
                      const target =
                          config.surface === "channel"
                              ? option.categoryId
                                  ? `<#${option.categoryId}>`
                                  : "_ohne Kategorie_"
                              : option.tagId
                                ? "Tag steht"
                                : "_Tag fehlt_";

                      return `${index + 1}. ${option.emoji ?? "•"} **${option.name}** — ${option.description || "_ohne Beschreibung_"}\n-# Ziel: ${target} · Rolle: ${option.supportRoleId ? `<@&${option.supportRoleId}>` : "allgemeine"}`;
                  })
                  .join("\n")
    );

    if (config.options.length > 0) {
        builder.select({
            customId: `${SETUP_PREFIX}:pick`,
            placeholder: "Option zum Bearbeiten wählen …",
            options: config.options.map((option) => ({
                label: option.name,
                value: option.id,
                description: option.description || undefined,
                emoji: option.emoji ?? undefined,
                default: option.id === state.optionId,
            })),
        });
    }

    builder.buttons(
        { customId: `${SETUP_PREFIX}:add`, label: "Hinzufügen", emoji: "➕", tone: "success" },
        { customId: `${SETUP_PREFIX}:edit`, label: "Bearbeiten", emoji: "✏️", disabled: !chosen },
        { customId: `${SETUP_PREFIX}:up`, label: "Nach oben", emoji: "⬆️", disabled: !chosen },
        { customId: `${SETUP_PREFIX}:del`, label: "Löschen", emoji: "🗑️", tone: "danger", disabled: !chosen }
    );

    if (!chosen) return;

    if (config.surface === "channel") {
        builder.channelSelect({
            customId: `${SETUP_PREFIX}:cat`,
            channelTypes: [ChannelType.GuildCategory],
            placeholder: `Kategorie für „${chosen.name}" …`,
        });
    }

    builder.roleSelect({ customId: `${SETUP_PREFIX}:optrole`, placeholder: `Eigene Support-Rolle für „${chosen.name}" …` });
}

function Actions(builder: ComponentV2Builder, client: BotClient, config: ITicketConfig): void {
    const entries = ActionEntries(client);
    const optional = entries.filter((entry) => !(CORE_ACTIONS as readonly string[]).includes(entry.value));

    builder
        .text(
            `**Immer dabei:** ${entries
                .filter((entry) => (CORE_ACTIONS as readonly string[]).includes(entry.value))
                .map((entry) => `${entry.emoji} ${entry.name}`)
                .join(" · ")}`
        )
        .subtext("Alles andere schaltest du hier zu. Das Menü im Ticket zeigt nur, was an ist.")
        .select({
            customId: `${SETUP_PREFIX}:actions`,
            placeholder: "Zusätzliche Aktionen wählen …",
            minValues: 0,
            maxValues: optional.length,
            options: optional.map((entry) => ({
                label: entry.name,
                value: entry.value,
                description: entry.description ? entry.description.slice(0, 100) : undefined,
                emoji: entry.emoji || undefined,
                default: config.actions.includes(entry.value as (typeof config.actions)[number]),
            })),
        });
}

function Messages(builder: ComponentV2Builder, config: ITicketConfig): void {
    builder
        .text(
            MESSAGE_KEYS.map((key) => {
                const blocks = config.messages[key].blocks.length;
                const modmail = config.contact === "modmail";
                const unused =
                    (key === "dm" || key === "modmailPanel") && !modmail
                        ? " _(nur bei ModMail)_"
                        : key === "panel" && modmail
                          ? " _(nur bei Klassisch)_"
                          : "";

                return `${MESSAGE_LABELS[key]} — ${blocks} Baustein(e)${unused}`;
            }).join("\n")
        )
        .subtext("Hier gibt es die Kurzfassung: Text, Farbe, ein Bild. Bausteine, Platzhalter-Hilfe und die Bildauswahl stehen im Dashboard.")
        .select({
            customId: `${SETUP_PREFIX}:msg`,
            placeholder: "Nachricht bearbeiten …",
            options: MESSAGE_KEYS.map((key) => ({ label: MESSAGE_LABELS[key], value: key })),
        });
}

function Transcripts(builder: ComponentV2Builder, config: ITicketConfig): void {
    const { enabled, channelId, dm } = config.transcripts;
    const modmail = config.contact === "modmail";

    builder
        .text(
            [
                `**Transcripts:** ${enabled ? "an – jedes geschlossene Ticket steht im Dashboard unter Transcriptions" : "aus"}`,
                `**Log-Kanal:** ${channelId ? `<#${channelId}>` : "_keiner_"}`,
                `**Kopie per DM an den Ersteller:** ${dm ? "an" : "aus"}${modmail ? " _(bei ModMail entfällt sie – das Gespräch steht schon in seinen DMs)_" : ""}`,
            ].join("\n")
        )
        .subtext("Ein Transcript zeigt den ganzen Verlauf im Discord-Look – auch Components V2, Bilder und Anhänge.")
        .buttons(
            { customId: `${SETUP_PREFIX}:trsave`, label: `Transcripts: ${enabled ? "an" : "aus"}`, emoji: "🔁" },
            { customId: `${SETUP_PREFIX}:trdm`, label: `DM an Ersteller: ${dm ? "an" : "aus"}`, emoji: "🔁", disabled: !enabled },
            { customId: `${SETUP_PREFIX}:trnone`, label: "Kein Log-Kanal", emoji: "🚫", disabled: !channelId }
        )
        .channelSelect({
            customId: `${SETUP_PREFIX}:trchan`,
            // Auch Threads: ein Beitrag in einem Forum taugt genauso als Log.
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.AnnouncementThread],
            placeholder: "Log-Kanal oder Forum-Beitrag für Transcripts wählen …",
            disabled: !enabled,
        });
}

async function Panel(
    builder: ComponentV2Builder,
    client: BotClient,
    guild: Guild,
    config: ITicketConfig,
    state: ISetupState
): Promise<void> {
    const placed = await client.ticketService.PanelStatus(guild, config);
    const target = state.panelChannelId ?? placed?.channelId ?? null;
    const here = placed !== null && target === placed.channelId;

    builder
        .text(
            [
                placed ? `Das Panel steht in <#${placed.channelId}>. [Zur Nachricht](${placed.url})` : "Gerade steht nirgends ein Panel.",
                !target
                    ? "Wähle unten einen Kanal."
                    : here
                      ? "Ein Klick bringt es auf den neuen Stand – ein zweites Panel gibt es nicht."
                      : `Ziel: <#${target}>${placed ? " – das alte Panel verschwindet dann." : ""}`,
                config.options.length === 0 ? "\n⚠️ Ohne Öffnungs-Option kann das Panel nicht gesendet werden." : "",
            ]
                .filter(Boolean)
                .join("\n")
        )
        .channelSelect({
            customId: `${SETUP_PREFIX}:panelchan`,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            placeholder: "Kanal für das Panel wählen …",
        })
        .buttons(
            {
                customId: `${SETUP_PREFIX}:send`,
                label: !placed ? "Panel senden" : here ? "Panel aktualisieren" : "Panel hierher umziehen",
                emoji: "📮",
                tone: "primary",
                disabled: !target || config.options.length === 0,
            },
            { customId: `${SETUP_PREFIX}:unpanel`, label: "Panel entfernen", emoji: "🗑️", tone: "danger", disabled: !placed }
        );
}

/** Der Assistent von /ticket setup - eine Seite nach der anderen. */
export async function SetupView(client: BotClient, guild: Guild, state: ISetupState): Promise<ITicketView> {
    const config = await client.ticketSettings.Of(guild.id);
    const builder = new ComponentV2Builder({ accentColor: "#ff1e2d" }).title("🎫 | Ticket-System einrichten", Summary(config));

    if (state.notice) builder.subtext(state.notice);

    builder
        .separator()
        .select({
            customId: `${SETUP_PREFIX}:page`,
            placeholder: "Bereich wählen …",
            options: SETUP_PAGES.map((page) => ({
                label: PAGE_LABELS[page].name,
                value: page,
                description: PAGE_LABELS[page].description,
                emoji: PAGE_LABELS[page].emoji,
                default: page === state.page,
            })),
        })
        .separator({ divider: false });

    if (state.page === "start") Start(builder, config);
    else if (state.page === "options") Options(builder, config, state);
    else if (state.page === "actions") Actions(builder, client, config);
    else if (state.page === "messages") Messages(builder, config);
    else if (state.page === "transcripts") Transcripts(builder, config);
    else await Panel(builder, client, guild, config, state);

    return { components: [builder.build()], files: [] };
}
