import { ButtonInteraction, Guild, GuildMember, Message, MessageFlags } from "discord.js";
import BotClient from "../client/BotClient";
import { IPollTally, PollCard, VoteReply } from "../builder/CommunityView";
import {
    DefaultPollSettings,
    MAX_OPTION_NATIVE,
    MAX_OPTION_OWN,
    MAX_POLL_DESCRIPTION,
    MAX_POLL_OPTIONS,
    MAX_POLL_SECONDS,
    MAX_QUESTION,
    NATIVE_MAX_HOURS,
    NATIVE_MIN_HOURS,
    POLL_REDRAW_MS,
} from "../constants/Polls";
import { IPoll, IPollOption, IPollSettings, PollKind } from "../interfaces/services/community/ICommunity";
import logger from "../utils/logger";
import { IsLogTarget, WarmLogTarget } from "../utils/logtarget";

export class PollError extends Error {}

export const POLLS_MODULE = "polls";

export interface IPollInput {
    kind: PollKind;
    channelId: string;
    question: string;
    description?: string | null;
    options: { label: string; emoji?: string | null }[];
    settings?: Partial<IPollSettings>;
    /** Sekunden bis zum Ende - bei eigenen Umfragen darf es fehlen (dann ohne Ende). */
    duration?: number | null;
}

function IsRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Umfragen: eigene mit Knöpfen (Stimmen in poll_votes, Karte mit Balken) oder
 * Discords eigene (Discord zählt, der Bot hält am Ende das Ergebnis fest).
 * Siehe docs/Polls.md.
 */
export default class PollService {
    private readonly client: BotClient;
    // Viele Stimmen auf einmal: die Karte zeichnet höchstens alle drei Sekunden neu.
    private readonly redraws = new Map<number, NodeJS.Timeout>();

    constructor(client: BotClient) {
        this.client = client;
    }

    /* ----------------------------------------------------------
       Erstellen
       ---------------------------------------------------------- */
    /** Prüft, was aus Dashboard oder Befehl kommt - ein Fehler sagt, was fehlt. */
    Clean(guild: Guild, input: unknown): IPollInput {
        if (!IsRecord(input)) throw new PollError("Das ist keine Umfrage.");

        const kind: PollKind = input.kind === "native" ? "native" : "buttons";
        const question = typeof input.question === "string" ? input.question.trim() : "";
        const maxLabel = kind === "native" ? MAX_OPTION_NATIVE : MAX_OPTION_OWN;
        const options = (Array.isArray(input.options) ? input.options : [])
            .map((raw) => {
                const entry: Record<string, unknown> = IsRecord(raw) ? raw : { label: raw };
                const label = typeof entry.label === "string" ? entry.label.trim() : "";

                return { label: label.slice(0, maxLabel), emoji: this.client.ticketService.CleanEmoji(entry.emoji) };
            })
            .filter((option) => option.label);
        const channelId = typeof input.channelId === "string" ? input.channelId : "";

        if (!question) throw new PollError("Die Frage fehlt.");
        if (question.length > MAX_QUESTION) throw new PollError(`Die Frage darf höchstens ${MAX_QUESTION} Zeichen haben.`);
        if (options.length < 2) throw new PollError("Eine Umfrage braucht mindestens zwei Antworten.");
        if (options.length > MAX_POLL_OPTIONS) throw new PollError(`Mehr als ${MAX_POLL_OPTIONS} Antworten gehen nicht.`);
        if (new Set(options.map((option) => option.label.toLowerCase())).size !== options.length) throw new PollError("Zwei Antworten sind gleich.");
        if (!IsLogTarget(guild.channels.cache.get(channelId))) throw new PollError("Wähle einen Kanal für die Umfrage.");

        const raw = IsRecord(input.settings) ? input.settings : {};
        const base = DefaultPollSettings();
        const multi = raw.multi === true;
        const maxChoices = Math.floor(Number(raw.maxChoices));
        const settings: IPollSettings = {
            multi,
            maxChoices: multi && Number.isInteger(maxChoices) && maxChoices >= 2 && maxChoices < options.length ? maxChoices : 0,
            anonymous: kind === "buttons" && raw.anonymous === true,
            results: raw.results === "voted" || raw.results === "end" ? raw.results : base.results,
            roles: kind === "buttons" && Array.isArray(raw.roles) ? raw.roles.filter((role): role is string => typeof role === "string" && guild.roles.cache.has(role)).slice(0, 10) : [],
            ping: raw.ping === "everyone" || raw.ping === "here" || (typeof raw.ping === "string" && guild.roles.cache.has(raw.ping) && raw.ping !== guild.id) ? raw.ping : null,
            accent: typeof raw.accent === "string" && /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent.toLowerCase() : null,
        };

        const seconds = input.duration === null || input.duration === undefined || input.duration === 0 ? null : Math.floor(Number(input.duration));

        if (kind === "native") {
            if (seconds === null || !Number.isFinite(seconds) || seconds < NATIVE_MIN_HOURS * 3_600 || seconds > NATIVE_MAX_HOURS * 3_600) {
                throw new PollError("Discord-Umfragen laufen eine Stunde bis 32 Tage.");
            }
        } else if (seconds !== null && (!Number.isFinite(seconds) || seconds < 60 || seconds > MAX_POLL_SECONDS)) {
            throw new PollError("Eine Umfrage läuft mindestens eine Minute und höchstens ein Jahr - oder ohne Ende.");
        }

        return {
            kind,
            channelId,
            question,
            description: kind === "buttons" && typeof input.description === "string" ? input.description.trim().slice(0, MAX_POLL_DESCRIPTION) || null : null,
            options,
            settings,
            duration: seconds,
        };
    }

