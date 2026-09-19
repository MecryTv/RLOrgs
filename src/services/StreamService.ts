import { ActivityType, Guild, GuildMember, MessageEditOptions, MessageFlags, PermissionFlagsBits, Presence } from "discord.js";
import BotClient from "../client/BotClient";
import { CleanDoc } from "../builder/MessageDoc";
import { StreamCard, TwitchSummary } from "../builder/CommunityView";
import {
    DefaultMessage,
    DefaultStreamConfig,
    KIND_LABELS,
    MAX_NOTIFIERS,
    SEEN_MAX,
    STREAM_KINDS,
    TWITCH_CARD_EVERY,
    TwitchLogin,
    YOUTUBE_EVERY,
} from "../constants/Streams";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";
import { IStreamConfig, IStreamNotifier, IStreamState, ITwitchSettings, IYouTubeSettings, StreamKind, StreamPlatform } from "../interfaces/services/community/ICommunity";
import logger from "../utils/logger";
import { IsLogTarget, SendLog, WarmLogTarget } from "../utils/logtarget";
import TwitchApi, { ITwitchStream, Preview, TwitchError } from "../utils/twitch";
import { Feed, IFeedEntry, IsShort, LiveStates, ResolveChannel } from "../utils/youtube";

/** Was der Nutzer falsch eingegeben hat - das Dashboard zeigt den Satz. */
export class StreamError extends Error {}

export const TWITCH_MODULE = "twitch-notifier";
export const YOUTUBE_MODULE = "youtube-notifier";

function IsRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function Ago(ms: number): string {
    const minutes = Math.max(1, Math.round((Date.now() - ms) / 60_000));

    return minutes < 60 ? `vor ${minutes} Minute${minutes === 1 ? "" : "n"}` : `vor ${Math.round(minutes / 60)} Stunde${minutes < 90 ? "" : "n"}`;
}

/**
 * Twitch und YouTube Notifier. Jede Minute: wer von den Twitch-Streamern live
 * ist (eine Abfrage für bis zu 100), alle fünf Minuten die Feeds der
 * YouTube-Kanäle. Neues wird eine Karte im eingestellten Kanal, eine
 * Live-Karte zieht nach und wird am Ende zur Zusammenfassung. Dazu die
 * Live-Rolle über das Presence Intent. Siehe docs/Notifiers.md.
 */
export default class StreamService {
    private readonly client: BotClient;
    readonly twitch: TwitchApi;
    private lastYouTube = 0;
    private running = false;

    constructor(client: BotClient) {
        this.client = client;
        this.twitch = new TwitchApi(client.config.TWITCH_CLIENT_ID, client.config.TWITCH_CLIENT_SECRET);
    }

    get YouTubeLive(): boolean {
        return Boolean(this.client.config.YOUTUBE_API_KEY);
    }

    /* ----------------------------------------------------------
       Verwalten
       ---------------------------------------------------------- */
    async Add(guild: Guild, platform: StreamPlatform, input: unknown, userId: string): Promise<IStreamNotifier> {
        const text = typeof input === "string" ? input.trim().slice(0, 200) : "";

        if (!text) throw new StreamError(platform === "twitch" ? "Gib einen Twitch-Namen oder Link an." : "Gib einen YouTube-Kanal an: Link, @Name oder Kanal-ID.");
        if ((await this.client.streamNotifiers.OfGuild(guild.id, platform)).length >= MAX_NOTIFIERS) {
            throw new StreamError(`Mehr als ${MAX_NOTIFIERS} geht je Server nicht.`);
        }

        const account = platform === "twitch" ? await this.TwitchAccount(text) : await this.YouTubeAccount(text);

        if ((await this.client.streamNotifiers.OfGuild(guild.id, platform)).some((entry) => entry.accountId === account.id)) {
            throw new StreamError(`${account.name} steht schon in der Liste.`);
        }

        const state: IStreamState = {};
        const config = DefaultStreamConfig(platform);

        // Hat jemand diesen Kanal in Discord verknüpft und ist er hier Mitglied,
        // steht er gleich am Eintrag - sonst wählt ihn jemand im Dashboard.
        const linked = await this.client.userConnections.ByAccount(platform, account.id).catch(() => null);

        if (linked && guild.members.cache.has(linked.userId)) config.userId = linked.userId;

        // YouTube: was jetzt schon im Feed steht, ist nicht neu - sonst käme eine Flut alter Videos.
        if (platform === "youtube") state.seen = (await Feed(account.id))?.entries.map((entry) => entry.id) ?? [];

        const created = await this.client.streamNotifiers.Create({
            guildId: guild.id,
            platform,
            accountId: account.id,
            accountName: account.name,
            accountLogin: account.login,
            avatar: account.avatar,
            config,
            state,
            createdBy: userId,
        });

        logger.user(`📡 ${platform} ${account.name} auf ${guild.id} hinzugefügt (von ${userId})`);

        return created;
    }

