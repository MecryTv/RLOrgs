import { Guild, GuildMember, Message, PartialGuildMember, VoiceState } from "discord.js";
import BotClient from "../client/BotClient";
import {
    CHANNEL_DAYS,
    DAY_MS,
    DayOf,
    FLUSH_MS,
    HOUR_MS,
    HourOf,
    KEEP_DAYS,
    KEEP_MEMBER_DAYS,
    SHOW_DAYS,
    SplitSpan,
    TOP_COUNT,
    TOP_DAYS,
} from "../constants/Activity";
import { PLACEMENT_MATCHES } from "../constants/Prime";
import IDashboardActivity, {
    IActivityPerson,
    IActivityRanks,
} from "../interfaces/services/dashboard/IDashboardActivity";
import { IChannelCount, IHourCount, IMemberCount } from "../models/Activity";
import logger from "../utils/logger";

interface IVoiceSession {
    guildId: string;
    userId: string;
    since: number;
}

// Voice wird bis zum Schreiben in Millisekunden gesammelt. Auf Minuten gerundet
// wird erst beim Schreiben, der Rest bleibt für das nächste Mal liegen.
type HourBucket = IHourCount & { voiceMs: number };
type MemberBucket = IMemberCount & { voiceMs: number };

const MINUTE_MS = 60_000;

/**
 * Zählt mit, was auf den Servern passiert: Nachrichten, Minuten im Sprachkanal,
 * Beitritte und Abgänge. Nur Menschen, keine Bots - und vom Inhalt einer
 * Nachricht nichts: gezählt wird, dass sie kam.
 *
 * Bis zum Schreiben liegt alles im Arbeitsspeicher, einmal pro Minute geht es
 * gebündelt in die Datenbank. Ein Neustart kostet also höchstens diese Minute,
 * und wer beim Start schon im Sprachkanal sitzt, zählt ab dann (Warm). Siehe
 * docs/Activity.md.
 */
export default class ActivityService {
    client: BotClient;

    private hours = new Map<string, HourBucket>();
    private channels = new Map<string, IChannelCount>();
    private members = new Map<string, MemberBucket>();
    private voice = new Map<string, IVoiceSession>();
    private timer: NodeJS.Timeout | null = null;

    constructor(client: BotClient) {
        this.client = client;
    }

    // Ohne Datenbank wird gar nicht erst gesammelt: es gäbe keinen Ort, an den
    // es je ginge, und der Speicher liefe voll.
    private get Counting(): boolean {
        return this.client.databaseService.Ready;
    }

    Start(): void {
        if (this.timer) return;

        this.timer = setInterval(() => void this.Flush(), FLUSH_MS);
        this.timer.unref();
    }

    /** Beim Herunterfahren: ein letztes Mal schreiben, dann aufhören. */
    async Stop(): Promise<void> {
        if (this.timer) clearInterval(this.timer);

        this.timer = null;

        await this.Flush();
    }

    /* ----------------------------------------------------------
       Zählen
       ---------------------------------------------------------- */
    Message(message: Message): void {
        if (!this.Counting || !message.inGuild() || message.author.bot || message.system) return;

        const now = Date.now();

        // Ein Thread zählt zu seinem Kanal: er ist nach ein paar Tagen archiviert,
        // der Kanal bleibt - und unter "Aktivste Kanäle" soll der stehen.
        const channelId = message.channel.isThread()
            ? (message.channel.parentId ?? message.channelId)
            : message.channelId;

        this.Hour(message.guildId, HourOf(now)).messages++;
        this.Channel(message.guildId, channelId, DayOf(now)).messages++;
        this.Member(message.guildId, message.author.id, DayOf(now)).messages++;
    }

    Join(member: GuildMember): void {
        if (!this.Counting || member.user.bot) return;

        this.Hour(member.guild.id, HourOf(Date.now())).joins++;
    }

    Leave(member: GuildMember | PartialGuildMember): void {
        if (!this.Counting || member.user.bot) return;

        this.Hour(member.guild.id, HourOf(Date.now())).leaves++;
    }

    Voice(before: VoiceState, after: VoiceState): void {
        const member = after.member ?? before.member;

        if (!member || member.user.bot) return;

        const was = this.Talking(before);
        const is = this.Talking(after);

        // Ein Wechsel zwischen zwei Sprachkanälen ist keine neue Sitzung.
        if (was === is) return;

        if (is) this.Begin(after.guild.id, member.id);
        else this.End(before.guild.id, member.id);
    }

    /** Beim Start: wer schon im Sprachkanal sitzt, zählt ab jetzt. */
    Warm(): void {
        for (const guild of this.client.guilds.cache.values()) {
            for (const state of guild.voiceStates.cache.values()) {
                if (!state.member || state.member.user.bot || !this.Talking(state)) continue;

                this.Begin(guild.id, state.id);
            }
        }
    }

    // Jeder Sprachkanal zählt, nur der AFK-Kanal nicht - wer dort landet, ist weg.
    private Talking(state: VoiceState): boolean {
        return state.channelId !== null && state.channelId !== state.guild.afkChannelId;
    }

