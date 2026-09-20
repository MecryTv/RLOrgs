import { ChannelType, Guild, GuildMember, Message, MessageFlags } from "discord.js";
import BotClient from "../client/BotClient";
import { RenderDoc } from "../builder/MessageDoc";
import {
    DefaultLevelMessage,
    DefaultLevelSettings,
    LevelFromXp,
    LevelProgress,
    MAX_BONUS,
    MAX_COOLDOWN,
    MAX_EXCLUDED,
    MAX_FACTOR,
    MAX_LEVEL,
    MAX_REWARDS,
    MAX_XP_PER_ACTION,
    MIN_FACTOR,
    XpForLevel,
} from "../constants/Levels";
import { CleanDoc } from "../builder/MessageDoc";
import { ILevelBonus, ILevelEntry, ILevelSettings } from "../interfaces/services/levels/ILevels";
import logger from "../utils/logger";

export class LevelError extends Error {}

export const LEVELS_MODULE = "levels";

function IsRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function Int(value: unknown, min: number, max: number, fallback: number): number {
    const number = Math.floor(Number(value));

    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function Ids(value: unknown, has: (id: string) => boolean, max: number): string[] {
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && has(id)))].slice(0, max) : [];
}

/**
 * Level System: Punkte für Nachrichten und Zeit im Sprachkanal, Rollen ab
 * einem Level und eine Rangliste. Siehe docs/Levels.md.
 */
export default class LevelService {
    private readonly client: BotClient;
    // Wer wann zuletzt Punkte bekam - spart je Nachricht eine Abfrage.
    private readonly cooldowns = new Map<string, number>();

    constructor(client: BotClient) {
        this.client = client;
    }

    /* ----------------------------------------------------------
       Einstellungen
       ---------------------------------------------------------- */
    Settings(guildId: string): Promise<ILevelSettings> {
        return this.client.moduleSettings.Of<ILevelSettings>(guildId, LEVELS_MODULE, DefaultLevelSettings());
    }

    /** Was aus dem Dashboard kommt, wird zu gültigen Einstellungen. */
    Clean(guild: Guild, input: unknown, previous: ILevelSettings): ILevelSettings {
        const raw = IsRecord(input) ? input : {};
        const chat = IsRecord(raw.chat) ? raw.chat : {};
        const voice = IsRecord(raw.voice) ? raw.voice : {};
        const role = (id: string): boolean => guild.roles.cache.has(id) && id !== guild.id;
        const channel = (id: string): boolean => Boolean(guild.channels.cache.get(id));
        const bonus = (value: unknown, allowed: (id: string) => boolean): ILevelBonus[] => {
            if (!Array.isArray(value)) return [];

            const seen = new Set<string>();
            const list: ILevelBonus[] = [];

            for (const entry of value) {
                if (!IsRecord(entry) || typeof entry.id !== "string" || seen.has(entry.id) || !allowed(entry.id)) continue;

                const factor = Number(entry.factor);

                if (!Number.isFinite(factor)) continue;

                seen.add(entry.id);
                list.push({ id: entry.id, factor: Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, Math.round(factor * 10) / 10)) });
            }