    private async TwitchAccount(text: string): Promise<{ id: string; name: string; login: string; avatar: string | null }> {
        const login = TwitchLogin(text);

        if (!login) throw new StreamError("Das sieht nicht nach einem Twitch-Namen aus.");
        if (!this.twitch.Ready) throw new StreamError("Für Twitch fehlen TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET in der .env des Bots.");

        const user = await this.twitch.UserByLogin(login).catch((error) => {
            throw new StreamError(error instanceof TwitchError ? error.message : "Twitch antwortet gerade nicht.");
        });

        if (!user) throw new StreamError(`Auf Twitch gibt es niemanden namens „${login}“.`);

        return { id: user.id, name: user.display_name, login: user.login, avatar: user.profile_image_url || null };
    }

    private async YouTubeAccount(text: string): Promise<{ id: string; name: string; login: string | null; avatar: string | null }> {
        const channel = await ResolveChannel(text, this.client.config.YOUTUBE_API_KEY);

        if (!channel) throw new StreamError("Diesen YouTube-Kanal finde ich nicht – am sichersten ist der Link zum Kanal oder die Kanal-ID (UC…).");

        return { id: channel.id, name: channel.title, login: channel.handle, avatar: channel.avatar };
    }

    /** Was das Dashboard schickt, wird zu gültigen Einstellungen - was nicht passt, fällt weg. */
    Clean(guild: Guild, platform: StreamPlatform, input: unknown, previous: IStreamConfig): IStreamConfig {
        if (!IsRecord(input)) throw new StreamError("Das sind keine gültigen Einstellungen.");

        const allowed = STREAM_KINDS[platform];
        const ping = input.ping;
        const messages: Partial<Record<StreamKind, IMessageDoc>> = {};
        const raw = IsRecord(input.messages) ? input.messages : {};

        for (const kind of allowed) {
            const doc = raw[kind] === undefined ? previous.messages[kind] : CleanDoc(raw[kind], guild.id);

            if (doc && doc.blocks.length) messages[kind] = doc;
        }

        return {
            channelId:
                input.channelId === undefined
                    ? previous.channelId
                    : typeof input.channelId === "string" && IsLogTarget(guild.channels.cache.get(input.channelId))
                      ? input.channelId
                      : null,
            ping:
                ping === undefined
                    ? previous.ping
                    : ping === "everyone" || ping === "here"
                      ? ping
                      : typeof ping === "string" && guild.roles.cache.has(ping) && ping !== guild.id
                        ? ping
                        : null,
            kinds: Array.isArray(input.kinds) ? allowed.filter((kind) => (input.kinds as unknown[]).includes(kind)) : previous.kinds,
            userId:
                input.userId === undefined
                    ? previous.userId
                    : typeof input.userId === "string" && guild.members.cache.has(input.userId)
                      ? input.userId
                      : null,
            messages,
            update: typeof input.update === "boolean" ? input.update : previous.update,
            ended: input.ended === "summary" || input.ended === "delete" || input.ended === "keep" ? input.ended : previous.ended,
        };
    }

