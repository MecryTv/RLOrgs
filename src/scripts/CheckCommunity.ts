/**
 * Prüft Twitch- und YouTube-Notifier, Umfragen und Giveaways ohne Discord,
 * Twitch oder YouTube: Eingaben (Kanal-Namen und Links), das Lesen des
 * YouTube-Feeds, die Prüfung der Einstellungen, das Ziehen der Gewinner, die
 * Karten in Discord - und, sofern eine Datenbank da ist, die Tabellen dahinter.
 *
 *   npm run check:community
 *
 * Wie check:moderation ohne Test-Framework. Alles Geschriebene hängt an einer
 * erfundenen Guild-ID und wird am Ende wieder entfernt. Was wirklich nach
 * draußen geht - Twitch fragen, Videos holen, Nachrichten senden - braucht
 * Schlüssel und einen echten Server und steht hier nicht drin.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import { ChannelType, Guild, GuildBasedChannel, GuildMember, Role } from "discord.js";
import BotClient from "../client/BotClient";
import { GiveawayCard, PollCard, StreamCard, TwitchSummary, VoteReply, WinnerDm } from "../builder/CommunityView";
import { DefaultMessage, DefaultStreamConfig, TwitchLogin, YouTubeChannelId, YouTubeLookupUrl } from "../constants/Streams";
import { Bar } from "../constants/Polls";
import { CLAIM_CHOICES, MAX_BONUS_TICKETS } from "../constants/Giveaways";
import { IGiveaway, IPoll, IStreamNotifier } from "../interfaces/services/community/ICommunity";
import { BOOSTER, DrawWeighted } from "../services/GiveawayService";
import { Decode, ParseFeed } from "../utils/youtube";

// Erfundene Snowflakes - 17-stellig wie echte, aber es gibt sie bei Discord nicht.
const GUILD = "90071992547409971";
const USER = "90071992547409972";
const TEXT = "90071992547409973";
const VOICE = "90071992547409974";
const ROLE = "90071992547409975";
const TEAM = "90071992547409976";
const DAY = 86_400_000;

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

function FakeGuild(): Guild {
    const channel = (id: string, type: ChannelType) => ({ id, type }) as unknown as GuildBasedChannel;
    const role = (id: string, name: string) => ({ id, name }) as unknown as Role;

    return {
        id: GUILD,
        name: "Dev Server",
        channels: { cache: new Map([[TEXT, channel(TEXT, ChannelType.GuildText)], [VOICE, channel(VOICE, ChannelType.GuildVoice)]]) },
        roles: { cache: new Map([[ROLE, role(ROLE, "Stammgast")], [TEAM, role(TEAM, "Team")], [GUILD, role(GUILD, "@everyone")]]) },
    } as unknown as Guild;
}

function FakeMember(guild: Guild, patch: { roles?: string[]; booster?: boolean; joinedDaysAgo?: number; accountDaysAgo?: number } = {}): GuildMember {
    const now = Date.now();

    return {
        id: USER,
        guild,
        roles: { cache: new Map((patch.roles ?? []).map((id) => [id, guild.roles.cache.get(id)!])) },
        premiumSince: patch.booster ? new Date() : null,
        joinedTimestamp: now - (patch.joinedDaysAgo ?? 400) * DAY,
        user: { id: USER, createdTimestamp: now - (patch.accountDaysAgo ?? 800) * DAY },
    } as unknown as GuildMember;
}

function SampleNotifier(patch: Partial<IStreamNotifier> = {}): IStreamNotifier {
    return {
        id: 1,
        guildId: GUILD,
        platform: "twitch",
        accountId: "12345",
        accountName: "MecryTv",
        accountLogin: "mecrytv",
        avatar: "https://static-cdn.jtvnw.net/avatar.png",
        enabled: true,
        config: DefaultStreamConfig("twitch"),
        state: {},
        createdBy: USER,
        createdAt: Date.now(),
        ...patch,
    };
}

function SamplePoll(patch: Partial<IPoll> = {}): IPoll {
    return {
        id: 1,
        guildId: GUILD,
        number: 7,
        kind: "buttons",
        channelId: TEXT,
        messageId: null,
        question: "Welche Playlist zocken wir heute?",
        description: "Kurz abstimmen, in zehn Minuten geht es los.",
        options: [
            { id: "1", label: "Duo", emoji: "🥈" },
            { id: "2", label: "Standard", emoji: "🏆" },
            { id: "3", label: "Hoops", emoji: "🏀" },
        ],
        settings: { multi: false, maxChoices: 0, anonymous: false, results: "live", roles: [], ping: null, accent: null },
        status: "open",
        results: null,
        createdBy: USER,
        createdAt: Date.now(),
        endsAt: Date.now() + 3_600_000,
        endedAt: null,
        ...patch,
    };
}

function SampleGiveaway(patch: Partial<IGiveaway> = {}): IGiveaway {
    return {
        id: 1,
        guildId: GUILD,
        number: 3,
        channelId: TEXT,
        messageId: null,
        prize: "Rocket Pass Premium",
        description: "Drei Tage Zeit, viel Glück!",
        image: null,
        winners: 2,
        hostId: USER,
        status: "running",
        startsAt: Date.now(),
        endsAt: Date.now() + 3 * DAY,
        endedAt: null,
        requirements: { roles: [ROLE], allRoles: false, forbidden: [TEAM], booster: "any", serverDays: 7, accountDays: 30, messages: 0, linked: false },
        bonus: [{ roleId: ROLE, tickets: 2 }, { roleId: BOOSTER, tickets: 3 }],
        settings: { dm: true, claimHours: 24, ping: null, accent: null },
        results: { winners: [] },
        createdAt: Date.now(),
        ...patch,
    };
}

/* ----------------------------------------------------------
   Eingaben: was jemand ins Dashboard tippt
   ---------------------------------------------------------- */
