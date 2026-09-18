import {
    AnyThreadChannel,
    ChannelType,
    DiscordAPIError,
    escapeMarkdown,
    ForumChannel,
    Guild,
    GuildForumTagData,
    GuildForumTagEmoji,
    GuildMember,
    Message,
    MessageFlags,
    OverwriteResolvable,
    OverwriteType,
    PermissionFlagsBits,
    PermissionsString,
    TextChannel,
    User,
    Webhook,
} from "discord.js";
import { LRUCache } from "lru-cache";
import BotClient from "../client/BotClient";
import { CleanDoc } from "../builder/MessageDoc";
import {
    DirectView,
    InfoView,
    ITicketView,
    IVaultItem,
    MessageView,
    OpenedView,
    OptionOf,
    PanelView,
    SupportRoleOf,
    TicketValues,
} from "../builder/TicketPanel";
import {
    ACTIONS,
    CONTACTS,
    CORE_ACTIONS,
    DELETE_AFTER_HOURS,
    DELETE_NOW,
    DELETE_NOW_DELAY,
    HOUR_MS,
    MAX_LIMIT,
    MAX_NOTE,
    MAX_OPTIONS,
    MESSAGE_KEYS,
    PANEL_STYLES,
    PRIORITIES,
    PRIORITY_LABELS,
    SLOWMODE_STEPS,
    SURFACES,
    TicketAction,
    TicketMessageKey,
    TicketNumber,
    TicketPriority,
} from "../constants/Tickets";
import { ITicket, ITicketConfig, ITicketOption } from "../interfaces/services/tickets/ITicket";
import { TicketPatch } from "../models/Tickets";
import logger from "../utils/logger";

/** Ein Grund, den der Nutzer lesen soll - kein Programmfehler. */
export class TicketError extends Error {
    /** Statt des Texts diese Nachricht des Servers zeigen (z. B. "blacklisted"). */
    readonly doc: TicketMessageKey | null;

    constructor(message: string, doc: TicketMessageKey | null = null) {
        super(message);
        this.doc = doc;
    }
}

export type TicketChannel = TextChannel | AnyThreadChannel;

export interface ITicketContext {
    ticket: ITicket;
    guild: Guild;
    config: ITicketConfig;
    option: ITicketOption | null;
    channel: TicketChannel | null;
}

interface IPending {
    content: string;
    files: { url: string; name: string; size: number }[];
}

const MEMBER_ALLOW: PermissionsString[] = ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles", "EmbedLinks"];
const BOT_ALLOW: PermissionsString[] = [...MEMBER_ALLOW, "ManageChannels", "ManageMessages", "ManageWebhooks"];

const WEBHOOK_NAME = "RL Nexus Tickets";
// Was ein Bot ohne Boost hochladen darf. Größere Anhänge gehen als Link weiter.
const MAX_RELAY_FILE = 10 * 1024 * 1024;
const MAX_NOTES = 50;
const YEAR_MS = 365 * 24 * HOUR_MS;

function IsRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function Slug(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/ß/g, "ss")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);

    return slug || "option";
}

function TagEmoji(emoji: string | null): GuildForumTagEmoji | null {
    if (!emoji) return null;

    const custom = /^<a?:\w{2,32}:(\d{17,20})>$/.exec(emoji);

    return custom ? { id: custom[1], name: null } : { id: null, name: emoji };
}

// Discord lehnt Webhook-Namen mit "discord" oder "clyde" ab.
function AliasOf(guild: Guild): string {
    const alias = `${guild.name} Team`.slice(0, 80);

    return /discord|clyde/i.test(alias) ? "Support-Team" : alias;
}

function Allowed(guild: Guild, wanted: PermissionsString[]): PermissionsString[] {
    // Ein Overwrite darf nichts erlauben, was der Bot selbst nicht hat - sonst
    // lehnt Discord den ganzen Kanal ab.
    const mine = guild.members.me?.permissions;

    return wanted.filter((permission) => mine?.has(permission));
}

function Grant(permissions: PermissionsString[]): Partial<Record<PermissionsString, boolean>> {
    return Object.fromEntries(permissions.map((permission) => [permission, true]));
}

/**
 * Das Ticket-System: öffnen, jede Aktion genau einmal, ModMail-Relay. Das
 * Dashboard, der Discord-Assistent und die Handler rufen alle hier auf.
 * Fehler, die ein Mensch lesen soll, kommen als TicketError.
 */
export default class TicketService {
    client: BotClient;

    // Kanäle offener Tickets. Jede Nachricht auf dem Server fragt erst hier,
    // bevor sie die Datenbank fragt.
    private channels = new Set<string>();
    private loading: Promise<void> | null = null;

    // Wer gerade ein Ticket öffnet - ein Doppelklick legt kein zweites an.
    private opening = new Set<string>();

    private lastRelay = new LRUCache<number, number>({ max: 1000, ttl: HOUR_MS });
    private hooks = new LRUCache<string, Webhook>({ max: 200, ttl: HOUR_MS });

    // Die erste DM eines Users ohne Ticket: sie geht ins Ticket, sobald es steht.
    private pending = new LRUCache<string, IPending>({ max: 500, ttl: 10 * 60_000 });

    constructor(client: BotClient) {
        this.client = client;
    }

    /* ----------------------------------------------------------
       Lesen
       ---------------------------------------------------------- */
    async Knows(channelId: string): Promise<boolean> {
        if (!this.loading && this.client.databaseService.Ready) {
            this.loading = this.client.tickets
                .OpenChannels()
                .then((ids) => {
                    for (const id of ids) this.channels.add(id);
                })
                .catch((error) => {
                    this.loading = null;
                    logger.warn(`🎫 Offene Ticket-Kanäle nicht ladbar: ${String(error)}`);
                });
        }

        await this.loading;

        return this.channels.has(channelId);
    }