    async Create(guild: Guild, creator: GuildMember, input: unknown): Promise<IPoll> {
        if (IsRecord(input)) await WarmLogTarget(guild, input.channelId);

        const clean = this.Clean(guild, input);
        // Discord rundet auf volle Stunden.
        const duration = clean.kind === "native" ? Math.round((clean.duration ?? 3_600) / 3_600) * 3_600 : clean.duration;
        const options: IPollOption[] = clean.options.map((option, index) => ({ id: String(index + 1), label: option.label, emoji: option.emoji ?? null }));
        const poll = await this.client.polls.Create({
            guildId: guild.id,
            kind: clean.kind,
            channelId: clean.channelId,
            question: clean.question,
            description: clean.description ?? null,
            options,
            settings: { ...DefaultPollSettings(), ...clean.settings },
            createdBy: creator.id,
            endsAt: duration ? Date.now() + duration * 1000 : null,
        });

        const channel = guild.channels.cache.get(clean.channelId);

        if (!channel?.isTextBased()) throw new PollError("Diesen Kanal gibt es nicht mehr.");

        let message: Message;

        try {
            if (poll.kind === "native") {
                message = await channel.send({
                    ...(poll.settings.ping ? { content: poll.settings.ping === "everyone" || poll.settings.ping === "here" ? `@${poll.settings.ping}` : `<@&${poll.settings.ping}>` } : {}),
                    poll: {
                        question: { text: poll.question },
                        answers: poll.options.map((option) => ({ text: option.label, ...(option.emoji ? { emoji: option.emoji } : {}) })),
                        duration: Math.round((duration ?? 3_600) / 3_600),
                        allowMultiselect: poll.settings.multi,
                    },
                    allowedMentions: poll.settings.ping === "everyone" || poll.settings.ping === "here" ? { parse: ["everyone"] } : { roles: poll.settings.ping ? [poll.settings.ping] : [] },
                });
            } else {
                message = await channel.send({ ...PollCard(poll, { counts: {}, voters: 0 }, false), flags: MessageFlags.IsComponentsV2 });
            }
        } catch (error) {
            await this.client.polls.Remove(poll.id);
            logger.warn(`📊 Umfrage auf ${guild.id} nicht gesendet - ${String(error)}`);

            throw new PollError("Die Umfrage ging nicht raus – darf der Bot in den Kanal schreiben?");
        }

        await this.client.polls.SetMessage(poll.id, message.id);
        logger.user(`📊 Umfrage #${poll.number} (${poll.kind}) auf ${guild.id} gestartet (von ${creator.id})`);

        return (await this.client.polls.Get(poll.id))!;
    }

