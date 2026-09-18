import { AttachmentBuilder, ContainerBuilder, Guild, User } from "discord.js";
import BotClient from "../client/BotClient";
import ComponentV2Builder from "./ComponentV2Builder";
import { RenderDoc } from "./MessageDoc";
import { PlaceholderValues } from "../constants/Placeholders";
import {
    ACTIONS,
    ACTIONS_CONFIG,
    CORE_ACTIONS,
    PRIORITY_LABELS,
    TICKET_PREFIX,
    TicketMessageKey,
    TicketNumber,
} from "../constants/Tickets";
import { ISelectEntryOptions } from "../interfaces/builder/IComponentV2Builder";
import IConfigOption from "../interfaces/services/config/IConfigOption";
import { ITicket, ITicketConfig, ITicketOption } from "../interfaces/services/tickets/ITicket";

export interface ITicketView {
    components: ContainerBuilder[];
    files: AttachmentBuilder[];
}

function View(builder: ComponentV2Builder, files: AttachmentBuilder[] = []): ITicketView {
    return { components: [builder.build()], files };
}

export function OptionOf(config: ITicketConfig, ticket: ITicket): ITicketOption | null {
    return config.options.find((option) => option.id === ticket.optionId) ?? null;
}

/** Die Rolle, die ein Ticket sieht: die eigene der Option, sonst die allgemeine. */
export function SupportRoleOf(config: ITicketConfig, option: ITicketOption | null): string | null {
    return option?.supportRoleId ?? config.supportRoleId;
}

/**
 * Die Werte der Platzhalter. mentions: false für DMs - dort zeigt Discord eine
 * Rollen-Erwähnung als "@unbekannte-rolle", also stehen dort Namen.
 */
export function TicketValues(
    guild: Guild,
    config: ITicketConfig,
    context: { user?: User; ticket?: ITicket; closer?: string; reason?: string; mentions?: boolean } = {}
): PlaceholderValues {
    const { user, ticket, mentions = true } = context;
    const option = ticket ? OptionOf(config, ticket) : null;
    const roleId = ticket ? SupportRoleOf(config, option) : config.supportRoleId;
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    const claimer = ticket?.claimedBy ? guild.client.users.cache.get(ticket.claimedBy) : null;

    const values: PlaceholderValues = {
        guild: guild.name,
        "guild.id": guild.id,
        "guild.icon": guild.iconURL({ extension: "png", size: 256 }) ?? "",
        "guild.members": String(guild.memberCount),
        "support.role": role ? (mentions ? `<@&${role.id}>` : role.name) : "das Team",
        bot: guild.client.user ? (mentions ? `<@${guild.client.user.id}>` : guild.client.user.displayName) : "dem Bot",
    };

    if (user) {
        values.user = mentions ? `<@${user.id}>` : user.displayName;
        values["user.name"] = user.displayName;
        values["user.id"] = user.id;
        values["user.avatar"] = user.displayAvatarURL({ extension: "png", size: 256 });
    }

    if (ticket) {
        values["ticket.id"] = TicketNumber(ticket.number);
        values["ticket.option"] = option?.name ?? ticket.optionId;
        values["ticket.priority"] = ticket.priority ? PRIORITY_LABELS[ticket.priority].name : "Keine";
        values["ticket.opened"] = `<t:${Math.floor(ticket.createdAt.getTime() / 1000)}:R>`;
        values["ticket.claimer"] = ticket.claimedBy
            ? mentions
                ? `<@${ticket.claimedBy}>`
                : claimer?.displayName ?? "das Team"
            : "niemand";
    }

    if (context.closer !== undefined) values.closer = context.closer;
    if (context.reason !== undefined) values.reason = context.reason;

    return values;
}

/**
 * Name, Beschreibung und Emoji der Aktionen aus src/config/ticketactions.json.
 * Fehlt dort ein Eintrag, steht die Aktion trotzdem im Menü - nur schlichter.
 */
export function ActionEntries(client: BotClient): IConfigOption[] {
    const configured = client.configService.Has(ACTIONS_CONFIG)
        ? client.configService.Options(ACTIONS_CONFIG, "options")
        : [];

    return ACTIONS.map(
        (value) =>
            configured.find((entry) => entry.value === value) ?? { name: value, value, description: "", emoji: "⚙️" }
    );
}