function checkInputs(): void {
    console.log("\n  — Streamer und Kanäle eintragen —");

    const twitch: [string, string | null][] = [
        ["mecrytv", "mecrytv"],
        ["MecryTv", "mecrytv"],
        ["@MecryTv", "mecrytv"],
        ["twitch.tv/MecryTv", "mecrytv"],
        ["https://www.twitch.tv/mecrytv/", "mecrytv"],
        ["https://twitch.tv/mecrytv?sr=a", "mecrytv"],
        ["", null],
        ["zwei namen", null],
        ["ab", null],
    ];

    for (const [input, want] of twitch) check(`Twitch: "${input}" → ${want ?? "nichts"}`, TwitchLogin(input) === want, String(TwitchLogin(input)));

    const id = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

    check("YouTube: die ID steht direkt da", YouTubeChannelId(id) === id);
    check("YouTube: ID aus dem Link", YouTubeChannelId(`https://www.youtube.com/channel/${id}/videos`) === id);
    check("YouTube: ein Handle ist keine ID", YouTubeChannelId("@GoogleDevelopers") === null);
    check("YouTube: Handle wird nachgeschlagen", YouTubeLookupUrl("@GoogleDevelopers") === "https://www.youtube.com/@GoogleDevelopers");
    check("YouTube: Handle im Link", YouTubeLookupUrl("https://youtube.com/@GoogleDevelopers/videos") === "https://www.youtube.com/@GoogleDevelopers");
    check("YouTube: alter /c/-Link", YouTubeLookupUrl("youtube.com/c/GoogleDevelopers")?.includes("GoogleDevelopers") === true);
    check("YouTube: Unsinn bleibt Unsinn", YouTubeLookupUrl("hallo welt") === null);
}

/* ----------------------------------------------------------
   YouTube-Feed lesen
   ---------------------------------------------------------- */