    async Save(guild: Guild, id: number, input: unknown): Promise<IStreamNotifier> {
        const notifier = await this.Own(guild, id);

        if (IsRecord(input)) await WarmLogTarget(guild, input.channelId);

        const config = this.Clean(guild, notifier.platform, input, notifier.config);
        const enabled = IsRecord(input) && typeof input.enabled === "boolean" ? input.enabled : notifier.enabled;

        await this.client.streamNotifiers.SaveConfig(id, config, enabled);

        return (await this.client.streamNotifiers.Get(id))!;
    }

    async Remove(guild: Guild, id: number): Promise<void> {
        await this.Own(guild, id);
        await this.client.streamNotifiers.Delete(id);
    }

    private async Own(guild: Guild, id: number): Promise<IStreamNotifier> {
        const notifier = Number.isInteger(id) ? await this.client.streamNotifiers.Get(id) : null;

        if (!notifier || notifier.guildId !== guild.id) throw new StreamError("Diesen Eintrag gibt es nicht mehr.");

        return notifier;
    }

    /** Eine Probe mit Beispielwerten in den eingestellten Kanal. */
    async Test(guild: Guild, id: number, kind: StreamKind): Promise<void> {
        const notifier = await this.Own(guild, id);

        if (!notifier.config.channelId) throw new StreamError("Wähle zuerst einen Kanal.");

        const values =
            notifier.platform === "twitch"
                ? this.TwitchValues(guild, notifier, {
                      title: "Testmeldung aus dem Dashboard",
                      game: "Rocket League",
                      viewers: 42,
                      startedAt: Date.now(),
                      preview: notifier.avatar,
                  })
                : this.YouTubeValues(guild, notifier, {
                      id: "dQw4w9WgXcQ",
                      title: "Testmeldung aus dem Dashboard",
                      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                      published: Date.now(),
                      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
                      short: kind === "short",
                  }, kind);
        const view = await this.Card(notifier, kind, values, "🧪 Test aus dem Dashboard – so sieht die echte Meldung aus.");
        const sent = await SendLog(guild, notifier.config.channelId, { ...view, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

        if (!sent) throw new StreamError("Die Nachricht ging nicht raus – darf der Bot in den Kanal schreiben?");
    }

    /* ----------------------------------------------------------
       Nachrichten
       ---------------------------------------------------------- */
    MessageOf(notifier: IStreamNotifier, kind: StreamKind): IMessageDoc {
        return notifier.config.messages[kind] ?? DefaultMessage(notifier.platform, kind);
    }

    private TwitchValues(
        guild: Guild,
        notifier: IStreamNotifier,
        stream: { title: string; game: string; viewers: number; startedAt: number; preview: string | null }
    ): Record<string, string> {
        return {
            streamer: notifier.accountName,
            "streamer.login": notifier.accountLogin ?? "",
            "streamer.avatar": notifier.avatar ?? "",
            "stream.title": stream.title || "Ohne Titel",
            "stream.game": stream.game || "–",
            "stream.url": `https://twitch.tv/${notifier.accountLogin ?? ""}`,
            "stream.viewers": String(stream.viewers),
            "stream.preview": stream.preview ?? "",
            "stream.started": `<t:${Math.floor(stream.startedAt / 1000)}:R>`,
            "streamer.mention": notifier.config.userId ? `<@${notifier.config.userId}>` : "",
            guild: guild.name,
        };
    }

    private YouTubeValues(guild: Guild, notifier: IStreamNotifier, entry: IFeedEntry, kind: StreamKind): Record<string, string> {
        return {
            channel: notifier.accountName,
            "channel.avatar": notifier.avatar ?? "",
            "video.title": entry.title,
            "video.url": kind === "short" ? `https://www.youtube.com/shorts/${entry.id}` : `https://www.youtube.com/watch?v=${entry.id}`,
            "video.thumbnail": entry.thumbnail,
            "video.kind": KIND_LABELS[kind],
            "video.published": `<t:${Math.floor((entry.published || Date.now()) / 1000)}:R>`,
            "channel.mention": notifier.config.userId ? `<@${notifier.config.userId}>` : "",
            guild: guild.name,
        };
    }

    private Card(notifier: IStreamNotifier, kind: StreamKind, values: Record<string, string>, footer?: string) {
        const button =
            notifier.platform === "twitch"
                ? { url: values["stream.url"], label: "Zum Stream", emoji: "📺" }
                : { url: values["video.url"], label: kind === "live" ? "Zum Livestream" : "Ansehen", emoji: "▶️" };

        return StreamCard(this.client, this.MessageOf(notifier, kind), values, { ping: notifier.config.ping, button, footer });
    }

    /* ----------------------------------------------------------
       Jede Minute
       ---------------------------------------------------------- */
    async RunDue(): Promise<void> {
        if (!this.client.databaseService.Ready || this.running) return;

        this.running = true;

        try {
            if (this.twitch.Ready) await this.CheckTwitch();

            if (Date.now() - this.lastYouTube >= YOUTUBE_EVERY) {
                this.lastYouTube = Date.now();
                await this.CheckYouTube();
            }
        } finally {
            this.running = false;
        }
    }

    /** Nur Server, auf denen der Bot ist und das Modul an. */
    private async Live(notifiers: IStreamNotifier[], module: string): Promise<IStreamNotifier[]> {
        if (notifiers.length === 0) return [];

        const modules = await this.client.settings.ModulesOf([...new Set(notifiers.map((entry) => entry.guildId))]);

        return notifiers.filter((entry) => this.client.guilds.cache.has(entry.guildId) && (modules.get(entry.guildId) ?? []).includes(module));
    }

    private async CheckTwitch(): Promise<void> {
        const notifiers = await this.Live(await this.client.streamNotifiers.Active("twitch"), TWITCH_MODULE);

        if (notifiers.length === 0) return;

        let streams: ITwitchStream[];

        try {
            streams = await this.twitch.Streams([...new Set(notifiers.map((entry) => entry.accountId))]);
        } catch (error) {
            logger.warn(`📡 Twitch nicht erreichbar - ${String(error)}`);

            return;
        }

        const live = new Map(streams.map((stream) => [stream.user_id, stream]));

        for (const notifier of notifiers) {
            await this.TwitchStep(notifier, live.get(notifier.accountId) ?? null).catch((error) =>
                logger.warn(`📡 Twitch ${notifier.accountName} auf ${notifier.guildId} - ${String(error)}`)
            );
        }
    }

    private async TwitchStep(notifier: IStreamNotifier, stream: ITwitchStream | null): Promise<void> {
        const guild = this.client.guilds.cache.get(notifier.guildId)!;
        const state = { ...notifier.state };
        const now = Date.now();

        // Ein anderer Stream als gemerkt (Neustart), oder keiner mehr: der alte ist vorbei.
        if (state.live && (!stream || stream.id !== state.live.streamId)) {
            await this.TwitchEnded(guild, notifier, state.live);
            state.lastLiveAt = now;
            state.live = null;

            if (!stream) await this.LinkedRole(guild, notifier, false);
        }

        if (stream && !state.live) {
            const startedAt = Date.parse(stream.started_at) || now;
            const values = this.TwitchValues(guild, notifier, {
                title: stream.title,
                game: stream.game_name,
                viewers: stream.viewer_count,
                startedAt,
                preview: Preview(stream, now),
            });
            const message = notifier.config.channelId && notifier.config.kinds.includes("live")
                ? await SendLog(guild, notifier.config.channelId, { ...(await this.Card(notifier, "live", values)), flags: MessageFlags.IsComponentsV2 })
                : null;

            await this.LinkedRole(guild, notifier, true);

            state.problem = notifier.config.channelId && !message ? "Die Live-Karte ging nicht raus – darf der Bot in den Kanal schreiben?" : null;
            state.live = {
                streamId: stream.id,
                messageId: message?.id ?? null,
                channelId: message?.channelId ?? null,
                startedAt,
                title: stream.title,
                game: stream.game_name,
                viewers: stream.viewer_count,
                peak: stream.viewer_count,
                renderedAt: now,
            };
        } else if (stream && state.live) {
            const changed = stream.title !== state.live.title || stream.game_name !== state.live.game;

            state.live = {
                ...state.live,
                title: stream.title,
                game: stream.game_name,
                viewers: stream.viewer_count,
                peak: Math.max(state.live.peak, stream.viewer_count),
            };

            // Titel oder Spiel neu: gleich. Sonst höchstens alle fünf Minuten - Zuschauer und Bild.
            if (notifier.config.update && state.live.messageId && (changed || now - state.live.renderedAt >= TWITCH_CARD_EVERY)) {
                const values = this.TwitchValues(guild, notifier, {
                    title: stream.title,
                    game: stream.game_name,
                    viewers: stream.viewer_count,
                    startedAt: state.live.startedAt,
                    preview: Preview(stream, now),
                });
                const view = await this.Card(notifier, "live", values);

                await this.Edit(guild, state.live.channelId, state.live.messageId, { components: view.components, files: view.files, attachments: [], allowedMentions: { parse: [] } });
                state.live.renderedAt = now;
            }
        } else if (!stream && !notifier.state.live) {
            return;
        }

        await this.client.streamNotifiers.SaveState(notifier.id, state);
    }

    private async TwitchEnded(guild: Guild, notifier: IStreamNotifier, live: NonNullable<IStreamState["live"]>): Promise<void> {
        if (!live.messageId || notifier.config.ended === "keep") return;

        if (notifier.config.ended === "delete") {
            const channel = live.channelId ? (guild.channels.cache.get(live.channelId) ?? (await guild.channels.fetch(live.channelId).catch(() => null))) : null;

            if (channel?.isTextBased()) await channel.messages.delete(live.messageId).catch(() => undefined);

            return;
        }

        const vod = await this.twitch.Vod(notifier.accountId, live.streamId);
        const view = TwitchSummary({
            streamer: notifier.accountName,
            title: live.title,
            game: live.game,
            startedAt: live.startedAt,
            endedAt: Date.now(),
            peak: live.peak,
            avatar: notifier.avatar,
            url: `https://twitch.tv/${notifier.accountLogin ?? ""}`,
            vod,
        });

        await this.Edit(guild, live.channelId, live.messageId, { components: view.components, attachments: [], allowedMentions: { parse: [] } });
    }

    private async Edit(guild: Guild, channelId: string | null, messageId: string, payload: MessageEditOptions): Promise<void> {
        const channel = channelId ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null))) : null;

