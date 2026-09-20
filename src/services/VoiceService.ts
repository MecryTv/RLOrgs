import {
    CategoryChannel,
    ChannelType,
    Guild,
    GuildMember,
    MessageFlags,
    OverwriteResolvable,
    PermissionFlagsBits,
    VoiceBasedChannel,
    VoiceState,
} from "discord.js";
import BotClient from "../client/BotClient";
import { InfoCard } from "../builder/CommunityView";
import { VoicePanel } from "../builder/VoiceView";
import {
    DefaultHubConfig,
    DefaultVoiceSettings,
    MAX_HUBS,
    MAX_LIMIT,
    MAX_PRESETS,
    MAX_TRUSTED,
    MAX_VOICE_NAME,
    REGION_LABELS,
    VOICE_ACTION_VALUES,
    FormatVoiceName,
} from "../constants/Voice";
import { IHubConfig, ITempVoice, IVoiceHub, IVoiceModuleSettings, IVoiceSettings, VoiceAction } from "../interfaces/services/voice/IVoice";
import logger from "../utils/logger";

export class VoiceError extends Error {}

export const VOICE_MODULE = "voice-hub";

function IsRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function Ids(value: unknown, max: number): string[] {
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && /^\d{17,20}$/.test(id)))].slice(0, max) : [];
}

/**
 * Temp Voice: Wer einen Hub betritt, bekommt seinen eigenen Sprachkanal - mit
 * den Vorgaben des Servers und, wenn er eines hat, seinem Preset. Steuern lässt
 * er sich über das Panel (Auswahlmenü). Ist der Kanal leer, verschwindet er.
 * Siehe docs/Voice.md.
 */
export default class VoiceService {
    private readonly client: BotClient;
    // Wer gerade einen Kanal bekommt: zwei Beitritte in derselben Sekunde
    // dürfen nicht zwei Kanäle ergeben.
    private readonly creating = new Set<string>();

    constructor(client: BotClient) {
        this.client = client;
    }

    /* ----------------------------------------------------------
       Einstellungen
       ---------------------------------------------------------- */
    Settings(guildId: string): Promise<IVoiceModuleSettings> {
        return this.client.moduleSettings.Of<IVoiceModuleSettings>(guildId, VOICE_MODULE, { panel: "voice", panelChannelId: null, panelMessageId: null });
    }

    async SaveSettings(guild: Guild, input: unknown): Promise<IVoiceModuleSettings> {
        const raw = IsRecord(input) ? input : {};
        const current = await this.Settings(guild.id);
        const panel = raw.panel === "channel" ? "channel" : "voice";
        const channel = typeof raw.panelChannelId === "string" ? guild.channels.cache.get(raw.panelChannelId) : null;
        const settings: IVoiceModuleSettings = {
            panel,
            panelChannelId: panel === "channel" && channel?.isTextBased() ? channel.id : null,
            // Steht das Panel woanders, ist die alte Nachricht nichts mehr wert.
            panelMessageId: panel === "channel" && current.panelChannelId === (channel?.id ?? null) ? current.panelMessageId : null,
        };

        if (panel === "channel" && !settings.panelChannelId) throw new VoiceError("Wähle einen Textkanal für das Panel.");

        await this.client.moduleSettings.Save(guild.id, VOICE_MODULE, settings);

        return settings;
    }