/** Das Menü unter dem Ticket: feste plus zugeschaltete Aktionen, passend zum Zustand. */
export function MenuOptions(client: BotClient, config: ITicketConfig, ticket: ITicket): ISelectEntryOptions[] {
    const enabled = new Set<string>([...CORE_ACTIONS, ...config.actions]);

    return ActionEntries(client)
        .filter((entry) => enabled.has(entry.value))
        .filter((entry) => !(entry.value === "claim" && ticket.claimedBy) && !(entry.value === "unclaim" && !ticket.claimedBy))
        .map((entry) => ({
            label: entry.value === "freeze" && ticket.status === "frozen" ? "Ticket auftauen" : entry.name.slice(0, 100),
            value: entry.value,
            description: entry.description ? entry.description.slice(0, 100) : undefined,
            emoji: entry.emoji || undefined,
        }));
}

function StatusLine(config: ITicketConfig, ticket: ITicket): string {
    const option = OptionOf(config, ticket);
    const parts = [`🎫 ${TicketNumber(ticket.number)}`, option?.name ?? ticket.optionId];

    if (ticket.priority) parts.push(`${PRIORITY_LABELS[ticket.priority].emoji} ${PRIORITY_LABELS[ticket.priority].name}`);

    parts.push(ticket.claimedBy ? `✅ <@${ticket.claimedBy}>` : "⏳ Wartet auf das Team");

    if (ticket.status === "frozen") parts.push("❄️ Eingefroren");
    if (ticket.status === "closed") parts.push("🔒 Geschlossen");
    if (ticket.reminderAt) parts.push(`📅 <t:${Math.floor(ticket.reminderAt / 1000)}:f>`);

    return parts.join(" · ");
}

/** Das Panel im Server-Kanal: Nachricht plus Knöpfe oder Auswahlmenü. */
export async function PanelView(client: BotClient, guild: Guild, config: ITicketConfig): Promise<ITicketView> {
    const options = config.options;
    const rows = Math.ceil(options.length / 5);
    const modmail = config.contact === "modmail";
    // Bei ModMail steht unter den Themen noch ein Link zum Bot: eine Reihe, ein Knopf.
    const reserve = (config.style === "buttons" ? rows + options.length : 2) + (modmail ? 2 : 0);

    const { builder, files } = await RenderDoc(
        client,
        modmail ? config.messages.modmailPanel : config.messages.panel,
        TicketValues(guild, config),
        { reserve, fallback: modmail ? "# 📬 Schreib {bot} eine DM" : "# 🎫 Tickets" }
    );

    if (config.style === "select") {
        builder.select({
            customId: `${TICKET_PREFIX}:open`,
            placeholder: "Worum geht es?",
            options: options.map((option) => ({
                label: option.name,
                value: option.id,
                description: option.description || undefined,
                emoji: option.emoji ?? undefined,
            })),
        });
    } else {
        for (let index = 0; index < options.length; index += 5) {
            builder.buttons(
                ...options.slice(index, index + 5).map((option) => ({
                    customId: `${TICKET_PREFIX}:open:${option.id}`,
                    label: option.name,
                    emoji: option.emoji ?? undefined,
                    tone: "primary" as const,
                }))
            );
        }
    }

    // Öffnet das Profil des Bots - von dort ist es ein Klick bis zur DM. Einen
    // direkten Link in eine DM, die es noch nicht gibt, kennt Discord nicht.
    if (modmail && client.user) {
        builder.buttons({ url: `https://discord.com/users/${client.user.id}`, label: "Bot per DM anschreiben", emoji: "📬" });
    }

    return View(builder, files);
}

/** Eröffnung auf der Team-Seite: Nachricht, Statuszeile, Aktions-Menü. */
export async function OpenedView(
    client: BotClient,
    guild: Guild,
    config: ITicketConfig,
    ticket: ITicket,
    opener: User
): Promise<ITicketView> {
    const option = OptionOf(config, ticket);
    const closed = ticket.status === "closed";

    const { builder, files } = await RenderDoc(
        client,
        option?.opened ?? config.messages.opened,
        TicketValues(guild, config, { user: opener, ticket }),
        { reserve: closed ? 2 : 4, fallback: "## Ticket {ticket.id}" }
    );

    builder.separator().subtext(StatusLine(config, ticket));

    if (!closed) {
        builder.select({
            customId: `${TICKET_PREFIX}:act:${ticket.id}`,
            placeholder: "⚙️ | Aktion wählen …",
            options: MenuOptions(client, config, ticket),
        });
    }

    return View(builder, files);
}

