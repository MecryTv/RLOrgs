import { AttachmentBuilder, ContainerBuilder, escapeMarkdown, MessageMentionOptions } from "discord.js";
import BotClient from "../client/BotClient";
import ComponentV2Builder from "./ComponentV2Builder";
import { RenderDoc } from "./MessageDoc";
import { GIVEAWAY_ACCENT, GIVEAWAY_PREFIX } from "../constants/Giveaways";
import { AnyPlaceholderValues } from "../constants/Placeholders";
import { Bar, POLL_ACCENT, POLL_PREFIX } from "../constants/Polls";
import { FormatDuration } from "../constants/Moderation";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";
import { IGiveaway, IPoll } from "../interfaces/services/community/ICommunity";

/**
 * Wie Twitch- und YouTube-Meldungen, Umfragen und Giveaways in Discord
 * aussehen - alles Components V2. Die Logik steht in den Diensten; hier wird
 * nur gezeichnet.
 */

export interface ICommunityView {
    components: ContainerBuilder[];
    files?: AttachmentBuilder[];
    allowedMentions: MessageMentionOptions;
}

const ENDED = "#4b5563";

function Stamp(ms: number, style = "f"): string {
    return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/** "everyone", "here" oder eine Rollen-ID - als Text und als Erlaubnis zum Pingen. */
export function Ping(ping: string | null): { text: string | null; mentions: MessageMentionOptions } {
    if (ping === "everyone" || ping === "here") return { text: `@${ping}`, mentions: { parse: ["everyone"] } };
    if (ping && /^\d{17,20}$/.test(ping)) return { text: `<@&${ping}>`, mentions: { roles: [ping] } };

    return { text: null, mentions: { parse: [] } };
}

/* ----------------------------------------------------------
   Twitch und YouTube
   ---------------------------------------------------------- */
/** Die eigene Nachricht mit Ping oben und dem Knopf unten. */
export async function StreamCard(
    client: BotClient,
    doc: IMessageDoc,
    values: AnyPlaceholderValues,
    options: { ping: string | null; button: { url: string; label: string; emoji: string }; footer?: string }
): Promise<ICommunityView> {
    const ping = Ping(options.ping);
    const full: IMessageDoc = ping.text ? { ...doc, blocks: [{ type: "text", body: ping.text }, ...doc.blocks] } : doc;
    const { builder, files } = await RenderDoc(client, full, values, { reserve: options.footer ? 3 : 2, fallback: "Neu!" });

    if (options.footer) builder.subtext(options.footer);

    builder.buttons({ url: options.button.url, label: options.button.label, emoji: options.button.emoji });

    return { components: [builder.build()], files, allowedMentions: ping.mentions };
}

/** Nach dem Stream: die Karte wird zur Zusammenfassung. */
export function TwitchSummary(data: {
    streamer: string;
    title: string;
    game: string;
    startedAt: number;
    endedAt: number;
    peak: number;
    avatar: string | null;
    url: string;
    vod: string | null;
}): ICommunityView {
    const body = [
        `### ⚫ ${escapeMarkdown(data.streamer)} war live`,
        `**${escapeMarkdown(data.title || "Ohne Titel")}**`,
        `🎮 ${escapeMarkdown(data.game || "–")} · ⏱️ ${FormatDuration(Math.max(60, Math.round((data.endedAt - data.startedAt) / 1000)))} · 👀 bis zu ${data.peak} Zuschauer`,
    ].join("\n");
    const builder = new ComponentV2Builder({ accentColor: ENDED as `#${string}` });

    if (data.avatar) builder.section(body, { type: "thumbnail", url: data.avatar });
    else builder.text(body);

    builder
        .subtext(`Gestreamt ${Stamp(data.startedAt)} bis ${Stamp(data.endedAt, "t")}`)
        .buttons(data.vod ? { url: data.vod, label: "Zum VOD", emoji: "🎬" } : { url: data.url, label: "Zum Kanal", emoji: "📺" });

    return { components: [builder.build()], allowedMentions: { parse: [] } };
}

/* ----------------------------------------------------------
   Umfragen
   ---------------------------------------------------------- */
export interface IPollTally {
    counts: Record<string, number>;
    voters: number;
}

/** Die Karte einer eigenen Umfrage. final: beendet - Balken für alle, keine Knöpfe mehr. */
export function PollCard(poll: IPoll, tally: IPollTally, final: boolean): ICommunityView {
    const { settings } = poll;
    const ping = Ping(settings.ping);
    const builder = new ComponentV2Builder({ accentColor: (final ? ENDED : (settings.accent ?? POLL_ACCENT)) as `#${string}` });
    const total = Object.values(tally.counts).reduce((sum, count) => sum + count, 0);
    const best = Math.max(0, ...poll.options.map((option) => tally.counts[option.id] ?? 0));
    const show = final || settings.results === "live";
    const facts = [
        `Umfrage #${poll.number}`,
        settings.multi ? (settings.maxChoices ? `bis zu ${settings.maxChoices} Antworten` : "mehrere Antworten") : "eine Antwort",
        ...(settings.anonymous ? ["anonym"] : []),
        ...(settings.roles.length ? ["nur für bestimmte Rollen"] : []),
        final ? `beendet ${poll.endedAt ? Stamp(poll.endedAt, "R") : ""}`.trim() : poll.endsAt ? `endet ${Stamp(poll.endsAt, "R")}` : "ohne Ende",
    ];

    if (ping.text && !final) builder.text(ping.text);

    builder.text(`## 📊 ${escapeMarkdown(poll.question)}${poll.description ? `\n${poll.description}` : ""}`).subtext(facts.join(" · ")).separator();

    const lines = poll.options.map((option) => {
        const count = tally.counts[option.id] ?? 0;
        const share = total ? count / total : 0;
        const head = `${option.emoji ? `${option.emoji} ` : ""}${final && count === best && best > 0 ? "🏆 " : ""}**${escapeMarkdown(option.label)}**`;

        return show ? `${head}\n\`${Bar(share)}\` ${count} · ${Math.round(share * 100)} %` : head;
    });

    builder.text(lines.join("\n"));
    builder.subtext(
        show
            ? `${total} ${total === 1 ? "Stimme" : "Stimmen"} von ${tally.voters} ${tally.voters === 1 ? "Person" : "Personen"}`
            : `${tally.voters} ${tally.voters === 1 ? "Person hat" : "Personen haben"} abgestimmt · Ergebnis ${settings.results === "voted" ? "nach deiner Stimme" : "am Ende"}`
    );

    if (!final) {
        for (let index = 0; index < poll.options.length; index += 5) {
            builder.buttons(
                ...poll.options.slice(index, index + 5).map((option) => ({
                    customId: `${POLL_PREFIX}:vote:${poll.id}:${option.id}`,
                    label: option.label.slice(0, 80),
                    ...(option.emoji ? { emoji: option.emoji } : {}),
                }))
            );
        }
    }

    return { components: [builder.build()], allowedMentions: final ? { parse: [] } : ping.mentions };
}

/** Die Antwort nach einer Stimme - nur für den Wählenden. Mit Balken, wenn er sie sehen darf. */
export function VoteReply(poll: IPoll, mine: string[], tally: IPollTally | null): ICommunityView {
    const chosen = poll.options.filter((option) => mine.includes(option.id));
    const builder = new ComponentV2Builder({ accentColor: (poll.settings.accent ?? POLL_ACCENT) as `#${string}` }).text(
        chosen.length
            ? `✅ Deine Stimme: ${chosen.map((option) => `**${escapeMarkdown(option.label)}**`).join(", ")}`
            : "↩️ Deine Stimme ist zurückgezogen."
    );

    if (tally) {
        const total = Object.values(tally.counts).reduce((sum, count) => sum + count, 0);

        builder.text(
            poll.options
                .map((option) => {
                    const count = tally.counts[option.id] ?? 0;

                    return `${escapeMarkdown(option.label)}\n\`${Bar(total ? count / total : 0, 10)}\` ${count}`;
                })
                .join("\n")
        );
    }

    builder.subtext(poll.settings.multi ? "Klick eine Antwort nochmal an, um sie abzuwählen." : "Klick eine andere Antwort, um umzustimmen - dieselbe nochmal zieht zurück.");

    if (chosen.length) builder.buttons({ customId: `${POLL_PREFIX}:clear:${poll.id}`, label: "Stimme zurückziehen", emoji: "↩️" });

    return { components: [builder.build()], allowedMentions: { parse: [] } };
}

/* ----------------------------------------------------------
   Giveaways
   ---------------------------------------------------------- */
export function GiveawayCard(giveaway: IGiveaway, entries: number, rules: string[], bonus: string[]): ICommunityView {
    const running = giveaway.status === "running";
    const ping = Ping(giveaway.settings.ping);
    const builder = new ComponentV2Builder({ accentColor: (running ? (giveaway.settings.accent ?? GIVEAWAY_ACCENT) : ENDED) as `#${string}` });

    if (ping.text && running) builder.text(ping.text);

    builder.text(
        `## 🎉 ${escapeMarkdown(giveaway.prize)}${running ? "" : giveaway.status === "cancelled" ? " – abgebrochen" : " – beendet"}${
            giveaway.description ? `\n${giveaway.description}` : ""
        }`
    );

    if (giveaway.image?.startsWith("https://")) builder.gallery(giveaway.image);

    builder.separator();

    if (running) {
        const lines = [
            `🏆 **${giveaway.winners} Gewinner** · ⏰ endet ${Stamp(giveaway.endsAt, "R")} (${Stamp(giveaway.endsAt)})`,
            `👤 Veranstaltet von <@${giveaway.hostId}>`,
        ];

        if (rules.length) lines.push("", "**Bedingungen**", ...rules.map((rule) => `• ${rule}`));
        if (bonus.length) lines.push("", "**Bonus-Lose**", ...bonus.map((line) => `• ${line}`));

        builder.text(lines.join("\n"));
    } else if (giveaway.status === "ended") {
        const winners = giveaway.results.winners.filter((winner) => winner.status !== "replaced" && winner.status !== "expired");

        builder.text(
            winners.length
                ? `🏆 **Gewinner:** ${winners
                      .map((winner) => `<@${winner.userId}>${winner.status === "claimed" ? " ✅" : winner.status === "pending" && winner.deadline ? ` ⏳ bis ${Stamp(winner.deadline, "R")}` : ""}`)
                      .join(", ")}`
                : "Niemand hat die Bedingungen erfüllt – keine Gewinner."
        );
    } else {
        builder.text("Dieses Giveaway wurde abgebrochen.");
    }

    builder.separator().subtext(
        `${entries} Teilnehmer · Giveaway #${giveaway.number}${giveaway.endedAt ? ` · beendet ${Stamp(giveaway.endedAt, "R")}` : ""}`
    );

    builder.buttons(
        running
            ? { customId: `${GIVEAWAY_PREFIX}:join:${giveaway.id}`, label: "Teilnehmen", emoji: "🎉", tone: "success" }
            : { customId: `${GIVEAWAY_PREFIX}:over:${giveaway.id}`, label: giveaway.status === "cancelled" ? "Abgebrochen" : "Beendet", emoji: "🔒", disabled: true }
    );

    return { components: [builder.build()], allowedMentions: running ? ping.mentions : { parse: [] } };
}

/** Die DM an einen Gewinner - mit Knopf, wenn er sich melden muss. */
export function WinnerDm(giveaway: IGiveaway, guildName: string, deadline: number | null): ICommunityView {
    const builder = new ComponentV2Builder({ accentColor: GIVEAWAY_ACCENT }).text(
        `### 🎉 Du hast gewonnen!\n**${escapeMarkdown(giveaway.prize)}** – beim Giveaway auf **${escapeMarkdown(guildName)}**.`
    );

    if (deadline) {
        builder
            .text(`Nimm den Gewinn bis ${Stamp(deadline)} an – danach wird neu ausgelost.`)
            .buttons({ customId: `${GIVEAWAY_PREFIX}:claim:${giveaway.id}`, label: "Gewinn annehmen", emoji: "✅", tone: "success" });
    } else {
        builder.subtext("Das Team des Servers meldet sich bei dir.");
    }

    return { components: [builder.build()], allowedMentions: { parse: [] } };
}

/** Die Nachricht im Kanal, wenn Gewinner feststehen - auch nach einer Neuauslosung. */
export function WinnerAnnouncement(giveaway: IGiveaway, userIds: string[], reroll: boolean): ICommunityView {
    const mentions = userIds.map((id) => `<@${id}>`).join(", ");
    const claim = giveaway.settings.dm && giveaway.settings.claimHours > 0 ? `\n-# Bitte nehmt den Gewinn innerhalb von ${giveaway.settings.claimHours} Stunden per DM an.` : "";
    const text = userIds.length
        ? `${reroll ? "🔄 Neu ausgelost" : "🎉 Glückwunsch"} ${mentions}! ${userIds.length === 1 ? "Du hast" : "Ihr habt"} **${escapeMarkdown(giveaway.prize)}** gewonnen.${claim}`
        : `😕 Beim Giveaway **${escapeMarkdown(giveaway.prize)}** gibt es keine (weiteren) Gewinner – niemand erfüllt die Bedingungen.`;

    return {
        components: [new ComponentV2Builder({ accentColor: GIVEAWAY_ACCENT }).text(text).build()],
        allowedMentions: { users: userIds },
    };
}

/** "Du bist schon dabei" - mit Knopf zum Austragen. */
export function EntryCard(text: string, giveawayId: number): ICommunityView {
    return {
        components: [
            new ComponentV2Builder({ accentColor: GIVEAWAY_ACCENT })
                .text(text)
                .buttons({ customId: `${GIVEAWAY_PREFIX}:leave:${giveawayId}`, label: "Austragen", emoji: "🚪", tone: "danger" })
                .build(),
        ],
        allowedMentions: { parse: [] },
    };
}

export function InfoCard(text: string, accent: string = POLL_ACCENT): ICommunityView {
    return { components: [new ComponentV2Builder({ accentColor: accent as `#${string}` }).text(text).build()], allowedMentions: { parse: [] } };
}

