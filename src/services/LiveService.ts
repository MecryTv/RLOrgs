import { Events, Guild, GuildMember, Message, PartialMessage, PermissionFlagsBits, SnowflakeUtil } from "discord.js";
import BotClient from "../client/BotClient";
import { OptionOf } from "../builder/TicketPanel";
import { RenderLive } from "../builder/TranscriptHtml";
import { TicketContact, TicketPriority, TicketStatus } from "../constants/Tickets";
import { ITicket, ITicketConfig } from "../interfaces/services/tickets/ITicket";
import { ITranscriptUser } from "../interfaces/services/tickets/ITranscript";
import logger from "../utils/logger";

/** Ein offenes Ticket in der Liste von Live Tickets. */
export interface ILiveTicket {
    id: number;
    number: number;
    /** Das Kürzel des Themas (SUP) - fehlt bei Tickets von vor den Kürzeln. */
    code: string | null;
    /** Die feste ID des Erstellers ohne "U-". */
    userCode: string | null;
    /** Wie viele Tickets der Ersteller auf diesem Server schon hatte, dieses mitgezählt. */
    openerTickets: number;
    option: { id: string; name: string; emoji: string | null };
    contact: TicketContact;
    status: TicketStatus;
    priority: TicketPriority | null;
    opener: { id: string; name: string; avatar: string | null };
    claimer: { id: string; name: string } | null;
    /** Hinzugefügte User - für "Benutzer entfernen". */
    members: { id: string; name: string; avatar: string | null }[];
    /** Wer im anonymen Modus schreibt. */
    anonymous: string[];
    slowmode: number;
    reminderAt: number | null;
    createdAt: number;
    /** Zeitpunkt der letzten Nachricht - aus der ID, ohne Abfrage bei Discord. */
    lastAt: number;
    messages: number;
    url: string | null;
}

/** Eine Nachricht im Chat - fertig gerendert, dieselbe Darstellung wie im Transcript. */
export interface ILiveMessage {
    id: string;
    at: number;
    author: string;
    reply: boolean;
    html: string;
    compact: string;
}

/** Wer Live Tickets eines Servers gerade offen hat. */
export interface ILiveAccess {
    guild: Guild;
    member: GuildMember;
    config: ITicketConfig;
    /** "Server verwalten" - sieht jedes Ticket und darf Transcripts löschen. */
    manage: boolean;
}

interface ISubscriber {
    userId: string;
    send(event: string, data: unknown): void;
    ping(): void;
}

/** Der Text einer Components-V2-Karte, ohne Kopf- und Fußzeilen (-#). */
function CardText(nodes: unknown): string {
    const lines: string[] = [];
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;

        const entry = node as { type?: number; content?: unknown; components?: unknown };

        if (entry.type === 10 && typeof entry.content === "string") lines.push(...entry.content.split("\n"));

        walk(entry.components);
    };

    walk(nodes);

    return lines.filter((line) => !line.startsWith("-# ")).join("\n");
}

