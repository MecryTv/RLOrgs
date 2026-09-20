/**
 * Prüft das Welcome System ohne Discord: die Prüfung der Einstellungen, die
 * Platzhalter, die gezeichnete Karte als PNG und die Nachricht, die an Discord
 * ginge.
 *
 *   npm run check:welcome
 *
 * Wer wirklich kommt und geht, sieht nur ein echter Server - und dafür braucht
 * der Bot das Members-Intent.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import { ChannelType, Guild, GuildBasedChannel, GuildMember, Role } from "discord.js";
import BotClient from "../client/BotClient";
import { RenderWelcomeCard } from "../builder/WelcomeCard";
import { DefaultCard, DefaultWelcomeConfig, MAX_TITLE_SIZE, MIN_TITLE_SIZE, WELCOME_PLACEHOLDER_KEYS } from "../constants/Welcome";
import { IWelcomeMessage } from "../interfaces/services/welcome/IWelcome";
import { WelcomeError } from "../services/WelcomeService";

const GUILD = "90071992547409931";
const USER = "90071992547409932";
const TEXT = "90071992547409933";
const VOICE = "90071992547409934";
const ROLE = "90071992547409935";

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

function FakeGuild(): Guild {
    const channel = (id: string, type: ChannelType) => ({ id, type, name: `kanal-${id.slice(-2)}`, isTextBased: () => type === ChannelType.GuildText }) as unknown as GuildBasedChannel;
    const role = (id: string, name: string) =>
        ({ id, name, managed: false, comparePositionTo: () => -1 }) as unknown as Role;

    return {
        id: GUILD,
        name: "Dev Server",
        memberCount: 148,
        iconURL: () => "https://cdn.discordapp.com/icons/1/2.png",
        channels: { cache: new Map([[TEXT, channel(TEXT, ChannelType.GuildText)], [VOICE, channel(VOICE, ChannelType.GuildVoice)]]) },
        roles: { cache: new Map([[ROLE, role(ROLE, "Mitglied")], [GUILD, role(GUILD, "@everyone")]]) },
        members: { me: { permissions: { has: () => true }, roles: { highest: { id: "1" } } } },
    } as unknown as Guild;
}

function FakeMember(guild: Guild): GuildMember {
    return {
        id: USER,
        displayName: "Lara",
        guild,
        user: { id: USER, bot: false, username: "lara", createdTimestamp: Date.now() - 400 * 86_400_000 },
        joinedTimestamp: Date.now(),
        displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/1.png",
        roles: { cache: new Map(), add: async () => undefined },
    } as unknown as GuildMember;
}

/* ----------------------------------------------------------
   Einstellungen
   ---------------------------------------------------------- */
function checkClean(client: BotClient): void {
    console.log("\n  — Einstellungen —");

    const guild = FakeGuild();
    const service = client.welcomeService;
    const base = DefaultWelcomeConfig();

    check("Standard: begrüßen an, verabschieden aus", base.join.on && !base.leave.on);
    check("Standard: die gezeichnete Karte", base.join.kind === "card");

    const clean = service.Clean(
        guild,
        {
            join: { on: true, channelId: TEXT, kind: "embed", embed: { title: "Hallo {user.name}" } },
            leave: { on: false, channelId: VOICE },
            roles: [ROLE, "999", ROLE, GUILD],
            botRoles: [ROLE],
        },
        base
    );

    check("Der Kanal wird übernommen", clean.join.channelId === TEXT);
    check("Ein Sprachkanal fällt weg", clean.leave.channelId === null);
    check("Die Art kommt an", clean.join.kind === "embed");
    check("Das Embed auch", clean.join.embed?.title === "Hallo {user.name}");
    check("Unbekannte Rollen und Doppelte fallen weg", clean.roles.join(",") === ROLE, clean.roles.join(","));
    check("@everyone ist keine Auto-Rolle", !clean.roles.includes(GUILD));
    check("Bot-Rollen stehen getrennt", clean.botRoles.join(",") === ROLE);

    const fails = (name: string, input: object, expect: string): void => {
        try {
            service.Clean(guild, input, base);
            check(name, false, "kein Fehler");
        } catch (error) {
            check(name, error instanceof WelcomeError && error.message.toLowerCase().includes(expect.toLowerCase()), String(error));
        }
    };

    fails("Angeschaltet ohne Kanal geht nicht", { join: { on: true, channelId: null } }, "Kanal");
    fails("Normale Nachricht ohne Text nicht", { join: { on: true, channelId: TEXT, kind: "text", content: "  " } }, "leer");
    fails("Leeres Embed nicht", { join: { on: true, channelId: TEXT, kind: "embed", embed: {} } }, "leer");

    console.log("\n  — Die Karte einstellen —");

    const card = service.CleanCard(
        { accent: "#FF1E2D", dim: 500, titleSize: 999, align: "center", avatarShape: "bevel", title: "  Hallo  ", avatar: false, icon: false },
        DefaultCard("join"),
        "join"
    );

    check("Die Farbe wird klein geschrieben", card.accent === "#ff1e2d");
    check("Das Abdunkeln ist gedeckelt", card.dim === 90, String(card.dim));
    check("Die Schriftgröße auch", card.titleSize === MAX_TITLE_SIZE, String(card.titleSize));
    check("Zu kleine Schrift wird angehoben", service.CleanCard({ titleSize: 2 }, DefaultCard("join"), "join").titleSize === MIN_TITLE_SIZE);
    check("Die Ausrichtung kommt an", card.align === "center");
    check("Die Form des Avatars auch", card.avatarShape === "bevel");
    check("Leerzeichen fallen weg", card.title === "Hallo");
    check("Bausteine lassen sich abschalten", card.avatar === false && card.icon === false);
    check("Der Hintergrund kommt nur über den Upload", service.CleanCard({ background: "fremd.png" }, DefaultCard("join"), "join").background === null);
}