function checkFeed(): void {
    console.log("\n  — YouTube-Feed —");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>RL Nexus</title>
  <entry>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <title>Aerials &amp; Flip Resets &#8211; Training</title>
    <published>2026-09-18T17:30:00+00:00</published>
    <media:group><media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"/></media:group>
  </entry>
  <entry>
    <yt:videoId>abcdefghijk</yt:videoId>
    <title>Kurz erklärt</title>
    <published>2026-09-17T09:00:00+00:00</published>
    <media:group><media:thumbnail url="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"/></media:group>
  </entry>
</feed>`;
    const feed = ParseFeed(xml);

    check("Der Kanal-Name steht oben", feed.title === "RL Nexus", feed.title);
    check("Beide Videos kommen an", feed.entries.length === 2);
    check("Die Video-ID stimmt", feed.entries[0]?.id === "dQw4w9WgXcQ");
    check("Der Titel ist lesbar", feed.entries[0]?.title === "Aerials & Flip Resets – Training", feed.entries[0]?.title);
    check("Das Vorschaubild ist da", feed.entries[0]?.thumbnail.endsWith("hqdefault.jpg") === true);
    check("Das Datum wird verstanden", feed.entries[0]?.published === Date.parse("2026-09-18T17:30:00+00:00"));
    check("Ein kaputter Feed wirft nicht", ParseFeed("<html>Fehler</html>").entries.length === 0);
    check("Sonderzeichen werden aufgelöst", Decode("M&amp;M&#39;s &lt;3 &#8211; jetzt") === "M&M's <3 – jetzt");
}

/* ----------------------------------------------------------
   Notifier-Einstellungen
   ---------------------------------------------------------- */
function checkStreamConfig(client: BotClient): void {
    console.log("\n  — Notifier-Einstellungen —");

    const guild = FakeGuild();
    const base = DefaultStreamConfig("youtube");
    const clean = client.streamService.Clean(guild, "youtube", { channelId: TEXT, ping: ROLE, kinds: ["video", "live", "quatsch"], ended: "delete" }, base);

    check("Der Kanal wird übernommen", clean.channelId === TEXT);
    check("Die Ping-Rolle wird übernommen", clean.ping === ROLE);
    check("Nur bekannte Arten bleiben", clean.kinds.join(",") === "video,live", clean.kinds.join(","));
    check("@everyone als Ping-Rolle fällt weg", client.streamService.Clean(guild, "youtube", { ping: GUILD }, base).ping === null);
    check("Ein Sprachkanal geht nicht", client.streamService.Clean(guild, "youtube", { channelId: VOICE }, base).channelId === null);
    check("Twitch kennt nur live", client.streamService.Clean(guild, "twitch", { kinds: ["video", "live"] }, DefaultStreamConfig("twitch")).kinds.join(",") === "live");
    check("Was nicht mitkommt, bleibt wie es war", client.streamService.Clean(guild, "youtube", { ping: "here" }, { ...base, channelId: TEXT, update: false }).channelId === TEXT);
    check("Eine leere Nachricht fällt weg, die Vorlage gilt", Object.keys(client.streamService.Clean(guild, "youtube", { messages: { video: { blocks: [] } } }, base).messages).length === 0);

    const notifier = SampleNotifier({ platform: "youtube", config: { ...base, messages: { video: { blocks: [{ type: "text", body: "Eigene Meldung" }] } } } });

    check("Eigene Nachricht gewinnt gegen die Vorlage", JSON.stringify(client.streamService.MessageOf(notifier, "video")).includes("Eigene Meldung"));
    check("Ohne eigene Nachricht kommt die Vorlage", JSON.stringify(client.streamService.MessageOf(notifier, "short")) === JSON.stringify(DefaultMessage("youtube", "short")));
    check("Noch nie live: offline", client.streamService.Status(SampleNotifier()) === "offline");
    check("Gerade live: seit wann", client.streamService.Status(SampleNotifier({ state: { live: { streamId: "1", messageId: null, channelId: TEXT, startedAt: Date.now() - 1_200_000, title: "Ranked", game: "Rocket League", viewers: 12, peak: 20, renderedAt: 0 } } })).startsWith("live seit"));
    check("Sonst: zuletzt live", client.streamService.Status(SampleNotifier({ state: { lastLiveAt: Date.now() - 7_200_000 } })).startsWith("zuletzt live"));
    check("YouTube: die letzte Meldung", client.streamService.Status(SampleNotifier({ platform: "youtube", state: { last: { id: "x", title: "Video", kind: "short", at: Date.now() - 3_600_000 } } })).startsWith("Short"));
    check("YouTube: noch nichts gemeldet", client.streamService.Status(SampleNotifier({ platform: "youtube" })) === "noch nichts gemeldet");
}

/* ----------------------------------------------------------
   Umfragen
   ---------------------------------------------------------- */
function checkPolls(client: BotClient): void {
    console.log("\n  — Umfragen —");

    const guild = FakeGuild();
    const service = client.pollService;
    const valid = { kind: "buttons", channelId: TEXT, question: "Welche Playlist?", options: ["Duo", "Standard"], duration: 3_600 };
    const fails = (name: string, input: object, expect: string): void => {
        try {
            service.Clean(guild, { ...valid, ...input });
            check(name, false, "kein Fehler");
        } catch (error) {
            check(name, error instanceof Error && error.message.toLowerCase().includes(expect.toLowerCase()), String(error));
        }
    };

    const clean = service.Clean(guild, { ...valid, options: [{ label: " Duo " }, { label: "Standard", emoji: "🏆" }, { label: "Hoops" }, { label: "" }], settings: { multi: true, maxChoices: 2, roles: [ROLE, "999"], ping: "here" } });

    check("Leerzeichen fallen weg", clean.options[0].label === "Duo");
    check("Leere Antworten fallen weg", clean.options.length === 3);
    check("Mehrfachwahl mit Höchstzahl", clean.settings?.multi === true && clean.settings.maxChoices === 2, `maxChoices ${clean.settings?.maxChoices}`);
    check("Unbekannte Rollen fallen weg", clean.settings?.roles?.length === 1);
    check("@here als Ping bleibt", clean.settings?.ping === "here");

    fails("Ohne Frage geht nichts", { question: "  " }, "Frage fehlt");
    fails("Eine Antwort ist keine Wahl", { options: ["Nur eine"] }, "mindestens zwei");
    fails("Zwei gleiche Antworten", { options: ["Duo", "duo"] }, "gleich");
    fails("Elf Antworten sind zu viele", { options: Array.from({ length: 11 }, (_, index) => `Antwort ${index}`) }, "Antworten");
    fails("Ein Sprachkanal geht nicht", { channelId: VOICE }, "Kanal");
    fails("Discord-Umfrage unter einer Stunde", { kind: "native", duration: 600 }, "Stunde");
    fails("Discord-Umfrage über 32 Tage", { kind: "native", duration: 40 * 86_400 }, "Stunde");

    const native = service.Clean(guild, { ...valid, kind: "native", duration: 7_200, description: "Text", settings: { anonymous: true } });

    check("Discord-Umfragen haben keinen Beschreibungstext", native.description === null);
    check("Discord-Umfragen sind nie anonym", native.settings?.anonymous === false);
    check("Eigene Umfrage darf ohne Ende laufen", service.Clean(guild, { ...valid, duration: null }).duration === null);

    check("Balken leer", Bar(0, 10) === "░".repeat(10), Bar(0, 10));
    check("Balken voll", Bar(1, 10) === "█".repeat(10), Bar(1, 10));
    check("Balken halb", Bar(0.5, 10).startsWith("█████"), Bar(0.5, 10));
}

/* ----------------------------------------------------------
   Giveaways
   ---------------------------------------------------------- */
async function checkGiveaways(client: BotClient): Promise<void> {
    console.log("\n  — Giveaways —");

    const guild = FakeGuild();
    const service = client.giveawayService;
    const valid = { prize: "Rocket Pass", channelId: TEXT, duration: 3_600, winners: 2 };
    const fails = (name: string, input: object, expect: string): void => {
        try {
            service.Clean(guild, USER, { ...valid, ...input });
            check(name, false, "kein Fehler");
        } catch (error) {
            check(name, error instanceof Error && error.message.toLowerCase().includes(expect.toLowerCase()), String(error));
        }
    };

    fails("Ohne Preis geht nichts", { prize: " " }, "Preis fehlt");
    fails("Ohne Kanal geht nichts", { channelId: VOICE }, "Kanal");
    fails("Unter einer Minute", { duration: 30 }, "Minute");
    fails("Über 60 Tage", { duration: 61 * 86_400 }, "Minute");
    fails("Start in der Vergangenheit", { startsAt: Date.now() - 600_000 }, "Vergangenheit");
    fails("Start in zwei Jahren", { startsAt: Date.now() + 700 * DAY }, "Vergangenheit");

    const planned = service.Clean(guild, USER, { ...valid, startsAt: Date.now() + 2 * DAY });

    check("Geplant heißt geplant", planned.status === "scheduled");
    check("Die Laufzeit zählt ab dem Start", planned.endsAt - planned.startsAt === 3_600_000);
    check("Sofort heißt laufend", service.Clean(guild, USER, valid).status === "running");
    check("Mehr Gewinner als erlaubt werden gedeckelt", service.Clean(guild, USER, { ...valid, winners: 999 }).winners === 50);
    check("Ein Bild muss https sein", service.Clean(guild, USER, { ...valid, image: "javascript:alert(1)" }).image === null);

    const requirements = service.CleanRequirements(guild, { roles: [ROLE, "999", ROLE], forbidden: [TEAM], booster: "quatsch", serverDays: 9_999, accountDays: -5, messages: 25, linked: "ja" });

    check("Unbekannte Rollen fallen weg", requirements.roles.length === 1);
    check("Doppelte Rollen fallen weg", requirements.roles[0] === ROLE);
    check("Unsinn beim Booster wird zu egal", requirements.booster === "any");
    check("Tage werden gedeckelt", requirements.serverDays === 3650 && requirements.accountDays === 0, `${requirements.serverDays}/${requirements.accountDays}`);
    check("Nur echte Ja-Werte zählen", requirements.linked === false);

    const bonus = service.CleanBonus(guild, [{ roleId: ROLE, tickets: 99 }, { roleId: ROLE, tickets: 2 }, { roleId: BOOSTER, tickets: 2 }, { roleId: "999", tickets: 2 }]);

    check("Bonus nur einmal je Rolle", bonus.length === 2);
    check("Bonus-Lose werden gedeckelt", bonus[0].tickets === MAX_BONUS_TICKETS);
    check("Booster sind als Bonus erlaubt", bonus[1].roleId === BOOSTER);

    const settings = service.CleanSettings(guild, { dm: false, claimHours: 13, ping: GUILD, accent: "#FFC53D" });

    check("Nur erlaubte Fristen", CLAIM_CHOICES.includes(settings.claimHours) && settings.claimHours !== 13);
    check("@everyone als Ping-Rolle fällt weg", settings.ping === null);
    check("Die Farbe wird klein geschrieben", settings.accent === "#ffc53d");

    const rules = service.Rules(guild, SampleGiveaway());

    check("Die Bedingungen stehen als Text da", rules.length === 4, rules.join(" | "));
    check("Die Pflicht-Rolle wird genannt", rules[0].includes(ROLE));
    check("Die verbotene Rolle wird genannt", rules[1].includes(TEAM));
    check("Bonus-Lose als Text", service.BonusLines(guild, SampleGiveaway()).join(" ").includes("Server-Booster"));

    const none = { roles: [], allRoles: false, forbidden: [], booster: "any" as const, serverDays: 0, accountDays: 0, messages: 0, linked: false };

    check("Ohne Bedingungen darf jeder mit", (await service.Missing(FakeMember(guild), none)).length === 0);
    check("Ohne die Pflicht-Rolle nicht", (await service.Missing(FakeMember(guild), { ...none, roles: [ROLE] })).length === 1);
    check("Mit der Pflicht-Rolle schon", (await service.Missing(FakeMember(guild, { roles: [ROLE] }), { ...none, roles: [ROLE] })).length === 0);
    check("Alle Rollen heißt alle", (await service.Missing(FakeMember(guild, { roles: [ROLE] }), { ...none, roles: [ROLE, TEAM], allRoles: true })).length === 1);
    check("Eine verbotene Rolle sperrt", (await service.Missing(FakeMember(guild, { roles: [TEAM] }), { ...none, forbidden: [TEAM] })).length === 1);
    check("Nur Booster: ohne Boost nicht", (await service.Missing(FakeMember(guild), { ...none, booster: "only" })).length === 1);
    check("Keine Booster: mit Boost nicht", (await service.Missing(FakeMember(guild, { booster: true }), { ...none, booster: "none" })).length === 1);
    check("Zu neu auf dem Server", (await service.Missing(FakeMember(guild, { joinedDaysAgo: 2 }), { ...none, serverDays: 7 }))[0]?.includes("noch 5") === true);
    check("Zu junges Discord-Konto", (await service.Missing(FakeMember(guild, { accountDaysAgo: 3 }), { ...none, accountDays: 30 })).length === 1);

    const member = FakeMember(guild, { roles: [ROLE], booster: true });

    check("Ein Los hat jeder", service.Tickets(FakeMember(guild), []) === 1);
    check("Rolle und Boost bringen Lose", service.Tickets(member, SampleGiveaway().bonus) === 6, String(service.Tickets(member, SampleGiveaway().bonus)));
    check("Ohne die Rolle kein Bonus", service.Tickets(FakeMember(guild), SampleGiveaway().bonus) === 1);
}

/* ----------------------------------------------------------
   Auslosen
   ---------------------------------------------------------- */
async function checkDraw(): Promise<void> {
    console.log("\n  — Auslosen —");

    const all = async (): Promise<boolean> => true;
    const entries = [
        { user_id: "a", tickets: 1 },
        { user_id: "b", tickets: 1 },
        { user_id: "c", tickets: 1 },
    ];

    check("Zwei Gewinner aus drei", (await DrawWeighted(entries, 2, all)).length === 2);
    check("Niemand gewinnt zweimal", new Set(await DrawWeighted(entries, 3, all)).size === 3);
    check("Mehr Gewinner als Teilnehmer geht nicht", (await DrawWeighted(entries, 10, all)).length === 3);
    check("Ohne Teilnehmer gewinnt niemand", (await DrawWeighted([], 3, all)).length === 0);
    check("Wer rausfliegt, gewinnt nicht", (await DrawWeighted(entries, 1, async (id) => id === "c")).join("") === "c");

    // Mit zehn Losen gegen neun mal ein Los: der Schwere muss klar öfter ziehen.
    const weighted = [{ user_id: "viel", tickets: 10 }, ...Array.from({ length: 9 }, (_, index) => ({ user_id: `wenig${index}`, tickets: 1 }))];
    let wins = 0;

    for (let round = 0; round < 2_000; round++) if ((await DrawWeighted(weighted, 1, all))[0] === "viel") wins++;

    const share = wins / 2_000;

    // Erwartet: 10 von 19 Losen, also rund 53 Prozent. Der Spielraum fängt Zufall ab.
    check("Mehr Lose heißt öfter gewinnen", share > 0.45 && share < 0.6, `${Math.round(share * 100)} %`);
    check("Ein Los ohne Bonus zählt trotzdem", (await DrawWeighted([{ user_id: "a", tickets: 0 }], 1, all)).length === 1);
}

/* ----------------------------------------------------------
   Karten in Discord
   ---------------------------------------------------------- */
async function checkViews(client: BotClient): Promise<void> {
    console.log("\n  — Karten in Discord —");

    const values = {
        streamer: "MecryTv",
        "stream.title": "Ranked bis Grand Champ",
        "stream.game": "Rocket League",
        "stream.url": "https://twitch.tv/mecrytv",
        "stream.preview": "https://static-cdn.jtvnw.net/preview.jpg",
        "stream.viewers": "128",
    };
    const card = await StreamCard(client, DefaultMessage("twitch", "live"), values, { ping: ROLE, button: { url: "https://twitch.tv/mecrytv", label: "Zum Stream", emoji: "📺" } });
    const json = JSON.stringify(card.components[0].toJSON());

    check("Die Live-Karte nennt den Streamer", json.includes("MecryTv"));
    check("Platzhalter sind ersetzt", !json.includes("{stream.title}") && json.includes("Ranked bis Grand Champ"));
    check("Der Ping steht oben drüber", json.includes(`<@&${ROLE}>`));
    check("Nur diese Rolle darf gepingt werden", card.allowedMentions.roles?.join("") === ROLE);
    check("Ohne Ping wird niemand gepingt", (await StreamCard(client, DefaultMessage("youtube", "video"), { channel: "RL Nexus" }, { ping: null, button: { url: "https://youtu.be/x", label: "Ansehen", emoji: "▶️" } })).allowedMentions.parse?.length === 0);

    const summary = JSON.stringify(TwitchSummary({ streamer: "MecryTv", title: "Ranked", game: "Rocket League", startedAt: Date.now() - 7_200_000, endedAt: Date.now(), peak: 210, avatar: null, url: "https://twitch.tv/mecrytv", vod: "https://twitch.tv/videos/1" }).components[0].toJSON());

    check("Die Zusammenfassung nennt die Dauer", summary.includes("2 Std."), summary.slice(0, 200));
    check("Die Zusammenfassung nennt den Höchststand", summary.includes("210"));

    const poll = SamplePoll();
    const tally = { counts: { "1": 3, "2": 5 }, voters: 8 };
    const open = JSON.stringify(PollCard(poll, tally, false).components[0].toJSON());

    check("Die Umfrage zeigt die Frage", open.includes("Welche Playlist"));
    check("Jede Antwort hat einen Knopf", (open.match(/poll:vote:/g) ?? []).length === 3);
    check("Die Balken stehen da", open.includes("█"));
    check("Ergebnisse erst am Ende bleiben weg", !JSON.stringify(PollCard(SamplePoll({ settings: { ...poll.settings, results: "end" } }), tally, false).components[0].toJSON()).includes("█"));
    check("Beendet: keine Knöpfe mehr", !JSON.stringify(PollCard(SamplePoll({ status: "ended" }), tally, true).components[0].toJSON()).includes("poll:vote:"));
    check("Zehn Antworten passen in die Karte", PollCard(SamplePoll({ options: Array.from({ length: 10 }, (_, index) => ({ id: String(index + 1), label: `Antwort ${index + 1}`, emoji: null })) }), tally, false).components.length === 1);
    check("Die Antwort auf eine Stimme nennt die Wahl", JSON.stringify(VoteReply(poll, ["2"], tally).components[0].toJSON()).includes("Standard"));
    check("Anonym heißt: keine Namen", JSON.stringify(VoteReply(SamplePoll({ settings: { ...poll.settings, anonymous: true } }), ["2"], null).components[0].toJSON()).includes("Standard"));

    const giveaway = SampleGiveaway();
    const gw = JSON.stringify(GiveawayCard(giveaway, 42, ["Die Rolle: <@&1>"], ["<@&1>: +2 Lose"]).components[0].toJSON());

    check("Das Giveaway nennt den Preis", gw.includes("Rocket Pass Premium"));
    check("Teilnehmer werden gezählt", gw.includes("42"));
    check("Bedingungen und Bonus stehen drin", gw.includes("Die Rolle") && gw.includes("+2 Lose"));
    check("Zum Mitmachen gibt es einen Knopf", gw.includes("giveaway:join:1"));
    check("Beendet: kein Mitmachen mehr", !JSON.stringify(GiveawayCard(SampleGiveaway({ status: "ended", endedAt: Date.now(), results: { winners: [{ userId: USER, drawnAt: Date.now(), deadline: null, status: "won", claimedAt: null, dm: true }] } }), 42, [], []).components[0].toJSON()).includes("giveaway:join:"));

    const dm = JSON.stringify(WinnerDm(giveaway, "Dev Server", Date.now() + 86_400_000).components[0].toJSON());

    check("Die Gewinner-DM nennt die Frist", dm.includes("giveaway:claim:1") && dm.includes("<t:"));
    check("Ohne Frist kein Knopf", !JSON.stringify(WinnerDm(SampleGiveaway({ settings: { ...giveaway.settings, claimHours: 0 } }), "Dev Server", null).components[0].toJSON()).includes("giveaway:claim:"));
}

/* ----------------------------------------------------------
   Datenbank
   ---------------------------------------------------------- */
async function checkDatabase(client: BotClient): Promise<void> {
    console.log("\n  — Datenbank —");

    const notifier = await client.streamNotifiers.Create({
        guildId: GUILD,
        platform: "twitch",
        accountId: "12345",
        accountName: "MecryTv",
        accountLogin: "mecrytv",
        avatar: null,
        config: { ...DefaultStreamConfig("twitch"), channelId: TEXT },
        state: {},
        createdBy: USER,
    });

    check("Der Streamer steht in der Tabelle", notifier.id > 0 && notifier.config.channelId === TEXT);
    check("Er taucht beim Server auf", (await client.streamNotifiers.OfGuild(GUILD, "twitch")).length === 1);
    check("Bei YouTube steht er nicht", (await client.streamNotifiers.OfGuild(GUILD, "youtube")).length === 0);
    check("Der Minuten-Lauf findet ihn", (await client.streamNotifiers.Active("twitch")).some((entry) => entry.id === notifier.id));

    await client.streamNotifiers.SaveConfig(notifier.id, { ...notifier.config, ping: "here", ended: "delete" }, false);

    check("Einstellungen kommen so zurück", (await client.streamNotifiers.Get(notifier.id))?.config.ended === "delete");
    check("Pausiert wird nicht mehr abgefragt", !(await client.streamNotifiers.Active("twitch")).some((entry) => entry.id === notifier.id));

    await client.streamNotifiers.SaveState(notifier.id, { seen: ["a", "b"], problem: "Kanal weg" });

    check("Der Stand bleibt erhalten", (await client.streamNotifiers.Get(notifier.id))?.state.seen?.join("") === "ab");

    await client.streamNotifiers.Rename(notifier.id, "MecryTv Live", "mecrytv", null);

    check("Umbenennen klappt", (await client.streamNotifiers.Get(notifier.id))?.accountName === "MecryTv Live");
    await client.moduleSettings.Save(GUILD, "twitch", { liveRoleId: ROLE, liveRoleFilter: null });
    check("Twitch-Einstellungen kommen zurück", (await client.moduleSettings.Of(GUILD, "twitch", { liveRoleId: null })).liveRoleId === ROLE);

    const poll = await client.polls.Create({
        guildId: GUILD,
        kind: "buttons",
        channelId: TEXT,
        question: "Welche Playlist?",
        description: null,
        options: [{ id: "1", label: "Duo", emoji: null }, { id: "2", label: "Standard", emoji: null }],
        settings: { multi: false, maxChoices: 0, anonymous: false, results: "live", roles: [], ping: null, accent: null },
        createdBy: USER,
        endsAt: Date.now() - 1_000,
    });
    const second = await client.polls.Create({ ...poll, description: null, endsAt: null });

    check("Umfragen zählen hoch", second.number === poll.number + 1, `${poll.number} → ${second.number}`);
    check("Die Umfrage steht beim Server", (await client.polls.OfGuild(GUILD)).length === 2);

    await client.polls.SetVotes(poll.id, USER, ["1"]);
    await client.polls.SetVotes(poll.id, USER, ["2"]);

    check("Eine zweite Stimme ersetzt die erste", (await client.polls.VotesOf(poll.id, USER)).join("") === "2");
    check("Gezählt wird einmal", (await client.polls.Tally(poll.id)).voters === 1);
    check("Die Stimme liegt auf der richtigen Antwort", (await client.polls.Tally(poll.id)).counts["2"] === 1);
    check("Wer was gewählt hat, steht da", (await client.polls.Voters(poll.id)).some((vote) => vote.user_id === USER && vote.option_id === "2"));

    await client.polls.SetVotes(poll.id, USER, []);

    check("Abwählen leert die Stimme", (await client.polls.Tally(poll.id)).voters === 0);
    check("Die abgelaufene Umfrage ist fällig", (await client.polls.Due(Date.now())).some((entry) => entry.id === poll.id));
    check("Die ohne Ende nicht", !(await client.polls.Due(Date.now())).some((entry) => entry.id === second.id));

    await client.polls.Finish(poll.id, { "2": 1 });

    check("Beendet heißt beendet", (await client.polls.Get(poll.id))?.status === "ended");
    check("Das Ergebnis bleibt stehen", (await client.polls.Get(poll.id))?.results?.["2"] === 1);

    const giveaway = await client.giveaways.Create(client.giveawayService.Clean(FakeGuild(), USER, { prize: "Rocket Pass", channelId: TEXT, duration: 3_600, winners: 1 }));

    check("Das Giveaway steht in der Tabelle", giveaway.number > 0 && giveaway.status === "running");
    check("Es steht beim Server", (await client.giveaways.OfGuild(GUILD)).length === 1);

    await client.giveaways.Join(giveaway.id, USER, 3);
    await client.giveaways.Join(giveaway.id, USER, 5);

    check("Zweimal mitmachen bleibt eine Teilnahme", (await client.giveaways.EntryCount(giveaway.id)) === 1);
    check("Die Lose werden nachgezogen", (await client.giveaways.Entry(giveaway.id, USER))?.tickets === 5);
    check("Teilnahmen mehrerer Giveaways auf einmal", (await client.giveaways.Counts([giveaway.id])).get(giveaway.id) === 1);
    check("Die Teilnehmer stehen da", (await client.giveaways.Entries(giveaway.id))[0]?.user_id === USER);

    await client.giveaways.Leave(giveaway.id, USER);

    check("Austreten nimmt die Teilnahme weg", (await client.giveaways.EntryCount(giveaway.id)) === 0);

    const winner = { userId: USER, drawnAt: Date.now(), deadline: Date.now() - 1_000, status: "pending" as const, claimedAt: null, dm: true };

    await client.giveaways.Patch(giveaway.id, { status: "ended", endedAt: Date.now(), results: { winners: [winner] } });

    check("Ein offener Gewinn wird gefunden", (await client.giveaways.Pending(Date.now())).some((entry) => entry.id === giveaway.id));

    await client.giveaways.Patch(giveaway.id, { results: { winners: [{ ...winner, status: "claimed", claimedAt: Date.now() }] } });

    check("Angenommen heißt: nicht mehr offen", !(await client.giveaways.Pending(Date.now())).some((entry) => entry.id === giveaway.id));
}

async function cleanup(client: BotClient): Promise<void> {
    const db = client.databaseService;

    await db.Write("DELETE v FROM poll_votes v JOIN polls p ON p.id = v.poll_id WHERE p.guild_id = ?", [GUILD]);
    await db.Write("DELETE e FROM giveaway_entries e JOIN giveaways g ON g.id = e.giveaway_id WHERE g.guild_id = ?", [GUILD]);
    await db.Write("DELETE FROM polls WHERE guild_id = ?", [GUILD]);
    await db.Write("DELETE FROM giveaways WHERE guild_id = ?", [GUILD]);
    await db.Write("DELETE FROM stream_notifiers WHERE guild_id = ?", [GUILD]);
    await db.Write("DELETE FROM module_settings WHERE guild_id = ?", [GUILD]);

    client.polls.Forget();
    client.giveaways.Forget();
    client.streamNotifiers.Forget();
    client.moduleSettings.Forget();

    check("Aufgeräumt", (await client.polls.OfGuild(GUILD)).length === 0 && (await client.giveaways.OfGuild(GUILD)).length === 0 && (await client.streamNotifiers.OfGuild(GUILD, "twitch")).length === 0);
}

async function main(): Promise<void> {
    console.log("\n📣 Notifier, Umfragen und Giveaways\n");

    const client = new BotClient();

    await client.configService.Initialize();

    checkInputs();
    checkFeed();
    checkStreamConfig(client);
    checkPolls(client);
    await checkGiveaways(client);
    await checkDraw();
    await checkViews(client);

    if (await client.databaseService.Connect()) {
        try {
            await checkDatabase(client);
        } finally {
            console.log("\n  — Aufräumen —");

            await cleanup(client).catch((error) => check("Aufräumen lief durch", false, String(error)));
            await client.databaseService.Close();
        }
    } else {
        console.log("\n  — Datenbank —\n  übersprungen: keine Verbindung (siehe Meldung oben)");
    }

    console.log(failures === 0 ? "\n✅ Alle Prüfungen bestanden.\n" : `\n❌ ${failures} Prüfung(en) fehlgeschlagen.\n`);

    process.exit(failures > 0 ? 1 : 0);
}

void main();