    private Begin(guildId: string, userId: string): void {
        const key = `${guildId}:${userId}`;

        if (!this.voice.has(key)) this.voice.set(key, { guildId, userId, since: Date.now() });
    }

    private End(guildId: string, userId: string): void {
        const key = `${guildId}:${userId}`;
        const session = this.voice.get(key);

        if (!session) return;

        this.Credit(session, Date.now());
        this.voice.delete(key);
    }

    // Rechnet eine Sprachsitzung bis "until" an und lässt sie von dort weiterlaufen.
    // Über Stunden- und Tagesgrenzen hinweg wird aufgeteilt.
    private Credit(session: IVoiceSession, until: number): void {
        if (this.Counting && until > session.since) {
            for (const part of SplitSpan(session.since, until, HOUR_MS)) {
                this.Hour(session.guildId, part.slot).voiceMs += part.ms;
            }

            for (const part of SplitSpan(session.since, until, DAY_MS)) {
                this.Member(session.guildId, session.userId, part.slot).voiceMs += part.ms;
            }
        }

        session.since = until;
    }

    private Hour(guildId: string, hour: number): HourBucket {
        const key = `${guildId}:${hour}`;
        let bucket = this.hours.get(key);

        if (!bucket) {
            bucket = { guildId, hour, messages: 0, voice: 0, joins: 0, leaves: 0, voiceMs: 0 };
            this.hours.set(key, bucket);
        }

        return bucket;
    }

    private Channel(guildId: string, channelId: string, day: number): IChannelCount {
        const key = `${guildId}:${day}:${channelId}`;
        let bucket = this.channels.get(key);

        if (!bucket) {
            bucket = { guildId, channelId, day, messages: 0 };
            this.channels.set(key, bucket);
        }

        return bucket;
    }

    private Member(guildId: string, userId: string, day: number): MemberBucket {
        const key = `${guildId}:${day}:${userId}`;
        let bucket = this.members.get(key);

        if (!bucket) {
            bucket = { guildId, userId, day, messages: 0, voice: 0, voiceMs: 0 };
            this.members.set(key, bucket);
        }

        return bucket;
    }

    /* ----------------------------------------------------------
       Schreiben
       ---------------------------------------------------------- */
    /**
     * Schreibt das Gesammelte weg. Laufende Sprachsitzungen werden bis jetzt
     * angerechnet, damit die Übersicht auch mitten in einer langen Runde stimmt.
     *
     * Abgezogen wird erst nach dem Schreiben und nur, was geschrieben wurde: was
     * währenddessen dazukommt, bleibt stehen, und ein Fehler verliert nichts -
     * der nächste Lauf versucht es mit allem erneut.
     */
    async Flush(): Promise<void> {
        const now = Date.now();

        for (const session of this.voice.values()) this.Credit(session, now);

        if (!this.Counting) {
            this.hours.clear();
            this.channels.clear();
            this.members.clear();

            return;
        }

        // Eine abgeschlossene Stunde (ein abgeschlossener Tag) bekommt nichts mehr
        // dazu - dort wird der Rest gerundet statt aufgehoben.
        const hour = HourOf(now);
        const day = DayOf(now);

        const hours = [...this.hours.values()]
            .map((bucket) => ({ ...bucket, voice: Minutes(bucket.voiceMs, bucket.hour < hour) }))
            .filter((row) => row.messages > 0 || row.voice > 0 || row.joins > 0 || row.leaves > 0);

        const channels = [...this.channels.values()].filter((row) => row.messages > 0).map((row) => ({ ...row }));

        const members = [...this.members.values()]
            .map((bucket) => ({ ...bucket, voice: Minutes(bucket.voiceMs, bucket.day < day) }))
            .filter((row) => row.messages > 0 || row.voice > 0);

        if (hours.length + channels.length + members.length > 0) {
            try {
                await this.client.activity.Add(hours, channels, members);
            } catch (error) {
                logger.warn(`📊 Aktivität nicht geschrieben, nächster Versuch in einer Minute - ${String(error)}`);

                return;
            }

            for (const row of hours) {
                const bucket = this.hours.get(`${row.guildId}:${row.hour}`);

                if (!bucket) continue;

                bucket.messages -= row.messages;
                bucket.joins -= row.joins;
                bucket.leaves -= row.leaves;
                bucket.voiceMs = Math.max(0, bucket.voiceMs - row.voice * MINUTE_MS);
            }

            for (const row of channels) {
                const bucket = this.channels.get(`${row.guildId}:${row.day}:${row.channelId}`);

                if (bucket) bucket.messages -= row.messages;
            }

            for (const row of members) {
                const bucket = this.members.get(`${row.guildId}:${row.day}:${row.userId}`);

                if (!bucket) continue;

                bucket.messages -= row.messages;
                bucket.voiceMs = Math.max(0, bucket.voiceMs - row.voice * MINUTE_MS);
            }
        }

        // Aufräumen im Speicher: leere Einträge fallen raus, vergangene Stunden
        // und Tage ganz - dort kommt nichts mehr dazu.
        for (const [key, bucket] of this.hours) {
            const idle = bucket.messages === 0 && bucket.joins === 0 && bucket.leaves === 0;

            if (idle && (bucket.hour < hour || bucket.voiceMs === 0)) this.hours.delete(key);
        }

        for (const [key, bucket] of this.channels) {
            if (bucket.messages === 0) this.channels.delete(key);
        }

        for (const [key, bucket] of this.members) {
            if (bucket.messages === 0 && (bucket.day < day || bucket.voiceMs === 0)) this.members.delete(key);
        }
    }

