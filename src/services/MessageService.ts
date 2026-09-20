import { ButtonInteraction, Guild, GuildMember, Message, MessageFlags, PermissionFlagsBits } from "discord.js";
import BotClient from "../client/BotClient";
import { CleanDoc } from "../builder/MessageDoc";
import { CustomMessageView } from "../builder/CustomView";
import { InfoCard } from "../builder/CommunityView";
import {
    DefaultMessageDoc,
    DefaultResponseDoc,
    DefaultResponseSettings,
    DefaultSchedule,
    MAX_BUTTONS,
    MAX_BUTTON_TEXT,
    MAX_COOLDOWN,
    MAX_FILTER,
    MAX_LABEL,
    MAX_MESSAGES,
    MAX_NAME,
    MAX_PHRASE,
    MAX_RESPONSES,
    MESSAGE_ACCENT,
    Matches,
    NextRun,
} from "../constants/Messages";
import { IAutoResponse, ICustomButton, ICustomMessage, IResponseSettings, ISchedule, MatchMode } from "../interfaces/services/messages/IMessages";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";
import logger from "../utils/logger";

export class MessageError extends Error {}

export const MESSAGES_MODULE = "custom-message";

function IsRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function Int(value: unknown, min: number, max: number, fallback: number): number {
    const number = Math.floor(Number(value));

    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/**
 * Custom Message: eigene Nachrichten mit Knöpfen, auf Wunsch geplant oder
 * wiederkehrend - dazu Antworten auf Stichwörter. Siehe docs/Messages.md.
 */
export default class MessageService {
    private readonly client: BotClient;
    // Stichwort + Kanal -> wann zuletzt geantwortet. Gegen Ping-Pong im Chat.
    private readonly recent = new Map<string, number>();

    constructor(client: BotClient) {
        this.client = client;
    }

    /* ----------------------------------------------------------
       Nachrichten
       ---------------------------------------------------------- */
    /** Prüft, was aus dem Dashboard kommt. */
    Clean(guild: Guild, input: unknown, previous?: ICustomMessage): { name: string; doc: IMessageDoc; buttons: ICustomButton[]; channelId: string | null; schedule: ISchedule } {
        const raw = IsRecord(input) ? input : {};
        const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME) : (previous?.name ?? "");
        const doc = raw.doc === undefined ? (previous?.doc ?? DefaultMessageDoc()) : (CleanDoc(raw.doc, guild.id) ?? { blocks: [] });
        const channel = typeof raw.channelId === "string" ? guild.channels.cache.get(raw.channelId) : null;

        if (!name) throw new MessageError("Gib der Nachricht einen Namen – nur ihr seht ihn.");
        if (!doc.blocks.length) throw new MessageError("Die Nachricht ist leer.");

        return {
            name,
            doc,
            buttons: raw.buttons === undefined ? (previous?.buttons ?? []) : this.CleanButtons(guild, raw.buttons),
            channelId: raw.channelId === undefined ? (previous?.channelId ?? null) : channel?.isTextBased() ? channel.id : null,
            schedule: this.CleanSchedule(raw.schedule, previous?.schedule),
        };
    }

    CleanButtons(guild: Guild, input: unknown): ICustomButton[] {
        if (!Array.isArray(input)) return [];

        const buttons: ICustomButton[] = [];
        const seen = new Set<string>();

        for (const raw of input) {
            if (!IsRecord(raw)) continue;

            const label = typeof raw.label === "string" ? raw.label.trim().slice(0, MAX_LABEL) : "";

            if (!label) continue;

            const action = raw.action === "link" || raw.action === "text" ? raw.action : "role";
            const url = typeof raw.url === "string" && /^https:\/\//i.test(raw.url) && URL.canParse(raw.url) ? raw.url.slice(0, 512) : null;
            const roleId = typeof raw.roleId === "string" && guild.roles.cache.has(raw.roleId) && raw.roleId !== guild.id ? raw.roleId : null;
            const text = typeof raw.text === "string" ? raw.text.trim().slice(0, MAX_BUTTON_TEXT) : null;

            if (action === "link" && !url) continue;
            if (action === "role" && !roleId) continue;
            if (action === "text" && !text) continue;

            let id = typeof raw.id === "string" && /^[a-z0-9]{1,12}$/i.test(raw.id) ? raw.id : String(buttons.length + 1);

            while (seen.has(id)) id = `${id}x`;

            seen.add(id);
            buttons.push({
                id,
                label,
                emoji: this.client.ticketService.CleanEmoji(raw.emoji),
                tone: raw.tone === "primary" || raw.tone === "success" || raw.tone === "danger" ? raw.tone : "secondary",
                action,
                roleId,
                mode: raw.mode === "add" || raw.mode === "remove" ? raw.mode : "toggle",
                url,
                text,
            });

            if (buttons.length >= MAX_BUTTONS) break;
        }

        return buttons;
    }

    CleanSchedule(input: unknown, previous = DefaultSchedule()): ISchedule {
        const raw = IsRecord(input) ? input : {};

        if (input === undefined) return previous;

        const mode = raw.mode === "once" || raw.mode === "daily" || raw.mode === "weekly" ? raw.mode : "off";
        const at = Number(raw.at);
        const schedule: ISchedule = {
            mode,
            at: Number.isFinite(at) && at > 0 ? at : null,
            hour: Int(raw.hour, 0, 23, previous.hour),
            minute: Int(raw.minute, 0, 59, previous.minute),
            weekday: Int(raw.weekday, 0, 6, previous.weekday),
            next: null,
            replace: raw.replace === true,
        };

        if (mode === "once" && (!schedule.at || schedule.at <= Date.now())) throw new MessageError("Der Zeitpunkt liegt in der Vergangenheit.");

        schedule.next = NextRun(schedule);

        return schedule;
    }

    async Create(guild: Guild, input: unknown, userId: string): Promise<ICustomMessage> {
        if ((await this.client.customMessages.OfGuild(guild.id)).length >= MAX_MESSAGES) {
            throw new MessageError(`Mehr als ${MAX_MESSAGES} Nachrichten gehen je Server nicht.`);
        }

        const clean = this.Clean(guild, input);

        return this.client.customMessages.Create({ guildId: guild.id, ...clean, createdBy: userId });
    }

    async Save(guild: Guild, id: number, input: unknown): Promise<ICustomMessage> {
        const message = await this.Own(guild, id);
        const clean = this.Clean(guild, input, message);

        await this.client.customMessages.Save(id, clean);

        const saved = (await this.client.customMessages.Get(id))!;

        // Steht sie schon in Discord, zieht die Änderung gleich mit.
        if (saved.messageId) await this.Update(guild, saved).catch(() => undefined);

        return saved;
    }

    private async Own(guild: Guild, id: number): Promise<ICustomMessage> {
        const message = Number.isInteger(id) ? await this.client.customMessages.Get(id) : null;

        if (!message || message.guildId !== guild.id) throw new MessageError("Diese Nachricht gibt es nicht mehr.");

        return message;
    }

    /** Schickt sie in den eingestellten Kanal - und merkt sich, wo sie steht. */
    async Send(guild: Guild, id: number): Promise<ICustomMessage> {
        const message = await this.Own(guild, id);
        const channel = message.channelId ? guild.channels.cache.get(message.channelId) : null;

        if (!channel?.isTextBased()) throw new MessageError("Wähle zuerst einen Kanal.");

        const view = await CustomMessageView(this.client, message.id, message.doc, message.buttons, { guild: guild.name });
        const sent = await channel.send({ ...view, flags: MessageFlags.IsComponentsV2 }).catch(() => null);

        if (!sent) throw new MessageError("Die Nachricht ging nicht raus – darf der Bot in den Kanal schreiben?");

        await this.client.customMessages.Save(message.id, { messageId: sent.id, channelId: channel.id });
        logger.user(`✉️ Nachricht "${message.name}" auf ${guild.id} gesendet`);

        return (await this.client.customMessages.Get(message.id))!;
    }

    /** Zieht die schon gesendete Nachricht nach. */
    async Update(guild: Guild, message: ICustomMessage): Promise<void> {
        const channel = message.channelId ? guild.channels.cache.get(message.channelId) : null;

        if (!channel?.isTextBased() || !message.messageId) throw new MessageError("Diese Nachricht steht noch nirgends.");

        const target = await channel.messages.fetch(message.messageId).catch(() => null);

        if (!target) {
            await this.client.customMessages.Save(message.id, { messageId: null });

            throw new MessageError("Die Nachricht ist in Discord nicht mehr da – schick sie neu.");
        }

        const view = await CustomMessageView(this.client, message.id, message.doc, message.buttons, { guild: guild.name });

        await target.edit({ components: view.components, files: view.files ?? [], attachments: [], allowedMentions: { parse: [] } });
    }

    async Delete(guild: Guild, id: number, withMessage: boolean): Promise<void> {
        const message = await this.Own(guild, id);

        if (withMessage && message.channelId && message.messageId) {
            const channel = guild.channels.cache.get(message.channelId);

            if (channel?.isTextBased()) await channel.messages.delete(message.messageId).catch(() => undefined);
        }

        await this.client.customMessages.Remove(id);
    }

    /* ----------------------------------------------------------
       Geplant und wiederkehrend
       ---------------------------------------------------------- */
    /** Jede Minute: was fällig ist, geht raus. */
    async RunDue(): Promise<void> {
        if (!this.client.databaseService.Ready) return;

        for (const message of await this.client.customMessages.Due(Date.now())) {
            const guild = this.client.guilds.cache.get(message.guildId);

            if (!guild) continue;

            try {
                if (!(await this.client.settings.Of(guild.id)).modules.includes(MESSAGES_MODULE)) continue;

                // Wiederkehrend und "ersetzen": die alte zuerst weg.
                if (message.schedule.replace && message.messageId && message.channelId) {
                    const channel = guild.channels.cache.get(message.channelId);

                    if (channel?.isTextBased()) await channel.messages.delete(message.messageId).catch(() => undefined);
                }

                await this.Send(guild, message.id);
            } catch (error) {
                logger.warn(`✉️ Nachricht ${message.id} nicht gesendet - ${String(error)}`);
            } finally {
                const schedule = { ...message.schedule };

                schedule.next = schedule.mode === "once" ? null : NextRun({ ...schedule, next: null });

                if (schedule.mode === "once") schedule.mode = "off";

                await this.client.customMessages.Save(message.id, { schedule });
            }
        }
    }

    /* ----------------------------------------------------------
       Knöpfe
       ---------------------------------------------------------- */
    async Button(interaction: ButtonInteraction, id: number, buttonId: string): Promise<void> {
        const message = await this.client.customMessages.Get(id);
        const button = message?.buttons.find((entry) => entry.id === buttonId);
        const reply = (text: string) => interaction.reply({ ...InfoCard(text, MESSAGE_ACCENT), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

        if (!message || !button || message.guildId !== interaction.guildId) {
            await reply("Diesen Knopf gibt es nicht mehr.");

            return;
        }

        if (button.action === "text") {
            await reply(button.text ?? "");

            return;
        }

        if (button.action !== "role" || !button.roleId) return;

        const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild!.members.fetch(interaction.user.id);
        const role = interaction.guild!.roles.cache.get(button.roleId);
        const me = interaction.guild!.members.me;

        if (!role) {
            await reply("Diese Rolle gibt es nicht mehr.");

            return;
        }

        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.comparePositionTo(me.roles.highest) >= 0 || role.managed) {
            await reply(`Der Bot kann @${role.name} nicht vergeben – die Rolle muss unter seiner höchsten stehen.`);

            return;
        }

        const has = member.roles.cache.has(role.id);
        const add = button.mode === "add" || (button.mode === "toggle" && !has);

        if (add === has) {
            await reply(has ? `Du hast **${role.name}** schon.` : `Du hast **${role.name}** nicht.`);

            return;
        }

        if (add) await member.roles.add(role, "Knopf unter einer Nachricht");
        else await member.roles.remove(role, "Knopf unter einer Nachricht");

        await reply(add ? `✅ **${role.name}** gehört jetzt dir.` : `➖ **${role.name}** ist weg.`);
    }

    /* ----------------------------------------------------------
       Autoresponder
       ---------------------------------------------------------- */
    CleanResponse(guild: Guild, input: unknown, previous?: IAutoResponse): { phrase: string; match: MatchMode; doc: IMessageDoc; settings: IResponseSettings } {
        const raw = IsRecord(input) ? input : {};
        const phrase = typeof raw.phrase === "string" ? raw.phrase.trim().slice(0, MAX_PHRASE) : (previous?.phrase ?? "");
        const match: MatchMode = raw.match === "exact" || raw.match === "starts" || raw.match === "regex" ? raw.match : "contains";
        const doc = raw.doc === undefined ? (previous?.doc ?? DefaultResponseDoc()) : (CleanDoc(raw.doc, guild.id) ?? { blocks: [] });
        const rawSettings = IsRecord(raw.settings) ? raw.settings : {};
        const base = previous?.settings ?? DefaultResponseSettings();
        const ids = (value: unknown, has: (id: string) => boolean, fallback: string[]): string[] =>
            value === undefined ? fallback : Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && has(id)))].slice(0, MAX_FILTER) : [];

        if (!phrase) throw new MessageError("Gib ein Stichwort an.");
        if (!doc.blocks.length) throw new MessageError("Die Antwort ist leer.");

        if (match === "regex") {
            try {
                new RegExp(phrase, "i");
            } catch {
                throw new MessageError("Dieses Muster versteht der Bot nicht – prüf die Regex.");
            }
        }

        return {
            phrase,
            match,
            doc,
            settings: {
                reply: typeof rawSettings.reply === "boolean" ? rawSettings.reply : base.reply,
                delete: typeof rawSettings.delete === "boolean" ? rawSettings.delete : base.delete,
                quiet: typeof rawSettings.quiet === "boolean" ? rawSettings.quiet : base.quiet,
                cooldown: Int(rawSettings.cooldown, 0, MAX_COOLDOWN, base.cooldown),
                channels: ids(rawSettings.channels, (id) => Boolean(guild.channels.cache.get(id)), base.channels),
                roles: ids(rawSettings.roles, (id) => guild.roles.cache.has(id), base.roles),
                ignoreRoles: ids(rawSettings.ignoreRoles, (id) => guild.roles.cache.has(id), base.ignoreRoles),
            },
        };
    }

    async AddResponse(guild: Guild, input: unknown, userId: string): Promise<IAutoResponse> {
        if ((await this.client.autoResponses.OfGuild(guild.id)).length >= MAX_RESPONSES) {
            throw new MessageError(`Mehr als ${MAX_RESPONSES} Stichwörter gehen je Server nicht.`);
        }

        return this.client.autoResponses.Create({ guildId: guild.id, ...this.CleanResponse(guild, input), createdBy: userId });
    }

    async SaveResponse(guild: Guild, id: number, input: unknown): Promise<IAutoResponse> {
        const response = await this.client.autoResponses.Get(id);

        if (!response || response.guildId !== guild.id) throw new MessageError("Dieses Stichwort gibt es nicht mehr.");

        const clean = this.CleanResponse(guild, input, response);
        const raw = IsRecord(input) ? input : {};

        await this.client.autoResponses.Save(id, { ...clean, ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}) });

        return (await this.client.autoResponses.Get(id))!;
    }

    async RemoveResponse(guild: Guild, id: number): Promise<void> {
        const response = await this.client.autoResponses.Get(id);

        if (!response || response.guildId !== guild.id) throw new MessageError("Dieses Stichwort gibt es nicht mehr.");

        await this.client.autoResponses.Remove(id);
    }

    /** Jede Nachricht: passt ein Stichwort, antwortet der Bot. */
    async Incoming(message: Message): Promise<void> {
        if (!message.inGuild() || message.author.bot || !message.content || !this.client.databaseService.Ready) return;
        if (!(await this.client.settings.Of(message.guildId)).modules.includes(MESSAGES_MODULE)) return;

        const responses = (await this.client.autoResponses.OfGuild(message.guildId)).filter((entry) => entry.enabled);

        if (!responses.length) return;

        const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));

        for (const response of responses) {
            const { settings } = response;

            if (settings.channels.length && !settings.channels.includes(message.channelId) && !settings.channels.includes(message.channel.parentId ?? "")) continue;
            if (member && settings.ignoreRoles.some((id) => member.roles.cache.has(id))) continue;
            if (settings.roles.length && !(member && settings.roles.some((id) => member.roles.cache.has(id)))) continue;
            if (!Matches(message.content, response.phrase, response.match)) continue;

            const key = `${response.id}:${message.channelId}`;
            const now = Date.now();

            if (now - (this.recent.get(key) ?? 0) < settings.cooldown * 1000) return;

            this.recent.set(key, now);

            const view = await CustomMessageView(this.client, response.id, response.doc, [], {
                user: `<@${message.author.id}>`,
                "user.name": message.member?.displayName ?? message.author.username,
                guild: message.guild.name,
            });
            const payload = { ...view, flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { users: [message.author.id] } };

            if (settings.reply) {
                await message
                    .reply(settings.quiet ? { ...payload, flags: (MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications) as typeof MessageFlags.IsComponentsV2 } : payload)
                    .catch(() => undefined);
            } else if (message.channel.isSendable()) {
                await message.channel.send(payload).catch(() => undefined);
            }

            if (settings.delete) await message.delete().catch(() => undefined);

            await this.client.autoResponses.Used(response.id);

            return;
        }
    }
}