    /* ----------------------------------------------------------
       Abstimmen
       ---------------------------------------------------------- */
    async Vote(interaction: ButtonInteraction, pollId: number, optionId: string | null): Promise<void> {
        const poll = await this.client.polls.Get(pollId);

        if (!poll || poll.status !== "open" || poll.kind !== "buttons" || poll.guildId !== interaction.guildId) {
            await interaction.reply({ content: "Diese Umfrage ist beendet.", flags: MessageFlags.Ephemeral });

            return;
        }

        const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild!.members.fetch(interaction.user.id);

        if (poll.settings.roles.length && !poll.settings.roles.some((role) => member.roles.cache.has(role))) {
            await interaction.reply({ content: "Bei dieser Umfrage dürfen nur bestimmte Rollen abstimmen.", flags: MessageFlags.Ephemeral });

            return;
        }

        const current = await this.client.polls.VotesOf(poll.id, interaction.user.id);
        let next: string[];

        if (optionId === null) next = [];
        else if (!poll.options.some((option) => option.id === optionId)) next = current;
        else if (!poll.settings.multi) next = current.includes(optionId) ? [] : [optionId];
        else if (current.includes(optionId)) next = current.filter((id) => id !== optionId);
        else if (poll.settings.maxChoices && current.length >= poll.settings.maxChoices) {
            await interaction.reply({ content: `Höchstens ${poll.settings.maxChoices} Antworten - wähl erst eine ab.`, flags: MessageFlags.Ephemeral });

            return;
        } else next = [...current, optionId];

        await this.client.polls.SetVotes(poll.id, interaction.user.id, next);

        const show = poll.settings.results === "live" || poll.settings.results === "voted";
        const tally = show ? await this.client.polls.Tally(poll.id) : null;
        const reply = { ...VoteReply(poll, next, tally), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral } as const;

        // Die Antwort auf "zurückziehen" ersetzt die eigene kleine Nachricht, sonst eine neue.
        if (optionId === null && interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.update({ ...reply, flags: MessageFlags.IsComponentsV2 });
        else await interaction.reply(reply);

        this.Redraw(poll.id);
    }

    /** Zeichnet die Karte neu - gebündelt, damit viele Stimmen Discord nicht überrennen. */
    Redraw(pollId: number): void {
        if (this.redraws.has(pollId)) return;

        this.redraws.set(
            pollId,
            setTimeout(() => {
                this.redraws.delete(pollId);
                void this.Render(pollId).catch((error) => logger.warn(`📊 Umfrage ${pollId} nicht neu gezeichnet - ${String(error)}`));
            }, POLL_REDRAW_MS)
        );
    }

    private async Render(pollId: number): Promise<void> {
        const poll = await this.client.polls.Get(pollId);

        if (!poll?.messageId || poll.kind !== "buttons") return;

        const message = await this.MessageOf(poll);

        await message?.edit({ ...PollCard(poll, await this.client.polls.Tally(poll.id), poll.status === "ended"), allowedMentions: { parse: [] } });
    }

    private async MessageOf(poll: IPoll): Promise<Message | null> {
        const guild = this.client.guilds.cache.get(poll.guildId);
        const channel = guild ? (guild.channels.cache.get(poll.channelId) ?? (await guild.channels.fetch(poll.channelId).catch(() => null))) : null;

        if (!channel?.isTextBased() || !poll.messageId) return null;

        return channel.messages.fetch(poll.messageId).catch(() => null);
    }

    /* ----------------------------------------------------------
       Ergebnis und Ende
       ---------------------------------------------------------- */
    /** Stimmen je Antwort - bei Discord-Umfragen live aus der Nachricht, danach aus der Datenbank. */
    async Results(poll: IPoll): Promise<IPollTally> {
        if (poll.kind === "buttons") return this.client.polls.Tally(poll.id);
        if (poll.results) return { counts: poll.results, voters: 0 };

        const message = await this.MessageOf(poll);
        const counts: Record<string, number> = {};

        message?.poll?.answers.forEach((answer, id) => {
            counts[String(id)] = answer.voteCount;
        });

        return { counts, voters: 0 };
    }

    async End(poll: IPoll): Promise<IPoll> {
        if (poll.status === "ended") return poll;

        let results: Record<string, number> | null = null;

        if (poll.kind === "native") {
            const message = await this.MessageOf(poll);

            if (message?.poll && !message.poll.resultsFinalized && (!poll.endsAt || poll.endsAt > Date.now())) await message.poll.end().catch(() => undefined);

            results = (await this.Results(poll)).counts;
        }

        await this.client.polls.Finish(poll.id, results);

        const ended = (await this.client.polls.Get(poll.id))!;

        if (ended.kind === "buttons") await this.Render(ended.id).catch(() => undefined);

        logger.user(`📊 Umfrage #${ended.number} auf ${ended.guildId} beendet`);

        return ended;
    }

    async Delete(guild: Guild, poll: IPoll): Promise<void> {
        const message = await this.MessageOf(poll);

        await message?.delete().catch(() => undefined);
        await this.client.polls.Remove(poll.id);
        logger.user(`📊 Umfrage #${poll.number} auf ${guild.id} gelöscht`);
    }

    /** Jede Minute: abgelaufene Umfragen beenden. */
    async RunDue(): Promise<void> {
        if (!this.client.databaseService.Ready) return;

        for (const poll of await this.client.polls.Due(Date.now())) {
            // Discord braucht einen Moment, bis das Ergebnis einer eigenen Umfrage feststeht.
            if (poll.kind === "native" && poll.endsAt && Date.now() - poll.endsAt < 60_000) continue;

            await this.End(poll).catch((error) => logger.warn(`📊 Umfrage ${poll.id} nicht beendet - ${String(error)}`));
        }
    }
}
