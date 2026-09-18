import path from "path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
    AttachmentBuilder,
    ChannelType,
    escapeMarkdown,
    Guild,
    GuildMember,
    Message,
    MessageFlags,
    MessageType,
    PermissionFlagsBits,
} from "discord.js";
import BotClient from "../client/BotClient";
import ComponentV2Builder from "../builder/ComponentV2Builder";
import { SupportRoleOf } from "../builder/TicketPanel";
import { Duration, RenderTranscript } from "../builder/TranscriptHtml";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { TicketNumber } from "../constants/Tickets";
import {
    AttachmentKey,
    INLINE_TYPES,
    MAX_DISCORD_UPLOAD,
    MAX_TRANSCRIPT_BYTES,
    MAX_TRANSCRIPT_FILE,
    MAX_TRANSCRIPT_MESSAGES,
    STORED_FILE,
    TRANSCRIPT_INLINE_BYTES,
    TRANSCRIPT_ROOT,
} from "../constants/Transcripts";
import { ITicket } from "../interfaces/services/tickets/ITicket";
import { ITranscript, ITranscriptMessage, ITranscriptUser } from "../interfaces/services/tickets/ITranscript";
import { ITranscriptEntry } from "../models/TicketTranscripts";
import { ITicketContext } from "./TicketService";
import logger from "../utils/logger";