/** Eine Zeile für die Liste: Klartext ohne Markdown, Erwähnungen nur angedeutet. */
export function Preview(message: Pick<Message, "content" | "components" | "embeds" | "attachments">): string {
    const text = (message.content || CardText(message.components.map((component) => component.toJSON())))
        .replace(/<a?:(\w{2,32}):\d{17,20}>/g, ":$1:")
        .replace(/<@&\d{17,20}>/g, "@Rolle")
        .replace(/<@!?\d{17,20}>/g, "@jemand")
        .replace(/<#\d{17,20}>/g, "#Kanal")
        .replace(/[*_~|`]/g, "")
        .replace(/^(?:>|#{1,3} |-# )/gm, "")
        .replace(/\s+/g, " ")
        .trim();

    if (text) return text.slice(0, 90);
    if (message.attachments.size) return "📎 Anhang";

    return message.components.length || message.embeds.length ? "Karte vom Bot" : "";
}

// Wie viele Verbindungen ein User gleichzeitig offen halten darf - ein paar Tabs.
const MAX_STREAMS = 6;
const PING_MS = 25_000;
const HISTORY = 50;

/**
 * Live Tickets: offene Tickets mitlesen und aus dem Dashboard antworten. Neue,
 * geänderte und gelöschte Nachrichten in Ticket-Kanälen gehen als Server-Sent
 * Events an jeden, der das Ticket sehen darf (DashboardApiLiveStream). Gerendert
 * wird einmal je Nachricht, verschickt an alle.
 */
export default class LiveService {
    client: BotClient;

    private subscribers = new Map<string, Set<ISubscriber>>();
    private pinger: NodeJS.Timeout | null = null;

    constructor(client: BotClient) {
        this.client = client;
    }

    Initialize(): void {
        this.client.on(Events.MessageCreate, (message) => void this.OnMessage(message, "message"));
        this.client.on(Events.MessageUpdate, (_before, message) => void this.OnMessage(message, "edit"));
        this.client.on(Events.MessageDelete, (message) => void this.OnDelete(message));
    }

    /* ----------------------------------------------------------
       Zugriff
       ---------------------------------------------------------- */
    /** Das Mitglied hinter einer Sitzung - null, wenn es den Server oder den User dort nicht gibt. */
    async Access(userId: string, guildId: string): Promise<ILiveAccess | null> {
        const guild = this.client.guilds.cache.get(guildId);

        if (!guild || !this.client.databaseService.Ready) return null;

        const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));

        if (!member) return null;

        return {
            guild,
            member,
            config: await this.client.ticketSettings.Of(guildId),
            manage: member.permissions.has(PermissionFlagsBits.ManageGuild),
        };
    }

    /** Dieselbe Regel wie im Ticket selbst: "Server verwalten" oder die Support-Rolle des Themas. */
    CanSee(access: ILiveAccess, ticket: ITicket): boolean {
        return (
            ticket.guildId === access.guild.id &&
            this.client.ticketService.IsStaff(access.member, { config: access.config, option: OptionOf(access.config, ticket) })
        );
    }

    /* ----------------------------------------------------------
       Lesen
       ---------------------------------------------------------- */
    async Tickets(access: ILiveAccess): Promise<ILiveTicket[]> {
        const open = await this.client.tickets.OpenOfGuild(access.guild.id);
        const visible = open.filter((ticket) => this.CanSee(access, ticket));
        // Eine Abfrage für alle statt einer je Ticket.
        const counts = await this.client.tickets.CountsByOpener(
            access.guild.id,
            visible.map((ticket) => ticket.openerId)
        );

        return Promise.all(visible.map((ticket) => this.Summary(access.guild, access.config, ticket, counts)));
    }

    async Summary(guild: Guild, config: ITicketConfig, ticket: ITicket, counts?: Map<string, number>): Promise<ILiveTicket> {
        const option = OptionOf(config, ticket);
        const channel = ticket.channelId ? this.client.channels.cache.get(ticket.channelId) : null;
        const last = channel && "lastMessageId" in channel ? channel.lastMessageId : null;
        const opener =
            guild.members.cache.get(ticket.openerId) ??
            this.client.users.cache.get(ticket.openerId) ??
            (await this.client.users.fetch(ticket.openerId).catch(() => null));
        const claimer = ticket.claimedBy ? (guild.members.cache.get(ticket.claimedBy) ?? this.client.users.cache.get(ticket.claimedBy)) : null;
        const members = await Promise.all(
            ticket.members.map(async (id) => {
                const person =
                    guild.members.cache.get(id) ?? this.client.users.cache.get(id) ?? (await this.client.users.fetch(id).catch(() => null));

                return { id, name: person?.displayName ?? id, avatar: person ? person.displayAvatarURL({ extension: "webp", size: 64 }) : null };
            })
        );

        const total = counts ?? (await this.client.tickets.CountsByOpener(guild.id, [ticket.openerId]));

        return {
            id: ticket.id,
            number: ticket.number,
            code: ticket.code,
            // Ältere Tickets kennen die ID noch nicht - sie kommt dann aus user_codes.
            userCode: ticket.openerCode ?? (await this.client.userCodes.Of(ticket.openerId).catch(() => null)),
            openerTickets: total.get(ticket.openerId) ?? 1,
            option: { id: ticket.optionId, name: option?.name ?? ticket.optionId, emoji: option?.emoji ?? null },
            contact: ticket.contact,
            status: ticket.status,
            priority: ticket.priority,
            opener: {
                id: ticket.openerId,
                name: opener?.displayName ?? ticket.openerId,
                avatar: opener ? opener.displayAvatarURL({ extension: "webp", size: 64 }) : null,
            },
            claimer: ticket.claimedBy ? { id: ticket.claimedBy, name: claimer?.displayName ?? "jemand vom Team" } : null,
            members,
            anonymous: ticket.anonymous,
            slowmode: ticket.slowmode,
            reminderAt: ticket.reminderAt,
            createdAt: ticket.createdAt.getTime(),
            lastAt: last ? SnowflakeUtil.timestampFrom(last) : ticket.createdAt.getTime(),
            messages: ticket.messages,
            url: ticket.channelId ? `https://discord.com/channels/${guild.id}/${ticket.channelId}` : null,
        };
    }

    /** Die letzten 50 Nachrichten eines Tickets, mit before seitenweise weiter zurück. */
    async History(access: ILiveAccess, ticket: ITicket, before?: string): Promise<{ messages: ILiveMessage[]; more: boolean }> {
        const channel = ticket.channelId ? await this.client.channels.fetch(ticket.channelId).catch(() => null) : null;

        if (!channel || !("messages" in channel)) return { messages: [], more: false };

        const batch = await channel.messages.fetch({ limit: HISTORY, before }).catch(() => null);

        if (!batch) return { messages: [], more: false };

        const list = [...batch.values()].reverse() as Message<true>[];

        return { messages: await this.Render(access.guild, ticket, list), more: batch.size === HISTORY };
    }

    private async Render(guild: Guild, ticket: ITicket, messages: Message[]): Promise<ILiveMessage[]> {
        const transcripts = this.client.transcriptService;
        const people = new Map<string, ITranscriptUser>();
        const team = await transcripts.TeamOf(ticket);

        // Die Autoren kennt der Bot meist schon - nur wer fehlt, wird nachgeschlagen.
        // Den Ersteller braucht es immer: weitergeleitete ModMail-Nachrichten zeigen ihn.
        const wanted = new Set<string>([ticket.openerId]);

        for (const message of messages) if (!message.webhookId) wanted.add(message.author.id);

        for (const id of wanted) {
            const member = messages.find((message) => !message.webhookId && message.author.id === id)?.member ?? guild.members.cache.get(id);

            if (member) people.set(id, transcripts.Person(member, team(member)));
        }

        if ([...wanted].some((id) => !people.has(id))) {
            for (const [id, person] of await transcripts.People(guild, messages, ticket)) if (!people.has(id)) people.set(id, person);
        }

        const snapshots = messages.map((message) => transcripts.Snapshot(message, people, ticket.openerId));
        const rendered = RenderLive(snapshots, await transcripts.Mentions(guild, messages, people));

        return snapshots.map((snapshot, index) => ({
            id: snapshot.id,
            at: snapshot.at,
            author: snapshot.author.id,
            reply: snapshot.reply !== null,
            html: rendered[index].html,
            compact: rendered[index].compact,
        }));
    }

    /* ----------------------------------------------------------
       Verbindungen
       ---------------------------------------------------------- */
    /** Meldet einen Stream an. Zurück kommt das Abmelden; null: der User hat schon zu viele offen. */
    Subscribe(guildId: string, userId: string, send: ISubscriber["send"], ping: ISubscriber["ping"]): (() => void) | null {
        let open = 0;

        for (const set of this.subscribers.values()) for (const subscriber of set) if (subscriber.userId === userId) open++;

        if (open >= MAX_STREAMS) return null;

        const subscriber: ISubscriber = { userId, send, ping };
        const set = this.subscribers.get(guildId) ?? new Set<ISubscriber>();

        set.add(subscriber);
        this.subscribers.set(guildId, set);

        // Ohne Lebenszeichen schließen Proxys eine stille Verbindung nach einer Weile.
        this.pinger ??= setInterval(() => {
            for (const group of this.subscribers.values()) for (const entry of group) entry.ping();
        }, PING_MS);

        return () => {
            set.delete(subscriber);

            // Nur die eigene Menge - ein zweiter Aufruf darf keine neuere wegwerfen.
            if (set.size === 0 && this.subscribers.get(guildId) === set) this.subscribers.delete(guildId);

            if (this.subscribers.size === 0 && this.pinger) {
                clearInterval(this.pinger);
                this.pinger = null;
            }
        };
    }

    /**
     * Schickt ein Ereignis an jeden, der das Ticket sehen darf. otherwise geht an
     * alle anderen - so verschwindet ein Ticket, das nach einem Verschieben nicht
     * mehr zur eigenen Rolle gehört.
     */
    private async Broadcast(ticket: ITicket, event: string, data: unknown, otherwise?: { event: string; data: unknown }): Promise<void> {
        const subscribers = this.subscribers.get(ticket.guildId);
        const guild = this.client.guilds.cache.get(ticket.guildId);

        if (!subscribers?.size || !guild) return;

        const config = await this.client.ticketSettings.Of(ticket.guildId);
        const option = OptionOf(config, ticket);

        for (const subscriber of subscribers) {
            const member = guild.members.cache.get(subscriber.userId);
            const allowed = member ? this.client.ticketService.IsStaff(member, { config, option }) : false;

            if (allowed) subscriber.send(event, data);
            else if (otherwise) subscriber.send(otherwise.event, otherwise.data);
        }
    }

    /* ----------------------------------------------------------
       Ereignisse
       ---------------------------------------------------------- */
    /** Ein Ticket ist entstanden oder hat sich geändert (übernommen, Priorität, geschlossen ...). */
    async Changed(ticketId: number): Promise<void> {
        try {
            const ticket = await this.client.tickets.Get(ticketId);

            if (!ticket || !this.subscribers.get(ticket.guildId)?.size) return;

            const guild = this.client.guilds.cache.get(ticket.guildId);

            if (!guild) return;

            const gone = { event: "ticket", data: { id: ticket.id, closed: true } };

            if (ticket.status === "closed") {
                await this.Broadcast(ticket, gone.event, gone.data, gone);

                return;
            }

            const config = await this.client.ticketSettings.Of(ticket.guildId);

            await this.Broadcast(ticket, "ticket", await this.Summary(guild, config, ticket), gone);
        } catch (error) {
            logger.warn(`🎫 Live: Ticket ${ticketId} nicht gemeldet - ${String(error)}`);
        }
    }

    /** Ein Transcript ist fertig - die Liste unter Transcriptions lädt neu. */
    async Archived(ticket: ITicket): Promise<void> {
        try {
            await this.Broadcast(ticket, "transcript", { id: ticket.id, number: ticket.number });
        } catch (error) {
            logger.warn(`📄 Live: Transcript ${ticket.id} nicht gemeldet - ${String(error)}`);
        }
    }

    private async OnMessage(message: Message | PartialMessage, event: "message" | "edit"): Promise<void> {
        try {
            if (!message.guildId || !this.subscribers.get(message.guildId)?.size) return;
            if (!(await this.client.ticketService.Knows(message.channelId))) return;

            const full = message.partial ? await message.fetch().catch(() => null) : message;

            if (!full?.inGuild()) return;

            const ticket = await this.client.tickets.ByChannel(full.channelId);

            if (!ticket || ticket.status === "closed") return;

            const [rendered] = await this.Render(full.guild, ticket, [full]);
            const preview = Preview(full);

            await this.Broadcast(ticket, event, { ticketId: ticket.id, preview, ...rendered });
        } catch (error) {
            logger.warn(`🎫 Live: Nachricht ${message.id} nicht gemeldet - ${String(error)}`);
        }
    }

    private async OnDelete(message: Message | PartialMessage): Promise<void> {
        try {
            if (!message.guildId || !this.subscribers.get(message.guildId)?.size) return;
            if (!(await this.client.ticketService.Knows(message.channelId))) return;

            const ticket = await this.client.tickets.ByChannel(message.channelId);

            if (ticket) await this.Broadcast(ticket, "remove", { ticketId: ticket.id, id: message.id });
        } catch (error) {
            logger.warn(`🎫 Live: Löschen von ${message.id} nicht gemeldet - ${String(error)}`);
        }
    }
}