/** Bestätigung per DM bei ModMail - mit einem Knopf zum Schließen. */
export async function DirectView(
    client: BotClient,
    guild: Guild,
    config: ITicketConfig,
    ticket: ITicket,
    opener: User
): Promise<ITicketView> {
    const { builder, files } = await RenderDoc(
        client,
        config.messages.dm,
        TicketValues(guild, config, { user: opener, ticket, mentions: false }),
        { reserve: 2, fallback: "## Ticket {ticket.id}" }
    );

    builder.buttons({ customId: `${TICKET_PREFIX}:dmclose:${ticket.id}`, label: "Ticket schließen", emoji: "🔒", tone: "danger" });

    return View(builder, files);
}

/** Eine der übrigen Nachrichten (geschlossen, eingefroren, gesperrt). */
export async function MessageView(
    client: BotClient,
    guild: Guild,
    config: ITicketConfig,
    key: TicketMessageKey,
    values: PlaceholderValues
): Promise<ITicketView> {
    const { builder, files } = await RenderDoc(client, config.messages[key], values, { fallback: "🎫 {guild}" });

    return View(builder, files);
}

/** Eine Zeile im Ticket: wer was getan hat. */
export function InfoView(text: string, accent = "#6b7683"): ITicketView {
    return View(new ComponentV2Builder({ accentColor: accent as `#${string}` }).text(text));
}

export function ErrorView(text: string): ITicketView {
    return View(new ComponentV2Builder({ accentColor: "Red" }).text(`❌ ${text}`));
}

/** Die Faktenkarte aus der Datenbank - kein Sprachmodell, nichts verlässt den Server. */
export function SummaryView(config: ITicketConfig, ticket: ITicket): ITicketView {
    const option = OptionOf(config, ticket);
    const since = Math.floor(ticket.createdAt.getTime() / 1000);

    const builder = new ComponentV2Builder({ accentColor: "#00afff" })
        .title(`📖 | Ticket ${TicketNumber(ticket.number)}`, option?.name ?? ticket.optionId)
        .separator()
        .list([
            `**Ersteller:** <@${ticket.openerId}>`,
            `**Offen seit:** <t:${since}:f> (<t:${since}:R>)`,
            `**Priorität:** ${ticket.priority ? `${PRIORITY_LABELS[ticket.priority].emoji} ${PRIORITY_LABELS[ticket.priority].name}` : "keine"}`,
            `**Bearbeiter:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : "niemand"}`,
            `**Status:** ${ticket.status === "frozen" ? "❄️ eingefroren" : ticket.status === "closed" ? "🔒 geschlossen" : "offen"}`,
            `**Nachrichten:** ${ticket.messages}`,
            `**Weitere User:** ${ticket.members.length > 0 ? ticket.members.map((id) => `<@${id}>`).join(", ") : "keine"}`,
            ...(ticket.reminderAt ? [`**Termin:** <t:${Math.floor(ticket.reminderAt / 1000)}:f>`] : []),
        ]);

    if (ticket.notes.length > 0) {
        builder
            .separator()
            .heading("📝 Team-Notizen", 3)
            .list(ticket.notes.slice(-5).map((note) => `<t:${Math.floor(note.at / 1000)}:d> <@${note.by}>: ${note.text}`));
    }

    return View(builder);
}

export interface IVaultItem {
    url: string;
    name: string;
    image: boolean;
}

/** Medien-Tresor: Bilder als Galerie, alles andere als Liste. */
export function VaultView(ticket: ITicket, items: IVaultItem[]): ITicketView {
    const builder = new ComponentV2Builder({ accentColor: "#8a4dff" }).title(
        `🖼️ | Medien-Tresor ${TicketNumber(ticket.number)}`,
        items.length === 0 ? "In diesem Ticket wurde noch nichts hochgeladen." : `${items.length} Datei(en)`
    );

    const images = items.filter((item) => item.image).slice(0, 30);
    const others = items.filter((item) => !item.image).slice(0, 15);

    for (let index = 0; index < images.length; index += 10) {
        builder.gallery(...images.slice(index, index + 10).map((item) => item.url));
    }

    if (others.length > 0) builder.list(others.map((item) => `[${item.name}](${item.url})`));

    if (items.length > images.length + others.length) builder.subtext("Ältere Dateien stehen weiter oben im Verlauf.");

    return View(builder);
}