    /** Löscht alles, was die Aufbewahrung überschritten hat - einmal am Tag (ActivityPrune). */
    async Prune(): Promise<number> {
        const now = Date.now();

        return this.client.activity.Prune(
            HourOf(now) - KEEP_DAYS * 24,
            DayOf(now) - KEEP_DAYS,
            DayOf(now) - KEEP_MEMBER_DAYS
        );
    }

    /* ----------------------------------------------------------
       Übersicht fürs Dashboard
       ---------------------------------------------------------- */
    /**
     * Alles, was die Übersicht eines Servers zeigt. Die Stunden kommen lückenlos
     * mit Nullen aufgefüllt; was noch im Speicher liegt, fehlt - höchstens eine
     * Minute.
     */
    async Overview(guildId: string): Promise<IDashboardActivity> {
        const now = Date.now();
        const hour = HourOf(now);
        const start = hour - SHOW_DAYS * 24 + 1;
        const guild = this.client.guilds.cache.get(guildId) ?? null;
        const model = this.client.activity;

        const [rows, since, channels, chatters, talkers, ranks] = await Promise.all([
            model.Hours(guildId, start),
            model.Since(guildId),
            model.TopChannels(guildId, DayOf(now) - CHANNEL_DAYS + 1, TOP_COUNT),
            model.TopMembers(guildId, DayOf(now) - TOP_DAYS + 1, "messages", TOP_COUNT),
            model.TopMembers(guildId, DayOf(now) - TOP_DAYS + 1, "voice", TOP_COUNT),
            guild ? this.Ranks(guild) : Promise.resolve(null),
        ]);

        const length = hour - start + 1;
        const series = (): number[] => Array.from({ length }, () => 0);
        const messages = series();
        const voice = series();
        const joins = series();
        const leaves = series();

        for (const row of rows) {
            const index = Number(row.hour) - start;

            if (index < 0 || index >= length) continue;

            messages[index] = Number(row.messages);
            voice[index] = Number(row.voice);
            joins[index] = Number(row.joins);
            leaves[index] = Number(row.leaves);
        }

        const person = (row: { user_id: string; total: number }): IActivityPerson => {
            const member = guild?.members.cache.get(row.user_id);

            return {
                name: member?.displayName ?? null,
                avatar: member?.displayAvatarURL({ size: 64 }) ?? null,
                value: Number(row.total),
            };
        };

        return {
            start,
            since,
            messages,
            voice,
            joins,
            leaves,
            channels: channels.map((row) => ({
                name: guild?.channels.cache.get(row.channel_id)?.name ?? null,
                messages: Number(row.messages),
            })),
            chatters: chatters.map(person),
            talkers: talkers.map(person),
            ranks,
        };
    }

    // Die Ränge der Mitglieder mit verknüpftem Epic-Konto, je Spieler der höchste
    // über 1v1, 2v2 und 3v3. Nur mit vollständiger Mitgliederliste - sonst stünde
    // hier die Verteilung eines zufälligen Ausschnitts.
    private async Ranks(guild: Guild): Promise<IActivityRanks | null> {
        if (guild.members.cache.size < guild.memberCount) return null;

        // Jeder Spieler genau einmal - entdoppelt wird nach dem Epic-Konto, nicht
        // nach der Discord-ID: dasselbe Konto an zwei Discord-Konten ist ein
        // Spieler und darf nicht zwei Balken ergeben.
        const seen = new Set<string>();
        const linked: string[] = [];

        for (const row of await this.client.accounts.Where({ platform: "epic" })) {
            if (!guild.members.cache.has(row.user_id) || seen.has(row.account_id)) continue;

            seen.add(row.account_id);
            linked.push(row.user_id);
        }

        const known = await this.client.ranks.OfMany(linked);
        const tiers = Array.from({ length: 23 }, () => 0);

        for (const userId of linked) {
            const rows = known.get(userId);

            // Noch nie abgerufen: kein Stand, also auch kein Balken.
            if (!rows || rows.length === 0) continue;

            // Wer die Platzierungsspiele nicht durch hat, ist im Spiel Unranked - hier auch.
            const best = Math.max(...rows.map((row) => (row.placement >= PLACEMENT_MATCHES ? row.tier : 0)));

            tiers[Math.min(Math.max(best, 0), 22)]++;
        }

        return { linked: linked.length, tiers };
    }
}

// Millisekunden zu Minuten. Offen: abgerundet, der Rest wartet aufs nächste
// Schreiben. Abgeschlossen: gerundet, denn danach kommt nichts mehr dazu.
function Minutes(ms: number, closed: boolean): number {
    return closed ? Math.round(ms / MINUTE_MS) : Math.floor(ms / MINUTE_MS);
}