    async Context(ticketId: number): Promise<ITicketContext> {
        const ticket = await this.client.tickets.Get(ticketId);

        if (!ticket) throw new TicketError("Dieses Ticket gibt es nicht mehr.");

        const guild = this.client.guilds.cache.get(ticket.guildId);

        if (!guild) throw new TicketError("Der Server dieses Tickets ist gerade nicht erreichbar.");

        const config = await this.client.ticketSettings.Of(guild.id);
        const fetched = ticket.channelId ? await this.client.channels.fetch(ticket.channelId).catch(() => null) : null;
        const channel =
            fetched && (fetched.type === ChannelType.GuildText || fetched.isThread()) ? (fetched as TicketChannel) : null;

        return { ticket, guild, config, option: OptionOf(config, ticket), channel };
    }

    /** Team heißt: die Support-Rolle, die für das Ticket gilt, oder "Server verwalten". */
    IsStaff(member: GuildMember, context: { config: ITicketConfig; option: ITicketOption | null }): boolean {
        if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;

        const role = SupportRoleOf(context.config, context.option);

        return role !== null && member.roles.cache.has(role);
    }

    /** Macht aus einem Discord-Fehler einen lesbaren Satz, wo es einen gibt. */
    Explain(error: unknown): Error {
        if (error instanceof TicketError) return error;

        if (error instanceof DiscordAPIError && (error.code === 50013 || error.code === 50001)) {
            return new TicketError(
                "Mir fehlen dafür Rechte auf dem Server – etwa „Kanäle verwalten“, „Rollen verwalten“ oder Zugriff auf den Kanal."
            );
        }

        return error instanceof Error ? error : new Error(String(error));
    }

    /* ----------------------------------------------------------
       Einstellungen
       ---------------------------------------------------------- */
    /**
     * Prüft eine Eingabe aus Dashboard oder Assistent gegen den Server. Felder,
     * die fehlen, behalten ihren bisherigen Wert - der Assistent schickt nur,
     * was sich geändert hat.
     */
    Clean(guild: Guild, input: unknown, previous: ITicketConfig): ITicketConfig {
        if (!IsRecord(input)) throw new TicketError("Das sind keine gültigen Einstellungen.");

        const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
            allowed.includes(value as T) ? (value as T) : fallback;

        const role = (value: unknown): string | null =>
            typeof value === "string" && value !== guild.id && guild.roles.cache.has(value) ? value : null;

        const channelOf = (value: unknown, type: ChannelType): string | null =>
            typeof value === "string" && guild.channels.cache.get(value)?.type === type ? value : null;

        let options = previous.options;

        if (Array.isArray(input.options)) {
            const seen = new Set<string>();

            options = [];

            for (const raw of input.options.slice(0, MAX_OPTIONS)) {
                if (!IsRecord(raw)) continue;

                const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";

                if (!name) throw new TicketError("Jede Öffnungs-Option braucht einen Namen.");

                let id = typeof raw.id === "string" && /^[a-z0-9-]{1,32}$/.test(raw.id) ? raw.id : Slug(name);

                for (let suffix = 2; seen.has(id); suffix++) id = `${id.slice(0, 29)}-${suffix}`;

                seen.add(id);

                options.push({
                    id,
                    name,
                    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 100) : "",
                    emoji: this.CleanEmoji(raw.emoji),
                    categoryId: channelOf(raw.categoryId, ChannelType.GuildCategory),
                    tagId: previous.options.find((option) => option.id === id)?.tagId ?? null,
                    supportRoleId: role(raw.supportRoleId),
                    opened: raw.opened ? CleanDoc(raw.opened, guild.id) : null,
                });
            }
        }

        const messages = { ...previous.messages };

        if (IsRecord(input.messages)) {
            for (const key of MESSAGE_KEYS) {
                const doc = CleanDoc(input.messages[key], guild.id);

                if (doc) messages[key] = doc;
            }
        }

        const actions = Array.isArray(input.actions)
            ? [
                  ...new Set(
                      input.actions.filter(
                          (action): action is TicketAction =>
                              ACTIONS.includes(action as TicketAction) && !CORE_ACTIONS.includes(action as TicketAction)
                      )
                  ),
              ]
            : previous.actions;

        const limit = Number(input.limit);
        const deleteAfter = Number(input.deleteAfter);