    /* ----------------------------------------------------------
       Hubs
       ---------------------------------------------------------- */
    /** Prüft, was aus dem Dashboard kommt - was nicht passt, fällt weg. */
    CleanConfig(guild: Guild, input: unknown, previous: IHubConfig): IHubConfig {
        const raw = IsRecord(input) ? input : {};
        const category = typeof raw.categoryId === "string" ? guild.channels.cache.get(raw.categoryId) : null;
        const defaults = this.CleanSettings(raw.defaults, previous.defaults);

        return {
            name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, MAX_VOICE_NAME) : previous.name,
            categoryId: raw.categoryId === undefined ? previous.categoryId : category?.type === ChannelType.GuildCategory ? category.id : null,
            defaults,
            actions: Array.isArray(raw.actions) ? VOICE_ACTION_VALUES.filter((action) => (raw.actions as unknown[]).includes(action)) : previous.actions,
            presets: typeof raw.presets === "boolean" ? raw.presets : previous.presets,
        };
    }

    CleanSettings(input: unknown, previous: IVoiceSettings = DefaultVoiceSettings()): IVoiceSettings {
        const raw = IsRecord(input) ? input : {};
        const limit = Math.floor(Number(raw.limit));
        const region = typeof raw.region === "string" && REGION_LABELS.has(raw.region) ? raw.region : null;

        return {
            name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, MAX_VOICE_NAME) : raw.name === undefined ? previous.name : null,
            limit: Number.isFinite(limit) ? Math.min(MAX_LIMIT, Math.max(0, limit)) : previous.limit,
            privacy: raw.privacy === "private" ? "private" : raw.privacy === "public" ? "public" : previous.privacy,
            stealth: typeof raw.stealth === "boolean" ? raw.stealth : previous.stealth,
            region: raw.region === undefined ? previous.region : region,
            trusted: raw.trusted === undefined ? previous.trusted : Ids(raw.trusted, MAX_TRUSTED),
            blocked: raw.blocked === undefined ? previous.blocked : Ids(raw.blocked, MAX_TRUSTED),
        };
    }

    async AddHub(guild: Guild, channelId: unknown, userId: string): Promise<IVoiceHub> {
        const channel = typeof channelId === "string" ? guild.channels.cache.get(channelId) : null;

        if (!channel || channel.type !== ChannelType.GuildVoice) throw new VoiceError("Wähle einen Sprachkanal.");
        if ((await this.client.voiceHubs.OfGuild(guild.id)).length >= MAX_HUBS) throw new VoiceError(`Mehr als ${MAX_HUBS} Hubs gehen je Server nicht.`);
        if (await this.client.voiceHubs.ByChannel(channel.id)) throw new VoiceError("Dieser Kanal ist schon ein Hub.");
        if (await this.client.tempVoices.Get(channel.id)) throw new VoiceError("Das ist ein Kanal, den der Bot gerade selbst verwaltet.");

        const config = DefaultHubConfig();

        config.categoryId = channel.parentId;

        const hub = await this.client.voiceHubs.Create({ guildId: guild.id, channelId: channel.id, config, createdBy: userId });

        logger.user(`🔊 Voice-Hub ${channel.name} auf ${guild.id} angelegt (von ${userId})`);

        return hub;
    }

    async SaveHub(guild: Guild, id: number, input: unknown): Promise<IVoiceHub> {
        const hub = await this.OwnHub(guild, id);

        await this.client.voiceHubs.SaveConfig(hub.id, this.CleanConfig(guild, input, hub.config));

        return (await this.client.voiceHubs.Get(hub.id))!;
    }

    async RemoveHub(guild: Guild, id: number): Promise<void> {
        const hub = await this.OwnHub(guild, id);

        await this.client.voiceHubs.Delete(hub.id);
    }

    private async OwnHub(guild: Guild, id: number): Promise<IVoiceHub> {
        const hub = Number.isInteger(id) ? await this.client.voiceHubs.Get(id) : null;

        if (!hub || hub.guildId !== guild.id) throw new VoiceError("Diesen Hub gibt es nicht mehr.");

        return hub;
    }

    /* ----------------------------------------------------------
       Kanäle anlegen und aufräumen
       ---------------------------------------------------------- */
    /** Jeder Wechsel im Sprachkanal: Hub betreten heißt neuer Kanal, leer heißt weg. */
    async Voice(before: VoiceState, after: VoiceState): Promise<void> {
        if (!this.client.databaseService.Ready) return;

        const guild = after.guild ?? before.guild;

        if (!(await this.client.settings.Of(guild.id)).modules.includes(VOICE_MODULE)) return;

        if (after.channelId && after.channelId !== before.channelId && after.member) {
            const hub = await this.client.voiceHubs.ByChannel(after.channelId);

            if (hub) await this.Create(hub, after.member).catch((error) => logger.warn(`🔊 Kanal für ${after.member?.id} - ${String(error)}`));
        }

        if (before.channelId && before.channelId !== after.channelId) await this.Cleanup(guild, before.channelId, before.member?.id ?? null);
    }

    /** Ein eigener Kanal: Vorgaben des Hubs, dann das Standard-Preset des Users. */
    private async Create(hub: IVoiceHub, member: GuildMember): Promise<void> {
        if (this.creating.has(member.id)) return;

        this.creating.add(member.id);

        try {
            const guild = member.guild;
            const preset = hub.config.presets ? await this.client.voicePresets.Default(member.id) : null;
            const settings: IVoiceSettings = { ...hub.config.defaults, ...(preset ? preset.config : {}) };
            const open = (await this.client.tempVoices.OfGuild(guild.id)).filter((entry) => entry.hubId === hub.id).length;
            const game = member.presence?.activities.find((activity) => activity.type === 0)?.name ?? null;
            const name = settings.name ?? FormatVoiceName(hub.config.name, { user: member.displayName, number: open + 1, game });
            const parent = hub.config.categoryId ? guild.channels.cache.get(hub.config.categoryId) : guild.channels.cache.get(hub.channelId)?.parent;

            const channel = await guild.channels.create({
                name: name.slice(0, MAX_VOICE_NAME),
                type: ChannelType.GuildVoice,
                parent: parent instanceof CategoryChannel ? parent : null,
                userLimit: settings.limit,
                rtcRegion: settings.region ?? undefined,
                permissionOverwrites: this.Overwrites(guild, member.id, settings),
                reason: `Temp Voice für ${member.user.username}`,
            });

            await this.client.tempVoices.Create({ channelId: channel.id, guildId: guild.id, hubId: hub.id, ownerId: member.id, settings: { ...settings, name } });
            await member.voice.setChannel(channel).catch(() => undefined);

            const panel = await this.Settings(guild.id);

            // Panel in den Chat des Kanals - beim festen Panel steht es schon woanders.
            if (panel.panel === "voice") {
                await channel
                    .send({ ...VoicePanel(hub.config, true), flags: MessageFlags.IsComponentsV2 })
                    .catch(() => undefined);
            }

            logger.user(`🔊 ${channel.name} auf ${guild.id} angelegt (für ${member.id})`);
        } finally {
            this.creating.delete(member.id);
        }
    }

    /** Leerer Kanal: weg. Der Besitzer geht, jemand bleibt: der Kanal wechselt den Besitzer. */
    private async Cleanup(guild: Guild, channelId: string, leftId: string | null): Promise<void> {
        const temp = await this.client.tempVoices.Get(channelId);

        if (!temp) return;

        const channel = guild.channels.cache.get(channelId);

        if (!channel || !channel.isVoiceBased()) {
            await this.client.tempVoices.Remove(channelId);

            return;
        }

        const members = channel.members.filter((member) => !member.user.bot);

        if (members.size === 0) {
            await channel.delete("Temp Voice leer").catch(() => undefined);
            await this.client.tempVoices.Remove(channelId);

            return;
        }

        if (leftId === temp.ownerId) {
            const next = members.first()!;

            await this.client.tempVoices.Save(channelId, temp.settings, next.id);
            await channel.permissionOverwrites.edit(next.id, { Connect: true, ViewChannel: true, ManageChannels: true }).catch(() => undefined);
            await channel
                .send({ ...InfoCard(`🔄 <@${next.id}> hat den Kanal übernommen – der bisherige Besitzer ist weg.`), flags: MessageFlags.IsComponentsV2 })
                .catch(() => undefined);
        }
    }

    /** Beim Start: was den Neustart nicht überlebt hat, kommt weg. */
    async Sweep(): Promise<void> {
        if (!this.client.databaseService.Ready) return;

        for (const temp of await this.client.tempVoices.All()) {
            const guild = this.client.guilds.cache.get(temp.guildId);
            const channel = guild?.channels.cache.get(temp.channelId);

            if (!channel || !channel.isVoiceBased()) {
                await this.client.tempVoices.Remove(temp.channelId);
                continue;
            }

            if (channel.members.filter((member) => !member.user.bot).size === 0) {
                await channel.delete("Temp Voice war beim Start leer").catch(() => undefined);
                await this.client.tempVoices.Remove(temp.channelId);
            }
        }
    }

    /* ----------------------------------------------------------
       Rechte
       ---------------------------------------------------------- */
    private Overwrites(guild: Guild, ownerId: string, settings: IVoiceSettings): OverwriteResolvable[] {
        const list: OverwriteResolvable[] = [
            {
                id: guild.roles.everyone.id,
                allow: [],
                deny: [
                    ...(settings.privacy === "private" ? [PermissionFlagsBits.Connect] : []),
                    ...(settings.stealth ? [PermissionFlagsBits.ViewChannel] : []),
                ],
            },
            { id: ownerId, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
        ];

        for (const id of settings.trusted) {
            if (id !== ownerId) list.push({ id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel] });
        }

        for (const id of settings.blocked) {
            if (id !== ownerId) list.push({ id, deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel] });
        }

        return list;
    }

    /** Schreibt Einstellungen auf den Kanal - Name, Größe, Region und Rechte. */
    private async Apply(channel: VoiceBasedChannel, temp: ITempVoice, settings: IVoiceSettings): Promise<void> {
        await channel.edit({
            ...(settings.name && settings.name !== channel.name ? { name: settings.name.slice(0, MAX_VOICE_NAME) } : {}),
            userLimit: settings.limit,
            rtcRegion: settings.region,
            permissionOverwrites: this.Overwrites(channel.guild, temp.ownerId, settings),
        });

        await this.client.tempVoices.Save(temp.channelId, settings);
    }

    /* ----------------------------------------------------------
       Was das Panel auslöst
       ---------------------------------------------------------- */
    /** Der Kanal, in dem jemand gerade sitzt - und ob er ihm gehört. */
    async Mine(member: GuildMember): Promise<{ channel: VoiceBasedChannel; temp: ITempVoice }> {
        const channel = member.voice.channel;

        if (!channel) throw new VoiceError("Du bist in keinem Sprachkanal.");

        const temp = await this.client.tempVoices.Get(channel.id);

        if (!temp) throw new VoiceError("Dieser Kanal gehört nicht zum Temp-Voice-System.");
        if (temp.ownerId !== member.id) throw new VoiceError("Das darf nur, wem der Kanal gehört.");

        return { channel, temp };
    }

    /**
     * Eine Aktion aus dem Panel. text kommt aus dem Modal (Name, Größe),
     * target aus der User-Auswahl. Zurück kommt, was dem Nutzer gesagt wird.
     */
    async Run(member: GuildMember, action: VoiceAction, input: { text?: string; target?: GuildMember | null } = {}): Promise<string> {
        const { channel, temp } = await this.Mine(member);
        const settings = { ...temp.settings, trusted: [...temp.settings.trusted], blocked: [...temp.settings.blocked] };
        const target = input.target ?? null;
        const named = target ? `<@${target.id}>` : "";

        switch (action) {
            case "name": {
                const name = (input.text ?? "").trim().slice(0, MAX_VOICE_NAME);

                if (!name) throw new VoiceError("Gib einen Namen an.");

                settings.name = name;
                await this.Apply(channel, temp, settings);

                return `📝 Der Kanal heißt jetzt **${name}**.`;
            }

            case "userlimit": {
                const limit = Math.floor(Number((input.text ?? "").trim()));

                if (!Number.isFinite(limit) || limit < 0 || limit > MAX_LIMIT) throw new VoiceError(`Eine Zahl von 0 bis ${MAX_LIMIT} – 0 heißt unbegrenzt.`);

                settings.limit = limit;
                await this.Apply(channel, temp, settings);

                return limit ? `🔢 Höchstens **${limit}** Leute.` : "🔢 Der Kanal ist jetzt unbegrenzt.";
            }

            case "privacy":
                settings.privacy = settings.privacy === "private" ? "public" : "private";
                await this.Apply(channel, temp, settings);

                return settings.privacy === "private"
                    ? "🔒 Privat – nur wer vertraut ist oder eingeladen wurde, kommt rein."
                    : "🔓 Offen – jeder darf rein.";

            case "stealthmode":
                settings.stealth = !settings.stealth;
                await this.Apply(channel, temp, settings);

                return settings.stealth ? "👻 Unsichtbar – andere sehen den Kanal nicht mehr." : "👀 Wieder sichtbar.";

            case "region": {
                const region = (input.text ?? "").trim();

                if (region && !REGION_LABELS.has(region)) throw new VoiceError("Diese Region gibt es nicht.");

                settings.region = region || null;
                await this.Apply(channel, temp, settings);

                return `🌐 Region: **${REGION_LABELS.get(settings.region ?? "") ?? "Automatisch"}**.`;
            }

            case "trustuser":
                if (!target) throw new VoiceError("Wähle jemanden aus.");
                if (settings.trusted.includes(target.id)) return `✅ ${named} ist schon vertraut.`;
                if (settings.trusted.length >= MAX_TRUSTED) throw new VoiceError(`Mehr als ${MAX_TRUSTED} gehen nicht.`);

                settings.trusted.push(target.id);
                settings.blocked = settings.blocked.filter((id) => id !== target.id);
                await this.Apply(channel, temp, settings);

                return `✅ ${named} darf jetzt rein.`;

            case "untrustuser":
                if (!target) throw new VoiceError("Wähle jemanden aus.");

                settings.trusted = settings.trusted.filter((id) => id !== target.id);
                await this.Apply(channel, temp, settings);

                return `❌ ${named} ist nicht mehr vertraut.`;

            case "blockuser": {
                if (!target) throw new VoiceError("Wähle jemanden aus.");
                if (target.id === member.id) throw new VoiceError("Dich selbst kannst du nicht blockieren.");

                settings.blocked = [...new Set([...settings.blocked, target.id])].slice(0, MAX_TRUSTED);
                settings.trusted = settings.trusted.filter((id) => id !== target.id);
                await this.Apply(channel, temp, settings);

                if (target.voice.channelId === channel.id) await target.voice.disconnect("Blockiert").catch(() => undefined);

                return `🚫 ${named} kommt hier nicht mehr rein.`;
            }

            case "unblockuser":
                if (!target) throw new VoiceError("Wähle jemanden aus.");

                settings.blocked = settings.blocked.filter((id) => id !== target.id);
                await this.Apply(channel, temp, settings);

                return `🔓 ${named} darf es wieder versuchen.`;

            case "inviteuser": {
                if (!target) throw new VoiceError("Wähle jemanden aus.");

                const invite = await channel.createInvite({ maxAge: 3600, maxUses: 1, unique: true, reason: "Temp Voice Einladung" }).catch(() => null);

                if (!invite) throw new VoiceError("Der Bot darf hier keine Einladung erstellen.");

                settings.trusted = [...new Set([...settings.trusted, target.id])].slice(0, MAX_TRUSTED);
                await this.Apply(channel, temp, settings);

                const sent = await target
                    .send({ ...InfoCard(`🔗 **${member.displayName}** lädt dich in **${channel.name}** ein.\n${invite.url}`), flags: MessageFlags.IsComponentsV2 })
                    .then(() => true)
                    .catch(() => false);

                return sent ? `🔗 Einladung an ${named} verschickt.` : `🔗 ${named} nimmt keine DMs an – schick ihm den Link selbst: ${invite.url}`;
            }

            case "kickuser": {
                if (!target) throw new VoiceError("Wähle jemanden aus.");
                if (target.id === member.id) throw new VoiceError("Dich selbst kannst du nicht rauswerfen.");
                if (target.voice.channelId !== channel.id) throw new VoiceError("Der ist gar nicht in deinem Kanal.");

                await target.voice.disconnect("Aus dem Temp-Voice geworfen");

                return `🚪 ${named} ist raus.`;
            }

            case "transferownership": {
                if (!target) throw new VoiceError("Wähle jemanden aus.");
                if (target.id === member.id) throw new VoiceError("Dir gehört er schon.");
                if (target.user.bot) throw new VoiceError("Einem Bot gehört hier nichts.");
                if (target.voice.channelId !== channel.id) throw new VoiceError("Er muss dafür in deinem Kanal sein.");

                settings.trusted = [...new Set([...settings.trusted, member.id])].slice(0, MAX_TRUSTED);

                await this.client.tempVoices.Save(channel.id, settings, target.id);
                await channel.permissionOverwrites.set(this.Overwrites(channel.guild, target.id, settings)).catch(() => undefined);

                return `🔄 Der Kanal gehört jetzt ${named}.`;
            }

            case "deletechannel":
                await channel.delete("Vom Besitzer gelöscht").catch(() => undefined);
                await this.client.tempVoices.Remove(channel.id);

                return "🗑️ Der Kanal ist weg.";

            default:
                throw new VoiceError("Unbekannte Aktion.");
        }
    }

    /* ----------------------------------------------------------
       Presets
       ---------------------------------------------------------- */
    /** Speichert, wie der Kanal gerade eingestellt ist. */
    async SavePreset(member: GuildMember, name: string): Promise<string> {
        const { temp } = await this.Mine(member);
        const clean = name.trim().slice(0, 60);

        if (!clean) throw new VoiceError("Gib dem Preset einen Namen.");

        const presets = await this.client.voicePresets.Of(member.id);

        if (presets.length >= MAX_PRESETS && !presets.some((preset) => preset.name === clean)) {
            throw new VoiceError(`Mehr als ${MAX_PRESETS} Presets gehen nicht – lösch erst eines.`);
        }

        const saved = await this.client.voicePresets.Save(member.id, clean, temp.settings);

        // Das erste Preset ist gleich das Standard-Preset - sonst bringt es nichts.
        if (presets.length === 0) await this.client.voicePresets.SetDefault(member.id, saved.id);

        return `💾 **${clean}** gespeichert${presets.length === 0 ? " und als Standard gesetzt" : ""}.`;
    }

    async ApplyPreset(member: GuildMember, id: number): Promise<string> {
        const { channel, temp } = await this.Mine(member);
        const preset = await this.client.voicePresets.Get(id);

        if (!preset || preset.userId !== member.id) throw new VoiceError("Dieses Preset gibt es nicht.");

        await this.Apply(channel, temp, { ...preset.config, name: preset.config.name ?? temp.settings.name });

        return `📌 **${preset.name}** angewandt.`;
    }

    async DeletePreset(userId: string, id: number): Promise<void> {
        const preset = await this.client.voicePresets.Get(id);

        if (!preset || preset.userId !== userId) throw new VoiceError("Dieses Preset gibt es nicht.");

        await this.client.voicePresets.Remove(id);
    }

    async DefaultPreset(userId: string, id: number | null): Promise<void> {
        if (id !== null) {
            const preset = await this.client.voicePresets.Get(id);

            if (!preset || preset.userId !== userId) throw new VoiceError("Dieses Preset gibt es nicht.");
        }

        await this.client.voicePresets.SetDefault(userId, id);
    }
}