/* ----------------------------------------------------------
   Platzhalter
   ---------------------------------------------------------- */
function checkValues(client: BotClient): void {
    console.log("\n  — Platzhalter —");

    const guild = FakeGuild();
    const member = FakeMember(guild);
    const values = client.welcomeService.Values(member, "join");

    check("Alle Schlüssel sind da", WELCOME_PLACEHOLDER_KEYS.every((key) => key in values), Object.keys(values).join(","));
    check("Die Erwähnung stimmt", values.user === `<@${USER}>`);
    check("Der Name steht da", values["user.name"] === "Lara");
    check("Der Server auch", values.guild === "Dev Server");
    check("Die Mitgliedszahl ist die des Servers", values["guild.members"] === "148" && values["member.number"] === "148");
    check("Zeiten stehen als Discord-Zeitstempel", values.joined.startsWith("<t:") && values.created.startsWith("<t:"));
}

/* ----------------------------------------------------------
   Karte und Nachricht
   ---------------------------------------------------------- */
async function checkCard(client: BotClient): Promise<void> {
    console.log("\n  — Die gezeichnete Karte —");

    const guild = FakeGuild();
    const member = FakeMember(guild);
    const message: IWelcomeMessage = { ...DefaultWelcomeConfig().join, channelId: TEXT };
    const png = await client.welcomeService.Card(member, message, "join");

    check("Die Karte entsteht", png.length > 5_000, `${png.length} Bytes`);
    check("Es ist wirklich ein PNG", png.subarray(1, 4).toString() === "PNG");

    const bare = await RenderWelcomeCard({
        card: { ...DefaultCard("join"), avatar: false, icon: false, avatarRing: false, align: "center", dim: 0 },
        title: "Willkommen!",
        subtitle: "",
        footer: "",
        avatarURL: null,
        iconURL: null,
        backgroundPath: null,
    });

    check("Auch ohne Avatar und Symbol", bare.length > 3_000);

    const long = await RenderWelcomeCard({
        card: { ...DefaultCard("join"), titleSize: MAX_TITLE_SIZE },
        title: "Ein wirklich sehr langer Name, der nicht in die Karte passt",
        subtitle: "Und eine ebenso lange zweite Zeile, die auch nicht hineinpasst",
        footer: "Mitglied Nr. 148 auf Dev Server",
        avatarURL: null,
        iconURL: null,
        backgroundPath: null,
    });

    check("Lange Texte sprengen sie nicht", long.length > 3_000);

    console.log("\n  — Was an Discord ginge —");

    const card = await client.welcomeService.Payload(member, message, "join");

    check("Die Karte hängt als Datei dran", (card.files?.length ?? 0) === 1);
    check("Der Text darüber ist gefüllt", card.content === `<@${USER}>`, String(card.content));

    const text = await client.welcomeService.Payload(member, { ...message, kind: "text", content: "Willkommen, {user.name} auf {guild}!" }, "join");

    check("Normale Nachricht: Platzhalter ersetzt", text.content === "Willkommen, Lara auf Dev Server!", String(text.content));
    check("Und keine Datei dabei", !text.files?.length);

    const embed = await client.welcomeService.Payload(
        member,
        { ...message, kind: "embed", content: "", embed: { ...(client.messageService.CleanEmbed({ title: "Hallo {user.name}", description: "Nr. {member.number}" }) ?? { title: null, description: null, color: null, url: null, image: null, thumbnail: null, author: null, footer: null, timestamp: false, fields: [] }) } },
        "join"
    );
    const json = JSON.stringify(embed.embeds ?? []);

    check("Embed: der Name steht drin", json.includes("Hallo Lara"), json.slice(0, 120));
    check("Embed: die Nummer auch", json.includes("Nr. 148"));

    const v2 = await client.welcomeService.Payload(member, { ...message, kind: "v2" }, "join");

    check("Components V2 baut einen Container", (v2.components?.length ?? 0) === 1);
}

async function main(): Promise<void> {
    console.log("\n👋 Welcome System\n");

    const client = new BotClient();

    await client.configService.Initialize();

    checkClean(client);
    checkValues(client);
    await checkCard(client);

    console.log(failures === 0 ? "\n✅ Alle Prüfungen bestanden.\n" : `\n❌ ${failures} Prüfung(en) fehlgeschlagen.\n`);

    process.exit(failures > 0 ? 1 : 0);
}

void main();