            return list.slice(0, MAX_BONUS);
        };

        const min = Int(chat.min, 0, MAX_XP_PER_ACTION, previous.chat.min);
        const max = Int(chat.max, 0, MAX_XP_PER_ACTION, previous.chat.max);
        const rewards = (Array.isArray(raw.rewards) ? raw.rewards : [])
            .filter((entry): entry is { level: unknown; roleId: string } => IsRecord(entry) && typeof entry.roleId === "string" && role(entry.roleId))
            .map((entry) => ({ level: Int(entry.level, 1, MAX_LEVEL, 1), roleId: entry.roleId }))
            .filter((entry, index, list) => list.findIndex((other) => other.roleId === entry.roleId) === index)
            .sort((a, b) => a.level - b.level)
            .slice(0, MAX_REWARDS);
        const announceChannel = typeof raw.announceChannelId === "string" ? guild.channels.cache.get(raw.announceChannelId) : null;
        const doc = raw.message === undefined ? previous.message : raw.message === null ? null : CleanDoc(raw.message, guild.id);

        return {
            chat: {
                on: typeof chat.on === "boolean" ? chat.on : previous.chat.on,
                min: Math.min(min, max),
                max: Math.max(min, max),
                cooldown: Int(chat.cooldown, 0, MAX_COOLDOWN, previous.chat.cooldown),
            },
            voice: {
                on: typeof voice.on === "boolean" ? voice.on : previous.voice.on,
                xp: Int(voice.xp, 0, MAX_XP_PER_ACTION, previous.voice.xp),
                alone: typeof voice.alone === "boolean" ? voice.alone : previous.voice.alone,
                muted: typeof voice.muted === "boolean" ? voice.muted : previous.voice.muted,
            },
            base: Int(raw.base, 10, 1000, previous.base),
            roleBonus: raw.roleBonus === undefined ? previous.roleBonus : bonus(raw.roleBonus, role),
            channelBonus: raw.channelBonus === undefined ? previous.channelBonus : bonus(raw.channelBonus, channel),
            noChannels: raw.noChannels === undefined ? previous.noChannels : Ids(raw.noChannels, channel, MAX_EXCLUDED),
            noRoles: raw.noRoles === undefined ? previous.noRoles : Ids(raw.noRoles, role, MAX_EXCLUDED),
            announce: raw.announce === "channel" || raw.announce === "dm" || raw.announce === "off" ? raw.announce : raw.announce === "current" ? "current" : previous.announce,
            announceChannelId: raw.announceChannelId === undefined ? previous.announceChannelId : (announceChannel?.isTextBased() ? announceChannel.id : null),
            message: doc && doc.blocks.length ? doc : null,
            rewards: raw.rewards === undefined ? previous.rewards : rewards,
            stack: typeof raw.stack === "boolean" ? raw.stack : previous.stack,
        };
    }

    async Save(guild: Guild, input: unknown): Promise<ILevelSettings> {
        const settings = this.Clean(guild, input, await this.Settings(guild.id));

        if (settings.announce === "channel" && !settings.announceChannelId) throw new LevelError("Wähle einen Kanal für die Aufstiegs-Nachricht.");

        await this.client.moduleSettings.Save(guild.id, LEVELS_MODULE, settings);

        return settings;
    }

    /* ----------------------------------------------------------
       Punkte sammeln
       ---------------------------------------------------------- */
    /** Der Faktor aus Rollen und Kanal - der höchste gewinnt, sie stapeln sich nicht. */
    private Factor(member: GuildMember, channelId: string, settings: ILevelSettings): number {
        const roles = settings.roleBonus.filter((entry) => member.roles.cache.has(entry.id)).map((entry) => entry.factor);
        const channel = settings.channelBonus.find((entry) => entry.id === channelId)?.factor ?? 1;

        return (roles.length ? Math.max(...roles) : 1) * channel;
    }

    private Blocked(member: GuildMember, channelId: string, parentId: string | null, settings: ILevelSettings): boolean {
        if (settings.noRoles.some((id) => member.roles.cache.has(id))) return true;

        return settings.noChannels.includes(channelId) || (parentId !== null && settings.noChannels.includes(parentId));
    }

    /** Eine Nachricht: Punkte, sofern die Sperre abgelaufen ist. */
    async Message(message: Message): Promise<void> {
        if (!message.inGuild() || message.author.bot || !this.client.databaseService.Ready) return;
        if (!(await this.client.settings.Of(message.guildId)).modules.includes(LEVELS_MODULE)) return;

        const settings = await this.Settings(message.guildId);

        if (!settings.chat.on || settings.chat.max <= 0) return;

        const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));

        if (!member || this.Blocked(member, message.channelId, message.channel.parentId ?? null, settings)) return;

        const key = `${message.guildId}:${message.author.id}`;
        const now = Date.now();
        const last = this.cooldowns.get(key) ?? (await this.client.levels.Of(message.guildId, message.author.id))?.lastMessage ?? 0;

        if (now - last < settings.chat.cooldown * 1000) return;

        this.cooldowns.set(key, now);

        const base = settings.chat.min + Math.floor(Math.random() * (settings.chat.max - settings.chat.min + 1));
        const xp = Math.round(base * this.Factor(member, message.channelId, settings));

        await this.Award(member, xp, { messages: 1, stamp: now }, settings, message.channelId);
    }

    /** Jede Minute: wer im Sprachkanal sitzt, bekommt Punkte. */
    async Voice(): Promise<void> {
        if (!this.client.databaseService.Ready) return;

        for (const guild of this.client.guilds.cache.values()) {
            if (!(await this.client.settings.Of(guild.id)).modules.includes(LEVELS_MODULE)) continue;

            const settings = await this.Settings(guild.id);

            if (!settings.voice.on || settings.voice.xp <= 0) continue;

            for (const state of guild.voiceStates.cache.values()) {
                const member = state.member;

                if (!member || member.user.bot || !state.channel || state.channel.id === guild.afkChannelId) continue;
                if (!settings.voice.muted && (state.selfMute || state.selfDeaf || state.mute || state.deaf)) continue;

                const others = state.channel.members.filter((entry) => !entry.user.bot && entry.id !== member.id).size;

                if (!settings.voice.alone && others === 0) continue;
                if (this.Blocked(member, state.channel.id, state.channel.parentId ?? null, settings)) continue;

                const xp = Math.round(settings.voice.xp * this.Factor(member, state.channel.id, settings));

                await this.Award(member, xp, { voiceMinutes: 1 }, settings, state.channel.id).catch((error) =>
                    logger.warn(`📈 Voice-Punkte für ${member.id} auf ${guild.id} - ${String(error)}`)
                );
            }
        }
    }

    /** Punkte gutschreiben und, wenn es reicht, aufsteigen lassen. */
    private async Award(
        member: GuildMember,
        xp: number,
        extra: { messages?: number; voiceMinutes?: number; stamp?: number },
        settings: ILevelSettings,
        channelId: string
    ): Promise<void> {
        if (xp <= 0) return;

        const before = (await this.client.levels.Of(member.guild.id, member.id))?.level ?? 0;

        await this.client.levels.Add(member.guild.id, member.id, xp, extra);

        const entry = await this.client.levels.Of(member.guild.id, member.id);

        if (!entry) return;

        const level = LevelFromXp(entry.xp, settings.base);

        if (level === entry.level) return;

        await this.client.levels.SetLevel(member.guild.id, member.id, level);

        if (level > before) {
            await this.Rewards(member, level, settings);
            await this.Announce(member, level, before, entry, settings, channelId).catch(() => undefined);
        }
    }

    /* ----------------------------------------------------------
       Rollen und Aufstiegs-Nachricht
       ---------------------------------------------------------- */
    /** Die Belohnungsrollen für dieses Level - sammeln oder ersetzen. */
    async Rewards(member: GuildMember, level: number, settings: ILevelSettings): Promise<void> {
        if (!settings.rewards.length) return;

        const earned = settings.rewards.filter((reward) => reward.level <= level);

        if (!earned.length) return;

        const keep = settings.stack ? earned : [earned[earned.length - 1]];
        const add = keep.filter((reward) => !member.roles.cache.has(reward.roleId)).map((reward) => reward.roleId);
        const drop = settings.rewards
            .filter((reward) => member.roles.cache.has(reward.roleId) && !keep.some((entry) => entry.roleId === reward.roleId))
            .map((reward) => reward.roleId);

        if (add.length) await member.roles.add(add, `Level ${level}`).catch(() => undefined);
        if (drop.length) await member.roles.remove(drop, `Level ${level}`).catch(() => undefined);
    }

    private async Announce(
        member: GuildMember,
        level: number,
        before: number,
        entry: ILevelEntry,
        settings: ILevelSettings,
        channelId: string
    ): Promise<void> {
        if (settings.announce === "off") return;

        const progress = LevelProgress(entry.xp, settings.base);
        const rank = await this.client.levels.Rank(member.guild.id, member.id);
        const values: Record<string, string> = {
            user: `<@${member.id}>`,
            "user.name": member.displayName,
            "user.id": member.id,
            level: String(level),
            "level.old": String(before),
            xp: String(entry.xp),
            "xp.next": String(XpForLevel(level + 1, settings.base) - entry.xp),
            rank: String(rank),
            guild: member.guild.name,
            channel: `<#${channelId}>`,
        };
        const { builder } = await RenderDoc(this.client, settings.message ?? DefaultLevelMessage(), values, { fallback: `Level ${level}!` });
        const payload = { components: [builder.build()], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { users: [member.id] } };

        if (settings.announce === "dm") {
            await member.send(payload).catch(() => undefined);

            return;
        }

        const target = settings.announce === "channel" ? settings.announceChannelId : channelId;
        const channel = target ? (member.guild.channels.cache.get(target) ?? (await member.guild.channels.fetch(target).catch(() => null))) : null;

        if (channel?.isTextBased() && channel.type !== ChannelType.GuildStageVoice) await channel.send(payload).catch(() => undefined);
    }

    /* ----------------------------------------------------------
       Rangliste und Verwaltung
       ---------------------------------------------------------- */
    async Card(member: GuildMember): Promise<{ entry: ILevelEntry; rank: number; total: number; settings: ILevelSettings }> {
        const settings = await this.Settings(member.guild.id);
        const entry = (await this.client.levels.Of(member.guild.id, member.id)) ?? {
            guildId: member.guild.id,
            userId: member.id,
            xp: 0,
            level: 0,
            messages: 0,
            voiceMinutes: 0,
            lastMessage: 0,
        };

        return { entry, rank: entry.xp > 0 ? await this.client.levels.Rank(member.guild.id, member.id) : 0, total: await this.client.levels.Total(member.guild.id), settings };
    }

    /** Punkte setzen, dazugeben oder abziehen - aus dem Dashboard. */
    async Adjust(guild: Guild, userId: string, mode: "set" | "add" | "reset", amount: number): Promise<ILevelEntry | null> {
        const settings = await this.Settings(guild.id);

        if (mode === "reset") {
            await this.client.levels.Remove(guild.id, userId);

            return null;
        }

        const current = (await this.client.levels.Of(guild.id, userId))?.xp ?? 0;
        const xp = Math.max(0, Math.round(mode === "set" ? amount : current + amount));
        const level = LevelFromXp(xp, settings.base);

        await this.client.levels.Set(guild.id, userId, xp, level);

        const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));

        if (member) await this.Rewards(member, level, settings);

        return this.client.levels.Of(guild.id, userId);
    }

    async Reset(guild: Guild): Promise<void> {
        await this.client.levels.Clear(guild.id);
        logger.user(`📈 Rangliste auf ${guild.id} zurückgesetzt`);
    }

    /** Fehlende Belohnungsrollen nachtragen - etwa nach einer Änderung. */
    async Sync(guild: Guild): Promise<number> {
        const settings = await this.Settings(guild.id);

        if (!settings.rewards.length) return 0;

        const lowest = Math.min(...settings.rewards.map((reward) => reward.level));
        let touched = 0;

        for (const entry of await this.client.levels.AtLeast(guild.id, lowest)) {
            const member = guild.members.cache.get(entry.userId) ?? (await guild.members.fetch(entry.userId).catch(() => null));

            if (!member) continue;

            await this.Rewards(member, entry.level, settings);
            touched++;
        }

        return touched;
    }
}