// Anhänge in Texten von Components V2 und Embeds: Discord löst attachment:// dort zur CDN-Adresse auf.
const ATTACHMENT_URL = /https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/(?:ephemeral-)?attachments\/[^"\s\\]+/g;

/** Wer höchstens so viele Leute nachschlägt, blockiert Discord nicht mit Anfragen. */
const MAX_LOOKUPS = 50;

function Extension(url: string): string {
    const name = new URL(url).pathname.split("/").pop() ?? "";
    const match = /\.([a-z0-9]{1,8})$/i.exec(name);

    return match ? match[1].toLowerCase() : "bin";
}

/**
 * Transcripts: beim Schließen den Verlauf lesen, die Anhänge sichern, alles
 * gepackt speichern und Karte, Link und Datei verschicken. Angesehen wird im
 * Dashboard (DashboardTranscript); gerendert wird erst dann, siehe TranscriptHtml.
 */
export default class TranscriptService {
    client: BotClient;

    // Ein Transcript je Ticket, auch wenn Schließen und Löschfrist gleichzeitig fragen.
    private running = new Map<number, Promise<void>>();

    constructor(client: BotClient) {
        this.client = client;
    }

    /**
     * Legt das Transcript eines geschlossenen Tickets an, wenn der Server es
     * will und es noch keins gibt. Der Kanal darf erst verschwinden, wenn das
     * zurückgegebene Versprechen erfüllt ist - danach gibt es den Verlauf nicht mehr.
     */
    Archive(ticket: ITicket): Promise<void> {
        const running = this.running.get(ticket.id);

        if (running) return running;

        const job = this.Build(ticket).finally(() => this.running.delete(ticket.id));

        this.running.set(ticket.id, job);

        return job;
    }

    private async Build(ticket: ITicket): Promise<void> {
        const config = await this.client.ticketSettings.Of(ticket.guildId);

        if (!config.transcripts.enabled) return;
        if (await this.client.ticketTranscripts.Has(ticket.id)) return;

        const context = await this.client.ticketService.Context(ticket.id);

        // Ohne Kanal gibt es nichts mehr zu lesen - etwa von Hand gelöscht.
        if (!context.channel) return;

        const transcript = await this.Capture(context);

        await this.client.ticketTranscripts.Save(transcript);

        logger.user(
            `📄 Transcript ${TicketNumber(ticket.number)} auf ${ticket.guildId}: ${transcript.messages.length} Nachrichten, ${Object.keys(transcript.media).length} Anhänge gesichert`
        );

        await this.Deliver(context, transcript);
    }

    /* ----------------------------------------------------------
       Einsammeln
       ---------------------------------------------------------- */
    private async Capture(context: ITicketContext): Promise<ITranscript> {
        const { ticket, guild } = context;
        const channel = context.channel!;
        const fetched: Message[] = [];
        let before: string | undefined;

        while (fetched.length < MAX_TRANSCRIPT_MESSAGES) {
            const batch = await channel.messages.fetch({ limit: 100, before, cache: false });

            if (batch.size === 0) break;

            fetched.push(...batch.values());
            before = batch.last()?.id;

            if (batch.size < 100) break;
        }

        const messages = fetched.slice(0, MAX_TRANSCRIPT_MESSAGES).reverse();
        const people = await this.People(guild, messages, ticket);
        const media = await this.SaveMedia(guild.id, ticket.id, messages);

        const list: ITranscriptMessage[] = messages.map((message) => ({
            id: message.id,
            type: message.type,
            author: this.Author(message, people),
            at: message.createdTimestamp,
            edited: message.editedTimestamp,
            content: message.content,
            reply: message.type === MessageType.Reply ? (message.reference?.messageId ?? null) : null,
            embeds: message.embeds.map((embed) => embed.toJSON()),
            components: message.components.map((component) => component.toJSON()),
            files: message.attachments.map((attachment) => ({
                name: attachment.name,
                size: attachment.size,
                type: attachment.contentType,
                url: attachment.url,
                width: attachment.width,
                height: attachment.height,
                spoiler: attachment.spoiler,
                description: attachment.description,
            })),
            stickers: message.stickers.map((sticker) => ({ name: sticker.name, url: sticker.url })),
            reactions: message.reactions.cache.map((reaction) => ({
                emoji: reaction.emoji.id
                    ? `<${reaction.emoji.animated ? "a" : ""}:${reaction.emoji.name}:${reaction.emoji.id}>`
                    : (reaction.emoji.name ?? "?"),
                count: reaction.count,
            })),
        }));

        const participants = new Map<string, ITranscriptUser>();

        for (const message of list) {
            if (!message.author.bot && participants.size < 20) participants.set(message.author.id, message.author);
        }

        const known = (id: string | null): ITranscriptUser | null => (id ? (people.get(id) ?? null) : null);

        return {
            version: 1,
            ticketId: ticket.id,
            number: ticket.number,
            guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ extension: "png", size: 128 }) },
            channel: { id: channel.id, name: channel.name },
            meta: {
                optionId: ticket.optionId,
                option: context.option?.name ?? ticket.optionId,
                contact: ticket.contact,
                opener: known(ticket.openerId) ?? { id: ticket.openerId, name: ticket.openerId, avatar: null, bot: false, color: null },
                claimer: known(ticket.claimedBy),
                closer: known(ticket.closedBy),
                reason: ticket.closeReason,
                members: ticket.members,
                openedAt: ticket.createdAt.getTime(),
                closedAt: ticket.closedAt?.getTime() ?? Date.now(),
                messages: list.length,
                files: list.reduce((sum, message) => sum + message.files.length, 0),
                participants: [...participants.values()],
            },
            messages: list,
            mentions: await this.Mentions(guild, messages, people),
            media,
            truncated: fetched.length >= MAX_TRANSCRIPT_MESSAGES,
        };
    }

    private Person(member: GuildMember): ITranscriptUser {
        return {
            id: member.id,
            name: member.displayName,
            avatar: member.displayAvatarURL({ extension: "webp", size: 128 }),
            bot: member.user.bot,
            color: member.displayHexColor !== "#000000" ? member.displayHexColor : null,
        };
    }

    /**
     * Name, Bild und Rollenfarbe aller Beteiligten. Beim Abrufen der Nachrichten
     * liefert Discord keine Mitglieder mit - also einzeln nachschlagen, höchstens
     * MAX_LOOKUPS. Wer den Server verlassen hat, erscheint mit seinem Profil.
     */
    private async People(guild: Guild, messages: Message[], ticket: ITicket): Promise<Map<string, ITranscriptUser>> {
        const ids = new Set<string>([ticket.openerId, ...ticket.members]);

        if (ticket.claimedBy) ids.add(ticket.claimedBy);
        if (ticket.closedBy) ids.add(ticket.closedBy);

        for (const message of messages) if (!message.webhookId) ids.add(message.author.id);

        const people = new Map<string, ITranscriptUser>();

        for (const id of [...ids].slice(0, MAX_LOOKUPS)) {
            const member = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));

            if (member) {
                people.set(id, this.Person(member));
                continue;
            }

            const user = this.client.users.cache.get(id) ?? (await this.client.users.fetch(id).catch(() => null));

            if (user) {
                people.set(id, {
                    id,
                    name: user.displayName,
                    avatar: user.displayAvatarURL({ extension: "webp", size: 128 }),
                    bot: user.bot,
                    color: null,
                });
            }
        }

        return people;
    }

    private Author(message: Message, people: Map<string, ITranscriptUser>): ITranscriptUser {
        // Webhooks (anonymer Modus) tragen Name und Bild je Nachricht selbst.
        if (message.webhookId) {
            return {
                id: message.author.id,
                name: message.author.username,
                avatar: message.author.displayAvatarURL({ extension: "webp", size: 128 }),
                bot: true,
                color: null,
            };
        }

        return (
            people.get(message.author.id) ?? {
                id: message.author.id,
                name: message.author.displayName,
                avatar: message.author.displayAvatarURL({ extension: "webp", size: 128 }),
                bot: message.author.bot,
                color: null,
            }
        );
    }

    /** Namen zu allen <@id>, <@&id> und <#id> - in Texten, Embeds und Components V2. */
    private async Mentions(guild: Guild, messages: Message[], people: Map<string, ITranscriptUser>): Promise<ITranscript["mentions"]> {
        const text = JSON.stringify(
            messages.map((message) => [
                message.content,
                message.embeds.map((embed) => embed.toJSON()),
                message.components.map((component) => component.toJSON()),
            ])
        );

        const users: Record<string, string> = {};
        const roles: ITranscript["mentions"]["roles"] = {};
        const channels: Record<string, string> = {};
        let lookups = 0;

        for (const [, id] of text.matchAll(/<@!?(\d{17,20})>/g)) {
            if (users[id]) continue;

            const known = people.get(id)?.name ?? guild.members.cache.get(id)?.displayName ?? this.client.users.cache.get(id)?.displayName;

            if (known) users[id] = known;
            else if (lookups++ < MAX_LOOKUPS) {
                const user = await this.client.users.fetch(id).catch(() => null);

                if (user) users[id] = user.displayName;
            }
        }

        for (const [, id] of text.matchAll(/<@&(\d{17,20})>/g)) {
            const role = guild.roles.cache.get(id);

            if (role) roles[id] = { name: role.name, color: role.hexColor !== "#000000" ? role.hexColor : null };
        }

        for (const [, id] of text.matchAll(/<#(\d{17,20})>/g)) {
            const channel = guild.channels.cache.get(id) ?? this.client.channels.cache.get(id);

            if (channel && "name" in channel && channel.name) channels[id] = channel.name;
        }

        return { users, roles, channels };
    }

    /**
     * Sichert die Anhänge nach transcripts/<server>/<ticket>/. Discord-Links
     * darauf laufen nach etwa einem Tag ab - ohne Kopie wären die Bilder weg.
     * Nur von Discords CDN, je Datei MAX_TRANSCRIPT_FILE, zusammen MAX_TRANSCRIPT_BYTES.
     */
    private async SaveMedia(guildId: string, ticketId: number, messages: Message[]): Promise<Record<string, string>> {
        const wanted = new Map<string, string>();

        for (const message of messages) {
            for (const attachment of message.attachments.values()) {
                const key = AttachmentKey(attachment.url);

                if (key && !wanted.has(key)) wanted.set(key, attachment.url);
            }

            const raw = JSON.stringify([message.components.map((c) => c.toJSON()), message.embeds.map((e) => e.toJSON())]);

            for (const [url] of raw.matchAll(ATTACHMENT_URL)) {
                const key = AttachmentKey(url);

                if (key && !wanted.has(key)) wanted.set(key, url);
            }
        }

        const media: Record<string, string> = {};

        if (wanted.size === 0) return media;

        const directory = path.join(TRANSCRIPT_ROOT, guildId, String(ticketId));

        await mkdir(directory, { recursive: true });

        let used = 0;
        let index = 0;

        for (const [key, url] of wanted) {
            if (used >= MAX_TRANSCRIPT_BYTES) break;

            const saved = await this.Download(url, directory, index++, Math.min(MAX_TRANSCRIPT_FILE, MAX_TRANSCRIPT_BYTES - used));

            if (!saved) continue;

            media[key] = saved.name;
            used += saved.size;
        }

        return media;
    }

    private async Download(url: string, directory: string, index: number, limit: number): Promise<{ name: string; size: number } | null> {
        try {
            // Keine Umleitungen: die Adresse ist geprüft, ihr Ziel wäre es nicht.
            const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });

            if (!response.ok) return null;

            if (Number(response.headers.get("content-length") ?? 0) > limit) {
                await response.body?.cancel();

                return null;
            }

            const buffer = Buffer.from(await response.arrayBuffer());

            if (buffer.length > limit) return null;

            const name = `${index}.${Extension(url)}`;

            await writeFile(path.join(directory, name), buffer);

            return { name, size: buffer.length };
        } catch (error) {
            logger.warn(`📄 Anhang nicht gesichert: ${String(error)}`);

            return null;
        }
    }

    /* ----------------------------------------------------------
       Verschicken
       ---------------------------------------------------------- */
    /** Die Online-Ansicht - hinter dem Login des Dashboards. */
    Link(ticketId: number): string {
        return `${this.client.server.BaseURL}${DASHBOARD_PATH}/transcript/${ticketId}`;
    }

    private async Deliver(context: ITicketContext, transcript: ITranscript): Promise<void> {
        const { config, guild, ticket } = context;
        const { channelId, dm } = config.transcripts;
        // Bei ModMail steht das Gespräch schon in den DMs des Users - und die
        // Team-Seite mit ihren internen Zeilen gehört nicht zu ihm.
        const direct = dm && ticket.contact === "direct";

        if (!channelId && !direct) return;

        const file = await this.File(transcript);

        if (channelId) {
            const channel = guild.channels.cache.get(channelId);

            if (channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement) {
                await channel
                    .send(this.Card(transcript, file, true))
                    .catch((error) => logger.warn(`📄 Transcript nicht in ${channelId} gepostet: ${String(error)}`));
            }
        }

        if (direct) {
            const opener = await this.client.users.fetch(ticket.openerId).catch(() => null);

            await opener?.send(this.Card(transcript, file, false)).catch(() => undefined);
        }
    }

    private Card(transcript: ITranscript, file: Buffer | null, mentions: boolean) {
        const { meta } = transcript;
        const name = `ticket-${String(transcript.number).padStart(4, "0")}.html`;
        const who = (user: ITranscriptUser | null, fallback: string): string =>
            user ? (mentions ? `<@${user.id}>` : escapeMarkdown(user.name)) : fallback;

        const builder = new ComponentV2Builder({ accentColor: "#ff1e2d" })
            .title(`📄 | Transcript ${TicketNumber(transcript.number)}`, `${escapeMarkdown(meta.option)} · ${escapeMarkdown(transcript.guild.name)}`)
            .separator()
            .list([
                `**Ersteller:** ${who(meta.opener, "–")}`,
                `**Bearbeiter:** ${who(meta.claimer, "niemand")}`,
                `**Geschlossen von:** ${who(meta.closer, "unbekannt")}${meta.reason ? ` – ${escapeMarkdown(meta.reason)}` : ""}`,
                `**Geöffnet:** <t:${Math.floor(meta.openedAt / 1000)}:f> · **Dauer:** ${Duration(meta.closedAt - meta.openedAt)}`,
                `**Nachrichten:** ${meta.messages} · **Anhänge:** ${meta.files}`,
            ]);

        if (file) builder.file(name);

        builder.buttons({ url: this.Link(transcript.ticketId), label: "Online ansehen", emoji: "📄" });

        if (!mentions) builder.subtext("Online ansehen braucht die Anmeldung im Dashboard. Die Datei öffnet jeder Browser.");

        return {
            components: [builder.build()],
            files: file ? [new AttachmentBuilder(file, { name })] : [],
            flags: MessageFlags.IsComponentsV2 as const,
            allowedMentions: { parse: [] },
        };
    }

    /* ----------------------------------------------------------
       Ansehen
       ---------------------------------------------------------- */
    private Directory(guildId: string, ticketId: number): string {
        return path.join(TRANSCRIPT_ROOT, guildId, String(ticketId));
    }

    /** Löscht ein Transcript samt gesicherter Anhänge - etwa auf Wunsch des Erstellers. */
    async Delete(entry: ITranscriptEntry): Promise<void> {
        await this.client.ticketTranscripts.Delete(entry.ticketId);
        await rm(this.Directory(entry.guildId, entry.ticketId), { recursive: true, force: true });

        logger.user(`📄 Transcript ${TicketNumber(entry.number)} auf ${entry.guildId} gelöscht`);
    }

    /** Wo ein gesicherter Anhang liegt - null für jeden Namen, den der Bot nicht selbst vergibt. */
    FilePath(entry: ITranscriptEntry, name: string): string | null {
        return STORED_FILE.test(name) ? path.join(this.Directory(entry.guildId, entry.ticketId), name) : null;
    }

    /**
     * Die HTML-Datei zum Mitnehmen: Bilder eingebettet, solange sie zusammen in
     * TRANSCRIPT_INLINE_BYTES passen, der Rest zeigt auf die Online-Ansicht.
     * limit: für Discord höchstens 10 MB - darüber gibt es nur den Link.
     */
    async File(transcript: ITranscript, limit: number | null = MAX_DISCORD_UPLOAD): Promise<Buffer | null> {
        const directory = this.Directory(transcript.guild.id, transcript.ticketId);
        const inline = new Map<string, string>();
        let room = TRANSCRIPT_INLINE_BYTES;

        for (const stored of Object.values(transcript.media)) {
            const type = INLINE_TYPES[path.extname(stored)];

            if (!type?.startsWith("image/")) continue;

            const data = await readFile(path.join(directory, stored)).catch(() => null);

            if (!data || data.length > room) continue;

            room -= data.length;
            inline.set(stored, `data:${type};base64,${data.toString("base64")}`);
        }

        const online = this.Link(transcript.ticketId);
        const html = Buffer.from(
            RenderTranscript(transcript, { file: (stored) => inline.get(stored) ?? `${online}/${stored}` }),
            "utf8"
        );

        return limit === null || html.length <= limit ? html : null;
    }

    /** Die Online-Ansicht: Anhänge über die eigene Route, oben der Weg zurück. */
    async Page(entry: ITranscriptEntry): Promise<string | null> {
        const transcript = await this.client.ticketTranscripts.Read(entry.ticketId);

        if (!transcript) return null;

        const base = `${DASHBOARD_PATH}/transcript/${entry.ticketId}`;

        return RenderTranscript(transcript, {
            file: (stored) => `${base}/${stored}`,
            bar: { back: `${DASHBOARD_PATH}/guild/${entry.guildId}/transcriptions`, download: `${base}?download=1` },
        });
    }

    /**
     * Wer ein Transcript öffnen darf: "Server verwalten", die Support-Rolle des
     * Tickets und - nur bei Klassisch - der Ersteller und hinzugefügte User. Bei
     * ModMail ist das Transcript die Team-Seite mit ihren internen Zeilen.
     */
    async CanRead(userId: string, entry: ITranscriptEntry): Promise<boolean> {
        const { meta } = entry;

        if (meta.contact === "direct" && (userId === meta.opener?.id || meta.members?.includes(userId))) return true;

        const guild = this.client.guilds.cache.get(entry.guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;

        if (!member) return false;
        if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;

        const config = await this.client.ticketSettings.Of(entry.guildId);
        const role = SupportRoleOf(config, config.options.find((option) => option.id === meta.optionId) ?? null);

        return role !== null && member.roles.cache.has(role);
    }
}