        if (!channel?.isTextBased()) return;

        const message = await channel.messages.fetch(messageId).catch(() => null);

        await message?.edit(payload).catch(() => undefined);
    }

    private async CheckYouTube(): Promise<void> {
        const notifiers = await this.Live(await this.client.streamNotifiers.Active("youtube"), YOUTUBE_MODULE);
        const byChannel = new Map<string, IStreamNotifier[]>();

        for (const notifier of notifiers) byChannel.set(notifier.accountId, [...(byChannel.get(notifier.accountId) ?? []), notifier]);

        for (const [channelId, list] of byChannel) {
            const feed = await Feed(channelId);

            if (!feed) continue;

            // Neu ist, was ein Eintrag noch nicht kennt - jünger als zwei Tage, alte tauchen sonst nach Löschungen wieder auf.
            const fresh = feed.entries.filter((entry) => Date.now() - entry.published < 2 * 86_400_000);
            const unknown = fresh.filter((entry) => list.some((notifier) => !(notifier.state.seen ?? []).includes(entry.id)));
            const waiting = [...new Set(list.flatMap((notifier) => [...(notifier.state.upcoming ?? []), ...(notifier.state.liveVideo ? [notifier.state.liveVideo] : [])]))];
            const states = this.YouTubeLive && (unknown.length || waiting.length)
                ? await LiveStates([...new Set([...unknown.map((entry) => entry.id), ...waiting])], this.client.config.YOUTUBE_API_KEY)
                : new Map<string, "live" | "upcoming" | "none">();

            for (const notifier of list) {
                await this.YouTubeStep(notifier, fresh, states).catch((error) =>
                    logger.warn(`📡 YouTube ${notifier.accountName} auf ${notifier.guildId} - ${String(error)}`)
                );
            }
        }
    }

    private async YouTubeStep(notifier: IStreamNotifier, entries: IFeedEntry[], states: Map<string, "live" | "upcoming" | "none">): Promise<void> {
        const guild = this.client.guilds.cache.get(notifier.guildId)!;
        const seen = new Set(notifier.state.seen ?? []);
        const upcoming = new Set(notifier.state.upcoming ?? []);
        let last = notifier.state.last ?? null;
        let liveVideo = notifier.state.liveVideo ?? null;
        let problem: string | null = null;
        let changed = false;

        // Der gemeldete Livestream ist vorbei: die Live-Rolle geht zurück.
        if (liveVideo && states.get(liveVideo) !== "live") {
            liveVideo = null;
            changed = true;

            await this.LinkedRole(guild, notifier, false);
        }

        // Älteste zuerst - so stehen sie in Discord in der richtigen Reihenfolge.
        for (const entry of [...entries].reverse()) {
            const state = states.get(entry.id);
            const isNew = !seen.has(entry.id);

            if (!isNew && !(upcoming.has(entry.id) && state === "live")) continue;

            changed = true;
            seen.add(entry.id);

            // Angekündigt, aber noch nicht live: später nochmal nachsehen.
            if (state === "upcoming") {
                upcoming.add(entry.id);
                continue;
            }

            upcoming.delete(entry.id);

            const kind: StreamKind = state === "live" ? "live" : (await IsShort(entry)) ? "short" : "video";

            if (!notifier.config.kinds.includes(kind) || !notifier.config.channelId) continue;

            const view = await this.Card(notifier, kind, this.YouTubeValues(guild, notifier, entry, kind));
            const sent = await SendLog(guild, notifier.config.channelId, { ...view, flags: MessageFlags.IsComponentsV2 });

            if (sent) last = { id: entry.id, title: entry.title, kind, at: Date.now() };
            else problem = "Die Meldung ging nicht raus – darf der Bot in den Kanal schreiben?";

            if (kind === "live") {
                liveVideo = entry.id;

                await this.LinkedRole(guild, notifier, true);
            }
        }

        if (!changed) return;

        await this.client.streamNotifiers.SaveState(notifier.id, {
            ...notifier.state,
            seen: [...seen].slice(-SEEN_MAX),
            upcoming: [...upcoming].slice(-20),
            last,
            liveVideo,
            problem,
        });
    }

    /* ----------------------------------------------------------
       Live-Rolle (Presence Intent)
       ---------------------------------------------------------- */
    TwitchSettings(guildId: string): Promise<ITwitchSettings> {
        return this.client.moduleSettings.Of<ITwitchSettings>(guildId, TWITCH_MODULE, { liveRoleId: null, liveRoleFilter: null });
    }

    YouTubeSettings(guildId: string): Promise<IYouTubeSettings> {
        return this.client.moduleSettings.Of<IYouTubeSettings>(guildId, YOUTUBE_MODULE, { liveRoleId: null });
    }

    async SaveTwitchSettings(guild: Guild, input: unknown): Promise<ITwitchSettings> {
        const raw = IsRecord(input) ? input : {};
        const role = (value: unknown): string | null => (typeof value === "string" && guild.roles.cache.has(value) && value !== guild.id ? value : null);
        const settings: ITwitchSettings = { liveRoleId: role(raw.liveRoleId), liveRoleFilter: role(raw.liveRoleFilter) };

        this.CheckLiveRole(guild, settings.liveRoleId);
        await this.client.moduleSettings.Save(guild.id, TWITCH_MODULE, settings);

        return settings;
    }

    async SaveYouTubeSettings(guild: Guild, input: unknown): Promise<IYouTubeSettings> {
        const raw = IsRecord(input) ? input : {};
        const id = typeof raw.liveRoleId === "string" && guild.roles.cache.has(raw.liveRoleId) && raw.liveRoleId !== guild.id ? raw.liveRoleId : null;

        this.CheckLiveRole(guild, id);
        await this.client.moduleSettings.Save(guild.id, YOUTUBE_MODULE, { liveRoleId: id });

        return { liveRoleId: id };
    }

    /** Kann der Bot diese Rolle überhaupt vergeben? Sonst sagt das Dashboard, woran es liegt. */
    private CheckLiveRole(guild: Guild, roleId: string | null): void {
        if (!roleId) return;

        const target = guild.roles.cache.get(roleId)!;
        const me = guild.members.me;

        if (target.managed) throw new StreamError("Diese Rolle verwaltet eine Integration – der Bot kann sie nicht vergeben.");
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || target.comparePositionTo(me.roles.highest) >= 0) {
            throw new StreamError(`Die Live-Rolle @${target.name} muss unter der höchsten Rolle des Bots stehen, und er braucht „Rollen verwalten“.`);
        }
    }

    /**
     * Die Live-Rolle für den verknüpften User eines Eintrags - unabhängig von
     * der Presence: bei YouTube gibt es keine, und bei Twitch streamt nicht
     * jeder mit sichtbarem Status.
     */
    private async LinkedRole(guild: Guild, notifier: IStreamNotifier, live: boolean): Promise<void> {
        const userId = notifier.config.userId;

        if (!userId) return;

        const roleId = notifier.platform === "twitch" ? (await this.TwitchSettings(guild.id)).liveRoleId : (await this.YouTubeSettings(guild.id)).liveRoleId;

        if (!roleId) return;

        const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));

        if (member) await this.LiveRole(member, roleId, live);
    }

    /** Streamt jemand auf Twitch (Discords Streaming-Status), bekommt er die Live-Rolle - und verliert sie danach. */
    async Presence(presence: Presence): Promise<void> {
        const member = presence.member;

        if (!member || !presence.guild || !this.client.databaseService.Ready) return;
        if (!(await this.client.settings.Of(presence.guild.id)).modules.includes(TWITCH_MODULE)) return;

        const streaming = presence.activities.find((activity) => activity.type === ActivityType.Streaming && /twitch\.tv/i.test(activity.url ?? ""));

        if (streaming?.url) await this.LearnLink(presence.guild, member, streaming.url).catch(() => undefined);

        const { liveRoleId, liveRoleFilter } = await this.TwitchSettings(presence.guild.id);

        if (!liveRoleId) return;

        const wanted = Boolean(streaming) && (!liveRoleFilter || member.roles.cache.has(liveRoleFilter));

        await this.LiveRole(member, liveRoleId, wanted);
    }

    /**
     * Streamt jemand sichtbar unter dem Namen eines Eintrags, gehört der Eintrag
     * ihm - dann steht der Discord-User da, ohne dass ihn jemand auswählt.
     * Einmal gesetzt, bleibt er: überschrieben wird nie.
     */
    private async LearnLink(guild: Guild, member: GuildMember, url: string): Promise<void> {
        const login = TwitchLogin(url);

        if (!login) return;

        for (const notifier of await this.client.streamNotifiers.OfGuild(guild.id, "twitch")) {
            if (notifier.config.userId || notifier.accountLogin?.toLowerCase() !== login) continue;

            await this.client.streamNotifiers.SaveConfig(notifier.id, { ...notifier.config, userId: member.id }, notifier.enabled);
            logger.user(`📡 Twitch ${notifier.accountName} auf ${guild.id} gehört ${member.id} (aus dem Streaming-Status)`);
        }
    }

    private async LiveRole(member: GuildMember, roleId: string, wanted: boolean): Promise<void> {
        const has = member.roles.cache.has(roleId);

        if (wanted && !has) await member.roles.add(roleId, "Live auf Twitch").catch(() => undefined);
        if (!wanted && has) await member.roles.remove(roleId, "Nicht mehr live auf Twitch").catch(() => undefined);
    }

    /** "live seit 20 Minuten" oder "zuletzt vor 2 Stunden" - für das Dashboard. */
    Status(notifier: IStreamNotifier): string {
        if (notifier.platform === "twitch") {
            if (notifier.state.live) return `live seit ${Ago(notifier.state.live.startedAt).replace("vor ", "")}`;

            return notifier.state.lastLiveAt ? `zuletzt live ${Ago(notifier.state.lastLiveAt)}` : "offline";
        }

        return notifier.state.last ? `${KIND_LABELS[notifier.state.last.kind]} ${Ago(notifier.state.last.at)}` : "noch nichts gemeldet";
    }
}