        return {
            contact: pick(input.contact, CONTACTS, previous.contact),
            surface: pick(input.surface, SURFACES, previous.surface),
            style: pick(input.style, PANEL_STYLES, previous.style),
            supportRoleId: input.supportRoleId === undefined ? previous.supportRoleId : role(input.supportRoleId),
            forumId: input.forumId === undefined ? previous.forumId : channelOf(input.forumId, ChannelType.GuildForum),
            limit: Number.isInteger(limit) && limit >= 0 && limit <= MAX_LIMIT ? limit : previous.limit,
            deleteAfter: (DELETE_AFTER_HOURS as readonly number[]).includes(deleteAfter) ? deleteAfter : previous.deleteAfter,
            actions,
            options,
            messages,
            tags: previous.tags,
            panel: previous.panel,
        };
    }

    /** Unicode-Emoji oder ein Server-Emoji, das der Bot auch benutzen kann. */
    CleanEmoji(value: unknown): string | null {
        if (typeof value !== "string") return null;

        const text = value.trim();
        const custom = /^<a?:\w{2,32}:(\d{17,20})>$/.exec(text);

        if (custom) return this.client.emojis.cache.has(custom[1]) ? text : null;

        const unicode = text.length > 0 && text.length <= 16 && !/[\s<>:\w]/.test(text.replace(/[0-9#*]️?⃣/g, ""));

        return unicode && /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(text) ? text : null;
    }

    async Save(guild: Guild, input: unknown): Promise<ITicketConfig> {
        const previous = await this.client.ticketSettings.Of(guild.id);
        const config = this.Clean(guild, input, previous);

        if (config.surface === "forum" && config.forumId) await this.SyncTags(guild, config);

        await this.client.ticketSettings.Save(guild.id, config);

        // Ein schon gesendetes Panel zeigt sofort den neuen Stand - etwa den
        // DM-Hinweis, sobald ModMail an ist. Die Antwort wartet nicht darauf.
        void this.RefreshPanel(guild, config);

        return config;
    }

    /** Zieht ein gesendetes Panel auf den gespeicherten Stand nach. Ohne Panel passiert nichts. */
    private async RefreshPanel(guild: Guild, config: ITicketConfig): Promise<void> {
        const { channelId, messageId } = config.panel;

        if (!channelId || !messageId || config.options.length === 0) return;

        const channel = guild.channels.cache.get(channelId);

        if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return;

        const message = await channel.messages.fetch(messageId).catch(() => null);

        if (!message) return;

        try {
            const view = await PanelView(this.client, guild, config);

            await message.edit({ ...view, attachments: [], allowedMentions: { parse: [] } });
        } catch (error) {
            logger.warn(`🎫 Panel auf ${guild.id} nicht nachgezogen: ${String(error)}`);
        }
    }

    /**
     * Legt die Tags an, die der Bot im Forum braucht: je Option einer, dazu drei
     * Prioritäten, "Beansprucht" und "Geschlossen". Vorhandene Tags des Servers
     * bleiben stehen; die eigenen findet er über ihre ID wieder, sonst am Namen.
     */
    private async SyncTags(guild: Guild, config: ITicketConfig): Promise<void> {
        const forum = guild.channels.cache.get(config.forumId ?? "");

        if (!forum || forum.type !== ChannelType.GuildForum) return;

        const wanted = [
            ...config.options.map((option) => ({ name: option.name, emoji: option.emoji, id: option.tagId })),
            ...PRIORITIES.map((priority) => ({
                name: PRIORITY_LABELS[priority].name,
                emoji: PRIORITY_LABELS[priority].emoji,
                id: config.tags[priority],
            })),
            { name: "Beansprucht", emoji: "✅", id: config.tags.claimed },
            { name: "Geschlossen", emoji: "🔒", id: config.tags.closed },
        ];

        const tags: GuildForumTagData[] = forum.availableTags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            moderated: tag.moderated,
            emoji: tag.emoji,
        }));

        let changed = false;

        for (const entry of wanted) {
            const name = entry.name.slice(0, 20);
            const emoji = TagEmoji(entry.emoji);
            const found = tags.find((tag) => entry.id && tag.id === entry.id) ?? tags.find((tag) => tag.name === name);

            if (!found) {
                tags.push({ name, emoji, moderated: false });
                changed = true;
            } else if (found.name !== name || found.emoji?.id !== emoji?.id || found.emoji?.name !== emoji?.name) {
                found.name = name;
                found.emoji = emoji;
                changed = true;
            }
        }

        if (tags.length > 20) {
            throw new TicketError(
                `Das Forum bräuchte ${tags.length} Tags, Discord erlaubt 20. Entferne Öffnungs-Optionen oder alte Tags im Forum.`
            );
        }

        const updated = changed
            ? await (forum as ForumChannel).setAvailableTags(tags).catch((error) => {
                  throw this.Explain(error);
              })
            : (forum as ForumChannel);

        const idOf = (name: string): string | null =>
            updated.availableTags.find((tag) => tag.name === name.slice(0, 20))?.id ?? null;

        for (const option of config.options) option.tagId = idOf(option.name);
        for (const priority of PRIORITIES) config.tags[priority] = idOf(PRIORITY_LABELS[priority].name);

        config.tags.claimed = idOf("Beansprucht");
        config.tags.closed = idOf("Geschlossen");
    }

    /** Schickt das Panel - oder zieht es nach, wenn es in diesem Kanal schon steht. */
    async SendPanel(guild: Guild, channelId: string): Promise<string> {
        const config = await this.client.ticketSettings.Of(guild.id);

        if (config.options.length === 0) throw new TicketError("Lege zuerst mindestens eine Öffnungs-Option an.");

        const channel = guild.channels.cache.get(channelId);

        if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
            throw new TicketError("Das Panel braucht einen Textkanal.");
        }

        const view = await PanelView(this.client, guild, config);
        const payload = { ...view, flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };

        let message: Message | null = null;

        if (config.panel.channelId === channelId && config.panel.messageId) {
            const old = await channel.messages.fetch(config.panel.messageId).catch(() => null);

            if (old) message = await old.edit({ ...view, attachments: [], allowedMentions: { parse: [] } }).catch(() => null);
        }

        message ??= await channel.send(payload).catch((error) => {
            throw this.Explain(error);
        });

        config.panel = { channelId, messageId: message.id };
        await this.client.ticketSettings.Save(guild.id, config);

        logger.user(`🎫 Ticket-Panel auf ${guild.id} in ${channelId} gesendet`);

        return message.url;
    }

    /* ----------------------------------------------------------
       Öffnen
       ---------------------------------------------------------- */
    async Open(guild: Guild, user: User, optionId: string): Promise<ITicket> {
        const lock = `${guild.id}:${user.id}`;

        if (this.opening.has(lock)) throw new TicketError("Dein Ticket wird gerade schon angelegt.");

        this.opening.add(lock);

        try {
            return await this.Create(guild, user, optionId);
        } finally {
            this.opening.delete(lock);
        }
    }

    private async Create(guild: Guild, user: User, optionId: string): Promise<ITicket> {
        if (!this.client.databaseService.Ready) throw new TicketError("Der Bot erreicht gerade seine Datenbank nicht.");

        if (!(await this.client.settings.Of(guild.id)).modules.includes("tickets")) {
            throw new TicketError("Das Ticket-System ist auf diesem Server ausgeschaltet.");
        }

        const config = await this.client.ticketSettings.Of(guild.id);
        const option = config.options.find((entry) => entry.id === optionId);

        if (!option) throw new TicketError("Diese Option gibt es nicht mehr – das Panel ist wohl veraltet.");

        if (await this.client.ticketBlacklist.Has(guild.id, user.id)) {
            throw new TicketError("Du bist für Tickets auf diesem Server gesperrt.", "blacklisted");
        }

        const open = await this.client.tickets.OpenOf(guild.id, user.id);
        const same = open.find((ticket) => ticket.optionId === option.id);

        if (same) {
            throw new TicketError(
                same.contact === "modmail"
                    ? "Du hast dazu schon ein offenes Ticket – schreib mir einfach per DM."
                    : `Du hast dazu schon ein offenes Ticket: <#${same.channelId}>`
            );
        }

        if (config.limit > 0 && open.length >= config.limit) {
            throw new TicketError(`Du hast schon ${open.length} offene(s) Ticket(s) – schließe zuerst eins.`);
        }

        if (config.contact === "modmail") {
            const other = await this.client.tickets.OpenModMail(user.id);

            if (other) {
                const where = this.client.guilds.cache.get(other.guildId)?.name ?? "einem anderen Server";

                throw new TicketError(`Du hast schon ein offenes ModMail-Ticket auf **${where}** – schreib dort per DM weiter.`);
            }
        }

        const forum = config.surface === "forum" ? guild.channels.cache.get(config.forumId ?? "") : null;

        if (config.surface === "forum" && forum?.type !== ChannelType.GuildForum) {
            throw new TicketError("Das Ticket-System ist noch nicht fertig eingerichtet: Es ist kein Forum gewählt.");
        }

        let ticket = await this.client.tickets.Create(guild.id, option.id, user.id, config.contact);
        let channel: TicketChannel | null = null;
        let sentDirect = false;

        try {
            if (config.contact === "modmail") {
                const direct = await DirectView(this.client, guild, config, ticket, user);

                await user.send({ ...direct, flags: MessageFlags.IsComponentsV2 }).catch(() => {
                    throw new TicketError(
                        "Ich kann dir keine DM schicken. Erlaube in den Datenschutz-Einstellungen des Servers Direktnachrichten und versuch es nochmal."
                    );
                });

                sentDirect = true;
            }

            if (forum) {
                channel = await (forum as ForumChannel).threads.create({
                    name: this.ThreadName(ticket, option, user),
                    message: {
                        content: `🎫 **${TicketNumber(ticket.number)}** · ${escapeMarkdown(option.name)} · <@${user.id}>`,
                        allowedMentions: { parse: [] },
                    },
                    appliedTags: option.tagId ? [option.tagId] : [],
                });

                if (config.contact === "direct") await channel.members.add(user.id);
            } else {
                channel = await guild.channels.create({
                    name: this.ChannelName(ticket, option),
                    type: ChannelType.GuildText,
                    parent: option.categoryId ?? undefined,
                    permissionOverwrites: this.Overwrites(guild, config, option, ticket),
                });
            }

            const role = SupportRoleOf(config, option);
            const opened = await OpenedView(this.client, guild, config, ticket, user);
            const message = await channel.send({
                ...opened,
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { users: config.contact === "direct" ? [user.id] : [], roles: role ? [role] : [] },
            });

            await this.client.tickets.Patch(ticket.id, { channelId: channel.id, messageId: message.id });

            this.channels.add(channel.id);
            ticket = (await this.client.tickets.Get(ticket.id))!;

            logger.user(`🎫 Ticket ${TicketNumber(ticket.number)} auf ${guild.id} geöffnet (${option.id}, von ${user.id})`);

            return ticket;
        } catch (error) {
            await this.client.tickets.Delete(ticket.id).catch(() => undefined);

            if (channel) await channel.delete().catch(() => undefined);

            if (sentDirect) {
                await user
                    .send({ content: "⚠️ Das Ticket ließ sich auf dem Server doch nicht anlegen – versuch es gleich nochmal." })
                    .catch(() => undefined);
            }

            throw this.Explain(error);
        }
    }

    private Overwrites(guild: Guild, config: ITicketConfig, option: ITicketOption, ticket: ITicket): OverwriteResolvable[] {
        const role = SupportRoleOf(config, option);
        const member = Allowed(guild, MEMBER_ALLOW);

        return [
            { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
            { id: this.client.user!.id, type: OverwriteType.Member, allow: Allowed(guild, BOT_ALLOW) },
            ...(ticket.contact === "direct" ? [{ id: ticket.openerId, type: OverwriteType.Member, allow: member }] : []),
            ...(role ? [{ id: role, type: OverwriteType.Role, allow: member }] : []),
        ];
    }

    private ChannelName(ticket: ITicket, option: ITicketOption | null): string {
        const base = `${option?.id ?? ticket.optionId}-${String(ticket.number).padStart(4, "0")}`;

        if (ticket.status === "closed") return `closed-${base}`;

        return ticket.priority ? `${PRIORITY_LABELS[ticket.priority].emoji}-${base}` : base;
    }

    private ThreadName(ticket: ITicket, option: ITicketOption, user: User): string {
        return `${TicketNumber(ticket.number)} · ${option.name} · ${user.username}`.slice(0, 100);
    }

    /* ----------------------------------------------------------
       Kleine Helfer der Aktionen
       ---------------------------------------------------------- */
    private RequireStaff(context: ITicketContext, member: GuildMember): void {
        if (!this.IsStaff(member, context)) throw new TicketError("Das darf nur das Team.");
    }

    private RequireOpen(context: ITicketContext): void {
        if (context.ticket.status === "closed") throw new TicketError("Das Ticket ist schon geschlossen.");
    }

    private RequireChannel(context: ITicketContext): TicketChannel {
        if (!context.channel) throw new TicketError("Der Kanal dieses Tickets ist nicht mehr da.");

        return context.channel;
    }

    private async Update(context: ITicketContext, patch: TicketPatch): Promise<void> {
        await this.client.tickets.Patch(context.ticket.id, patch);

        context.ticket = (await this.client.tickets.Get(context.ticket.id)) ?? context.ticket;
    }

    private async Say(context: ITicketContext, text: string, accent?: string): Promise<void> {
        await context.channel
            ?.send({ ...InfoView(text, accent), flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } })
            .catch(() => undefined);
    }

    private async SendDirect(user: User, view: ITicketView): Promise<boolean> {
        return user
            .send({ ...view, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } })
            .then(() => true)
            .catch(() => false);
    }

    /** Status und Menü der Eröffnungs-Nachricht auf den Stand des Tickets bringen. */
    async Refresh(context: ITicketContext): Promise<void> {
        if (!context.channel || !context.ticket.messageId) return;

        const message = await context.channel.messages.fetch(context.ticket.messageId).catch(() => null);
        const opener = await this.client.users.fetch(context.ticket.openerId).catch(() => null);

        if (!message || !opener) return;

        const view = await OpenedView(this.client, context.guild, context.config, context.ticket, opener);

        await message
            .edit({ ...view, attachments: [], allowedMentions: { parse: [] } })
            .catch((error) => logger.warn(`🎫 Ticket-Nachricht ${message.id} nicht aktualisierbar: ${String(error)}`));
    }

    /**
     * Forum-Tags aus dem Zustand neu berechnen statt sie einzeln zu schalten -
     * so können sie nie auseinanderlaufen. Ohne await: Discord bremst
     * Kanal-Änderungen stark, das Menü soll nicht darauf warten.
     */
    private SyncThread(context: ITicketContext): Promise<void> {
        const channel = context.channel;

        if (!channel?.isThread() || channel.archived) return Promise.resolve();

        const { ticket, config } = context;
        const tags = [
            context.option?.tagId,
            ticket.priority ? config.tags[ticket.priority] : null,
            ticket.claimedBy ? config.tags.claimed : null,
            ticket.status === "closed" ? config.tags.closed : null,
        ].filter((tag): tag is string => Boolean(tag) && channel.parent?.type === ChannelType.GuildForum);

        return channel
            .setAppliedTags(tags)
            .then(() => undefined)
            .catch((error) => logger.warn(`🎫 Tags nicht setzbar: ${String(error)}`));
    }

    // ponytail: Discord erlaubt zwei Umbenennungen je Kanal in zehn Minuten.
    // discord.js hält eine dritte zurück, bis es wieder geht - deshalb ohne
    // await, und nur für Priorität, Verschieben und Schließen.
    private Rename(context: ITicketContext): void {
        const channel = context.channel;

        if (!channel || channel.isThread()) return;

        const name = this.ChannelName(context.ticket, context.option);

        if (channel.name !== name) void channel.setName(name).catch((error) => logger.warn(`🎫 Umbenennen: ${String(error)}`));
    }

    /* ----------------------------------------------------------
       Die Aktionen
       ---------------------------------------------------------- */
    async Claim(context: ITicketContext, member: GuildMember): Promise<void> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        const { claimedBy } = context.ticket;

        if (claimedBy) {
            throw new TicketError(
                claimedBy === member.id ? "Du bearbeitest das Ticket schon." : `<@${claimedBy}> bearbeitet das Ticket schon.`
            );
        }

        await this.Update(context, { claimedBy: member.id });
        await this.Say(context, `✅ ${member} übernimmt das Ticket.`, "#35e07f");

        void this.SyncThread(context);
        await this.Refresh(context);
    }

    async Unclaim(context: ITicketContext, member: GuildMember): Promise<void> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        const { claimedBy } = context.ticket;

        if (!claimedBy) throw new TicketError("Das Ticket hat gerade niemand übernommen.");

        if (claimedBy !== member.id && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            throw new TicketError(`Zurückgeben können nur <@${claimedBy}> und Admins.`);
        }

        await this.Update(context, { claimedBy: null });
        await this.Say(context, `↩️ ${member} gibt das Ticket zurück – es wartet wieder auf das Team.`);

        void this.SyncThread(context);
        await this.Refresh(context);
    }

    async AddUser(context: ITicketContext, member: GuildMember, user: User): Promise<void> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        if (user.bot) throw new TicketError("Bots lassen sich nicht hinzufügen.");

        if (user.id === context.ticket.openerId || context.ticket.members.includes(user.id)) {
            throw new TicketError(`${user} ist schon im Ticket.`);
        }

        const channel = this.RequireChannel(context);

        try {
            if (channel.isThread()) await channel.members.add(user.id);
            else await channel.permissionOverwrites.edit(user.id, Grant(Allowed(context.guild, MEMBER_ALLOW)));
        } catch (error) {
            throw this.Explain(error);
        }

        await this.Update(context, { members: [...context.ticket.members, user.id] });
        await this.Say(context, `➕ ${member} hat ${user} zum Ticket hinzugefügt.`);
    }

    async RemoveUser(context: ITicketContext, member: GuildMember, user: User): Promise<void> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        if (user.id === context.ticket.openerId) {
            throw new TicketError("Den Ersteller kannst du nicht entfernen – schließ das Ticket stattdessen.");
        }

        if (!context.ticket.members.includes(user.id)) throw new TicketError(`${user} ist nicht im Ticket.`);

        const channel = this.RequireChannel(context);

        try {
            if (channel.isThread()) await channel.members.remove(user.id);
            else await channel.permissionOverwrites.delete(user.id);
        } catch (error) {
            throw this.Explain(error);
        }

        await this.Update(context, { members: context.ticket.members.filter((id) => id !== user.id) });
        await this.Say(context, `➖ ${member} hat ${user} aus dem Ticket entfernt.`);
    }

    async Transfer(context: ITicketContext, member: GuildMember, optionId: string): Promise<void> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        const target = context.config.options.find((option) => option.id === optionId);

        if (!target) throw new TicketError("Diese Option gibt es nicht mehr.");
        if (target.id === context.ticket.optionId) throw new TicketError("Das Ticket liegt schon dort.");

        const channel = this.RequireChannel(context);

        if (!channel.isThread()) {
            const before = SupportRoleOf(context.config, context.option);
            const after = SupportRoleOf(context.config, target);

            try {
                await channel.setParent(target.categoryId, { lockPermissions: false });

                if (before && before !== after) await channel.permissionOverwrites.delete(before);
                if (after) await channel.permissionOverwrites.edit(after, Grant(Allowed(context.guild, MEMBER_ALLOW)));
            } catch (error) {
                throw this.Explain(error);
            }
        }

        await this.Update(context, { optionId: target.id });

        context.option = target;

        await this.Say(context, `🔁 ${member} hat das Ticket nach **${escapeMarkdown(target.name)}** verschoben.`);

        void this.SyncThread(context);
        this.Rename(context);
        await this.Refresh(context);
    }

    async SetPriority(context: ITicketContext, member: GuildMember, priority: TicketPriority): Promise<void> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        const label = PRIORITY_LABELS[priority];

        await this.Update(context, { priority });
        await this.Say(context, `⚡ ${member} setzt die Priorität auf ${label.emoji} **${label.name}**.`);

        void this.SyncThread(context);
        this.Rename(context);
        await this.Refresh(context);
    }

    /** Gibt zurück, ob der Alias jetzt an ist. */
    async ToggleAnonymous(context: ITicketContext, member: GuildMember): Promise<boolean> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        const on = !context.ticket.anonymous.includes(member.id);

        // Bei ModMail tauscht das Relay nur den Namen. Im Ticket selbst braucht
        // es einen Webhook und das Löschen der eigenen Nachricht.
        if (on && context.ticket.contact === "direct") {
            const channel = this.RequireChannel(context);
            const me = context.guild.members.me;
            const scope = channel.isThread() ? channel.parent : channel;

            if (!me || !scope?.permissionsFor(me)?.has(["ManageWebhooks", "ManageMessages"])) {
                throw new TicketError("Für den anonymen Modus brauche ich „Webhooks verwalten“ und „Nachrichten verwalten“.");
            }
        }

        await this.Update(context, {
            anonymous: on ? [...context.ticket.anonymous, member.id] : context.ticket.anonymous.filter((id) => id !== member.id),
        });

        return on;
    }

    async Vault(context: ITicketContext, member: GuildMember): Promise<IVaultItem[]> {
        this.RequireStaff(context, member);

        const channel = this.RequireChannel(context);
        const items: IVaultItem[] = [];
        let before: string | undefined;

        // ponytail: höchstens 500 Nachrichten zurück - reicht für Tickets, ein
        // Archiv über Jahre gehört zu den Transcripts.
        for (let page = 0; page < 5; page++) {
            const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);

            if (!batch) break;

            for (const message of batch.values()) {
                for (const attachment of message.attachments.values()) {
                    items.push({
                        url: attachment.url,
                        name: attachment.name,
                        image: (attachment.contentType ?? "").startsWith("image/"),
                    });
                }
            }

            if (batch.size < 100) break;

            before = batch.last()?.id;
        }

        return items;
    }

    async SetSlowmode(context: ITicketContext, member: GuildMember, seconds: number): Promise<void> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        if (!(SLOWMODE_STEPS as readonly number[]).includes(seconds)) throw new TicketError("Diese Stufe gibt es nicht.");

        // Bei ModMail schreibt der User per DM - dort bremst das Relay statt Discord.
        if (context.ticket.contact === "direct") {
            await this.RequireChannel(context)
                .setRateLimitPerUser(seconds)
                .catch((error) => {
                    throw this.Explain(error);
                });
        }

        await this.Update(context, { slowmode: seconds });
        await this.Say(
            context,
            seconds === 0 ? `⏱️ ${member} hat den Slowmode ausgeschaltet.` : `⏱️ ${member} hat den Slowmode auf **${SlowmodeLabel(seconds)}** gesetzt.`
        );
    }

    async AddNote(context: ITicketContext, member: GuildMember, text: string): Promise<void> {
        this.RequireStaff(context, member);

        const note = text.trim().slice(0, MAX_NOTE);

        if (!note) throw new TicketError("Die Notiz ist leer.");

        await this.Update(context, {
            notes: [...context.ticket.notes, { by: member.id, at: Date.now(), text: note }].slice(-MAX_NOTES),
        });
    }

    /** Gibt zurück, ob das Ticket jetzt eingefroren ist. */
    async ToggleFreeze(context: ITicketContext, member: GuildMember): Promise<boolean> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        const frozen = context.ticket.status !== "frozen";
        const channel = this.RequireChannel(context);

        if (context.ticket.contact === "direct") {
            try {
                if (channel.isThread()) await channel.setLocked(frozen);
                else await channel.permissionOverwrites.edit(context.ticket.openerId, { SendMessages: !frozen });
            } catch (error) {
                throw this.Explain(error);
            }
        }

        await this.Update(context, { status: frozen ? "frozen" : "open" });

        if (frozen) {
            const opener = await this.client.users.fetch(context.ticket.openerId).catch(() => null);

            if (opener) {
                const direct = context.ticket.contact === "direct";
                const values = TicketValues(context.guild, context.config, {
                    user: opener,
                    ticket: context.ticket,
                    mentions: direct,
                });
                const view = await MessageView(this.client, context.guild, context.config, "frozen", values);

                if (direct) await channel.send({ ...view, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
                else await this.SendDirect(opener, view);
            }
        }

        await this.Say(context, frozen ? `🥶 ${member} hat das Ticket eingefroren.` : `🔓 ${member} hat das Ticket wieder freigegeben.`);
        await this.Refresh(context);

        return frozen;
    }

    async Blacklist(context: ITicketContext, member: GuildMember, reason: string): Promise<void> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        const target = await context.guild.members.fetch(context.ticket.openerId).catch(() => null);

        if (target && this.IsStaff(target, context)) throw new TicketError("Teammitglieder lassen sich nicht sperren.");

        await this.client.ticketBlacklist.Add(context.guild.id, context.ticket.openerId, reason || null, member.id);

        if (context.ticket.contact === "modmail") {
            const opener = await this.client.users.fetch(context.ticket.openerId).catch(() => null);

            if (opener) {
                const values = TicketValues(context.guild, context.config, { user: opener, mentions: false });

                await this.SendDirect(opener, await MessageView(this.client, context.guild, context.config, "blacklisted", values));
            }
        }

        logger.user(`🚫 ${context.ticket.openerId} auf ${context.guild.id} für Tickets gesperrt (von ${member.id})`);

        await this.Close(context, member, `Gesperrt${reason ? `: ${reason}` : ""}`);
    }

    async Schedule(context: ITicketContext, member: GuildMember, at: number, note: string): Promise<void> {
        this.RequireStaff(context, member);
        this.RequireOpen(context);

        if (at <= Date.now()) throw new TicketError("Der Termin liegt in der Vergangenheit.");
        if (at > Date.now() + YEAR_MS) throw new TicketError("Termine gehen höchstens ein Jahr im Voraus.");

        const stamp = `<t:${Math.floor(at / 1000)}:F> (<t:${Math.floor(at / 1000)}:R>)`;
        const extra = note.trim() ? `\n> ${note.trim().slice(0, 300)}` : "";

        await this.Update(context, { reminderAt: at });
        await this.Say(context, `📅 ${member} hat einen Termin angesetzt: ${stamp}${extra}`, "#ffc53d");

        if (context.ticket.contact === "modmail") {
            const opener = await this.client.users.fetch(context.ticket.openerId).catch(() => null);

            if (opener) {
                await this.SendDirect(
                    opener,
                    InfoView(`📅 Termin zu deinem Ticket ${TicketNumber(context.ticket.number)} auf **${escapeMarkdown(context.guild.name)}**: ${stamp}${extra}`, "#ffc53d")
                );
            }
        }

        await this.Refresh(context);
    }

    /** actor ist ein Mitglied (Menü im Ticket) oder der User selbst (Knopf in der DM). */
    async Close(context: ITicketContext, actor: GuildMember | User, reason: string | null): Promise<void> {
        this.RequireOpen(context);

        const { ticket, config, guild } = context;
        const staff = actor instanceof GuildMember && this.IsStaff(actor, context);

        if (actor.id !== ticket.openerId && !staff) throw new TicketError("Schließen dürfen nur der Ersteller und das Team.");

        const now = config.deleteAfter === DELETE_NOW;

        // Auch "sofort" steht als Zeitpunkt in der Datenbank: stirbt der Bot in
        // den paar Sekunden, räumt der minütliche Lauf den Kanal trotzdem weg.
        await this.Update(context, {
            status: "closed",
            closedAt: new Date(),
            reminderAt: null,
            deleteAt: now
                ? Date.now() + DELETE_NOW_DELAY
                : config.deleteAfter > 0
                  ? Date.now() + config.deleteAfter * HOUR_MS
                  : null,
        });

        const opener = await this.client.users.fetch(ticket.openerId).catch(() => null);
        const why = reason?.trim() || "Kein Grund angegeben";
        const channel = context.channel;

        if (channel) {
            this.channels.delete(channel.id);

            const values = TicketValues(guild, config, { user: opener ?? undefined, ticket: context.ticket, closer: `<@${actor.id}>`, reason: why });
            const view = await MessageView(this.client, guild, config, "closed", values);

            await channel.send({ ...view, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => undefined);
            await this.Refresh(context);

            if (channel.isThread()) {
                await this.SyncThread(context);
                await channel.setLocked(true).catch(() => undefined);
                await channel.setArchived(true).catch(() => undefined);
            } else {
                if (ticket.contact === "direct") {
                    for (const id of [ticket.openerId, ...ticket.members]) {
                        await channel.permissionOverwrites.delete(id).catch(() => undefined);
                    }
                }

                this.Rename(context);
            }
        }

        if (ticket.contact === "modmail" && opener) {
            const name = actor instanceof GuildMember ? actor.displayName : actor.displayName;
            const values = TicketValues(guild, config, { user: opener, ticket: context.ticket, closer: name, reason: why, mentions: false });

            await this.SendDirect(opener, await MessageView(this.client, guild, config, "closed", values));
        }

        if (now) {
            setTimeout(() => {
                void this.client.tickets
                    .Get(ticket.id)
                    .then((fresh) => (fresh?.deleteAt ? this.Remove(fresh) : undefined))
                    .catch((error) => logger.warn(`🎫 Sofort-Löschen von ${ticket.id}: ${String(error)}`));
            }, DELETE_NOW_DELAY);
        }

        logger.user(`🔒 Ticket ${TicketNumber(ticket.number)} auf ${guild.id} geschlossen (von ${actor.id})`);
    }

    /** Löscht den Kanal eines geschlossenen Tickets und trägt die Frist aus. */
    private async Remove(ticket: ITicket): Promise<void> {
        await this.client.tickets.Patch(ticket.id, { deleteAt: null });

        const channel = ticket.channelId ? await this.client.channels.fetch(ticket.channelId).catch(() => null) : null;

        if (channel && (channel.type === ChannelType.GuildText || channel.isThread())) {
            await channel.delete("Löschfrist nach dem Schließen abgelaufen").catch(() => undefined);
        }
    }

    /* ----------------------------------------------------------
       Nachrichten: ModMail-Relay, Alias, Zählen
       ---------------------------------------------------------- */
    /** Eine Nachricht in einem Ticket-Kanal (kein Bot, kein Webhook). */
    async OnTicketMessage(message: Message): Promise<void> {
        const ticket = await this.client.tickets.ByChannel(message.channelId);

        if (!ticket || ticket.status === "closed") return;

        void this.client.tickets.CountMessage(ticket.id).catch(() => undefined);

        if (ticket.contact === "modmail") return this.RelayToUser(message, ticket);
        if (ticket.anonymous.includes(message.author.id)) return this.RepostAnonymous(message);
    }

    /** Eine DM an den Bot. false heißt: kein offenes Ticket - der Aufrufer bietet eins an. */
    async OnDirectMessage(message: Message): Promise<boolean> {
        const ticket = await this.client.tickets.OpenModMail(message.author.id);

        if (!ticket) {
            this.pending.set(message.author.id, {
                content: message.content,
                files: message.attachments.map((attachment) => ({ url: attachment.url, name: attachment.name, size: attachment.size })),
            });

            return false;
        }

        await this.RelayToTeam(message.author, ticket, {
            content: message.content,
            files: message.attachments.map((attachment) => ({ url: attachment.url, name: attachment.name, size: attachment.size })),
        }, message);

        return true;
    }

    /** Die gemerkte erste DM ins frisch geöffnete Ticket. */
    async FlushPending(user: User, ticket: ITicket): Promise<void> {
        const first = this.pending.get(user.id);

        this.pending.delete(user.id);

        if (first && (first.content || first.files.length > 0)) await this.RelayToTeam(user, ticket, first, null);
    }

    /** Server, auf denen der User ein ModMail-Ticket öffnen kann. */
    async ModMailGuildsFor(user: User): Promise<Guild[]> {
        const found: Guild[] = [];

        for (const id of await this.client.ticketSettings.ModMailGuilds()) {
            const guild = this.client.guilds.cache.get(id);

            if (!guild) continue;
            if (!(await this.client.settings.Of(id)).modules.includes("tickets")) continue;
            if (!(await guild.members.fetch(user.id).catch(() => null))) continue;

            found.push(guild);

            if (found.length >= 25) break;
        }

        return found;
    }

    private Files(pending: IPending): { files: { attachment: string; name: string }[]; links: string } {
        const small = pending.files.filter((file) => file.size <= MAX_RELAY_FILE);
        const large = pending.files.filter((file) => file.size > MAX_RELAY_FILE);

        return {
            files: small.map((file) => ({ attachment: file.url, name: file.name })),
            links: large.map((file) => `\n📎 ${file.url}`).join(""),
        };
    }

    private async RelayToTeam(user: User, ticket: ITicket, pending: IPending, original: Message | null): Promise<void> {
        if (ticket.status === "frozen") {
            await original?.reply("❄️ Dein Ticket ist gerade eingefroren – das Team meldet sich bei dir.").catch(() => undefined);
            return;
        }

        if (ticket.slowmode > 0 && original) {
            const wait = (this.lastRelay.get(ticket.id) ?? 0) + ticket.slowmode * 1000 - Date.now();

            if (wait > 0) {
                await original.reply(`⏱️ Slowmode: warte noch ${Math.ceil(wait / 1000)} Sekunden.`).catch(() => undefined);
                return;
            }
        }

        this.lastRelay.set(ticket.id, Date.now());

        const channel = ticket.channelId ? await this.client.channels.fetch(ticket.channelId).catch(() => null) : null;

        if (!channel || !(channel.type === ChannelType.GuildText || channel.isThread())) {
            await original?.reply("⚠️ Dein Ticket ist auf dem Server nicht mehr erreichbar.").catch(() => undefined);
            return;
        }

        const { files, links } = this.Files(pending);

        try {
            await (channel as TicketChannel).send({
                content: `**${escapeMarkdown(user.displayName)}:** ${pending.content}${links}`.slice(0, 2000),
                files,
                allowedMentions: { parse: [] },
            });

            await original?.react("✅").catch(() => undefined);
            void this.client.tickets.CountMessage(ticket.id).catch(() => undefined);
        } catch {
            await original?.reply("⚠️ Deine Nachricht kam nicht an – versuch es gleich nochmal.").catch(() => undefined);
        }
    }

    private async RelayToUser(message: Message, ticket: ITicket): Promise<void> {
        const opener = await this.client.users.fetch(ticket.openerId).catch(() => null);

        if (!opener || !message.guild) return;

        const name = ticket.anonymous.includes(message.author.id)
            ? AliasOf(message.guild)
            : message.member?.displayName ?? message.author.displayName;

        const { files, links } = this.Files({
            content: message.content,
            files: message.attachments.map((attachment) => ({ url: attachment.url, name: attachment.name, size: attachment.size })),
        });

        try {
            await opener.send({
                content: `**${escapeMarkdown(name)}:** ${message.content}${links}`.slice(0, 2000),
                files,
                allowedMentions: { parse: [] },
            });

            await message.react("✅").catch(() => undefined);
        } catch {
            await message
                .reply({ content: "⚠️ Kam beim User nicht an – er hat DMs vermutlich geschlossen.", allowedMentions: { parse: [] } })
                .catch(() => undefined);
        }
    }

    private async RepostAnonymous(message: Message): Promise<void> {
        const channel = message.channel;

        if (!message.guild || !(channel.type === ChannelType.GuildText || channel.isThread())) return;

        const scope = channel.isThread() ? channel.parent : channel;

        if (!scope || !(scope.type === ChannelType.GuildText || scope.type === ChannelType.GuildForum)) return;

        const hook = await this.Webhook(scope);

        if (!hook) return;

        const { files, links } = this.Files({
            content: message.content,
            files: message.attachments.map((attachment) => ({ url: attachment.url, name: attachment.name, size: attachment.size })),
        });

        try {
            await hook.send({
                username: AliasOf(message.guild),
                avatarURL: message.guild.iconURL({ extension: "png", size: 256 }) ?? undefined,
                content: `${message.content}${links}`.slice(0, 2000) || undefined,
                files,
                threadId: channel.isThread() ? channel.id : undefined,
                allowedMentions: { parse: [] },
            });

            await message.delete().catch(() => undefined);
        } catch (error) {
            this.hooks.delete(scope.id);
            logger.warn(`🎫 Anonyme Nachricht nicht gesendet: ${String(error)}`);
        }
    }

    private async Webhook(channel: TextChannel | ForumChannel): Promise<Webhook | null> {
        const known = this.hooks.get(channel.id);

        if (known) return known;

        try {
            const hooks = await channel.fetchWebhooks();
            const hook =
                hooks.find((entry) => entry.owner?.id === this.client.user?.id && entry.name === WEBHOOK_NAME) ??
                (await channel.createWebhook({ name: WEBHOOK_NAME }));

            this.hooks.set(channel.id, hook);

            return hook;
        } catch {
            return null;
        }
    }

    /* ----------------------------------------------------------
       Minütlich: Termine und Löschfristen
       ---------------------------------------------------------- */
    async RunDue(): Promise<void> {
        if (!this.client.databaseService.Ready) return;

        const now = Date.now();

        for (const due of await this.client.tickets.DueReminders(now)) {
            // Erst austragen: scheitert das Senden, soll es nicht jede Minute neu klingeln.
            await this.client.tickets.Patch(due.id, { reminderAt: null });

            const context = await this.Context(due.id).catch(() => null);

            if (!context) continue;

            const pings = [due.openerId, due.claimedBy].filter((id): id is string => Boolean(id));
            const text = `⏰ Erinnerung: Der Termin zu Ticket ${TicketNumber(due.number)} ist jetzt. ${pings.map((id) => `<@${id}>`).join(" ")}`;

            await context.channel
                ?.send({ ...InfoView(text, "#ffc53d"), flags: MessageFlags.IsComponentsV2, allowedMentions: { users: pings } })
                .catch(() => undefined);

            if (due.contact === "modmail") {
                const opener = await this.client.users.fetch(due.openerId).catch(() => null);

                if (opener) {
                    await this.SendDirect(
                        opener,
                        InfoView(`⏰ Dein Termin zu Ticket ${TicketNumber(due.number)} auf **${escapeMarkdown(context.guild.name)}** ist jetzt.`, "#ffc53d")
                    );
                }
            }

            await this.Refresh(context);
        }

        for (const due of await this.client.tickets.DueDeletions(now)) await this.Remove(due);
    }
}

export function SlowmodeLabel(seconds: number): string {
    if (seconds === 0) return "Aus";

    return seconds < 60 ? `${seconds} Sekunden` : `${seconds / 60} Minute${seconds === 60 ? "" : "n"}`;
}
