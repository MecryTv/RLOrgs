/**
 * Prüft das Level System ohne Discord: die Rechnung hinter den Punkten, die
 * Einstellungen, die Karte als PNG - und, sofern eine Datenbank da ist, die
 * Rangliste samt Belohnungsrollen.
 *
 *   npm run check:levels
 *
 * Punkte fürs Schreiben und fürs Sitzen im Sprachkanal fallen erst auf einem
 * echten Server an; hier wird gerechnet, geprüft und gezeichnet.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import { ChannelType, Guild, GuildBasedChannel, GuildMember, Role } from "discord.js";
import BotClient from "../client/BotClient";
import { RenderLevelCard } from "../builder/LevelCard";
import { DefaultLevelMessage, DefaultLevelSettings, LevelFromXp, LevelProgress, MAX_FACTOR, XpForLevel } from "../constants/Levels";
import { LevelError } from "../services/LevelService";

const GUILD = "90071992547409951";
const USER = "90071992547409952";
const OTHER = "90071992547409953";
const TEXT = "90071992547409954";
const SPAM = "90071992547409955";
const ROLE = "90071992547409956";
const REWARD = "90071992547409957";

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

function FakeGuild(): Guild {
    const channel = (id: string) => ({ id, type: ChannelType.GuildText, name: `kanal-${id.slice(-2)}`, isTextBased: () => true }) as unknown as GuildBasedChannel;
    const role = (id: string, name: string) => ({ id, name }) as unknown as Role;

    return {
        id: GUILD,
        name: "Dev Server",
        channels: { cache: new Map([[TEXT, channel(TEXT)], [SPAM, channel(SPAM)]]) },
        roles: { cache: new Map([[ROLE, role(ROLE, "Stammgast")], [REWARD, role(REWARD, "Level 5")], [GUILD, role(GUILD, "@everyone")]]) },
        members: { cache: new Map() },
    } as unknown as Guild;
}

/** Ein Mitglied, das sich merkt, welche Rollen es bekommen und verloren hat. */
function FakeMember(guild: Guild, id: string, roles: string[] = []): GuildMember & { added: string[]; removed: string[] } {
    const cache = new Map(roles.map((roleId) => [roleId, guild.roles.cache.get(roleId)!]));
    const member = {
        id,
        displayName: id === USER ? "Lara" : "Mo",
        guild,
        user: { id, bot: false, username: "lara" },
        added: [] as string[],
        removed: [] as string[],
        roles: {
            cache,
            add: async (ids: string[] | string) => {
                for (const roleId of Array.isArray(ids) ? ids : [ids]) {
                    member.added.push(roleId);
                    cache.set(roleId, guild.roles.cache.get(roleId)!);
                }
            },
            remove: async (ids: string[] | string) => {
                for (const roleId of Array.isArray(ids) ? ids : [ids]) {
                    member.removed.push(roleId);
                    cache.delete(roleId);
                }
            },
        },
    };

    return member as unknown as GuildMember & { added: string[]; removed: string[] };
}

/* ----------------------------------------------------------
   Die Rechnung
   ---------------------------------------------------------- */
function checkMath(): void {
    console.log("\n  — Punkte und Level —");

    check("Level 0 braucht nichts", XpForLevel(0, 100) === 0);
    check("Level 1 braucht 100", XpForLevel(1, 100) === 100);
    check("Level 5 braucht 1500", XpForLevel(5, 100) === 1500, String(XpForLevel(5, 100)));
    check("Level 10 braucht 5500", XpForLevel(10, 100) === 5500, String(XpForLevel(10, 100)));

    check("Ohne Punkte Level 0", LevelFromXp(0, 100) === 0);
    check("99 Punkte reichen nicht", LevelFromXp(99, 100) === 0);
    check("100 Punkte sind Level 1", LevelFromXp(100, 100) === 1);
    check("5499 Punkte sind Level 9", LevelFromXp(5_499, 100) === 9, String(LevelFromXp(5_499, 100)));

    let consistent = true;

    for (let level = 0; level <= 60; level++) {
        const xp = XpForLevel(level, 100);

        if (LevelFromXp(xp, 100) !== level || LevelFromXp(xp - 1, 100) !== Math.max(0, level - 1)) consistent = false;
    }

    check("Hin und zurück stimmt für 60 Level", consistent);

    const progress = LevelProgress(1_800, 100);

    check("Der Fortschritt kennt das Level", progress.level === 5, String(progress.level));
    check("Und wie weit es ist", progress.into === 300 && progress.need === 600, `${progress.into}/${progress.need}`);
    check("Der Anteil passt", Math.abs(progress.share - 0.5) < 0.001, String(progress.share));

    const steep = LevelProgress(1_800, 250);

    check("Eine steilere Kurve heißt weniger Level", steep.level < progress.level, `${steep.level} statt ${progress.level}`);
}

/* ----------------------------------------------------------
   Einstellungen
   ---------------------------------------------------------- */
function checkSettings(client: BotClient): void {
    console.log("\n  — Einstellungen —");

    const guild = FakeGuild();
    const service = client.levelService;
    const base = DefaultLevelSettings();

    const clean = service.Clean(
        guild,
        {
            chat: { min: 40, max: 10, cooldown: 99_999 },
            voice: { xp: 900 },
            base: 5,
            roleBonus: [{ id: ROLE, factor: 99 }, { id: "123", factor: 2 }, { id: ROLE, factor: 3 }],
            channelBonus: [{ id: TEXT, factor: 0.5 }],
            noChannels: [SPAM, "999"],
            noRoles: [GUILD, ROLE],
            rewards: [{ level: 20, roleId: REWARD }, { level: 5, roleId: ROLE }, { level: 7, roleId: REWARD }],
            announce: "quatsch",
        },
        base
    );

    check("Vertauschte Werte werden getauscht", clean.chat.min === 10 && clean.chat.max === 40, `${clean.chat.min}-${clean.chat.max}`);
    check("Die Sperre wird gedeckelt", clean.chat.cooldown === 3600, String(clean.chat.cooldown));
    check("Voice-Punkte werden gedeckelt", clean.voice.xp === 500, String(clean.voice.xp));
    check("Die Kurve hat eine Untergrenze", clean.base === 10, String(clean.base));
    check("Unbekannte Rollen fallen weg, doppelte auch", clean.roleBonus.length === 1);
    check("Der Faktor wird gedeckelt", clean.roleBonus[0].factor === MAX_FACTOR, String(clean.roleBonus[0].factor));
    check("Ein Faktor unter 1 geht auch", clean.channelBonus[0].factor === 0.5);
    check("Unbekannte Kanäle fallen weg", clean.noChannels.join(",") === SPAM);
    check("@everyone ist keine Ausnahme-Rolle", clean.noRoles.join(",") === ROLE);
    check("Belohnungen stehen der Reihe nach", clean.rewards.map((reward) => reward.level).join(",") === "5,20", clean.rewards.map((r) => r.level).join(","));
    check("Eine Rolle nur einmal", clean.rewards.filter((reward) => reward.roleId === REWARD).length === 1);
    check("Unsinn beim Ziel fällt zurück", clean.announce === base.announce);
    check("Ohne Angabe bleibt alles, wie es war", service.Clean(guild, {}, clean).rewards.length === 2);

    const targeted = service.Clean(guild, { announce: "channel", announceChannelId: TEXT }, base);

    check("Ein echter Kanal wird übernommen", targeted.announceChannelId === TEXT);
    check("Ein erfundener nicht", service.Clean(guild, { announceChannelId: "999" }, base).announceChannelId === null);
    check("Die Vorlage hat Platzhalter", JSON.stringify(DefaultLevelMessage()).includes("{level}"));
}

/* ----------------------------------------------------------
   Die Karte
   ---------------------------------------------------------- */
async function checkCard(): Promise<void> {
    console.log("\n  — Karte —");

    const png = await RenderLevelCard({
        name: "Lara",
        avatarURL: null,
        level: 12,
        xp: 7_800,
        into: 300,
        need: 1_300,
        rank: 1,
        total: 148,
        messages: 1_240,
        voiceMinutes: 860,
    });

    check("Die Karte entsteht", png.length > 5_000, `${png.length} Bytes`);
    check("Es ist wirklich ein PNG", png.subarray(1, 4).toString() === "PNG");

    const empty = await RenderLevelCard({ name: "Neu", avatarURL: null, level: 0, xp: 0, into: 0, need: 100, rank: 0, total: 0, messages: 0, voiceMinutes: 0 });

    check("Auch ohne Punkte", empty.length > 5_000);

    const long = await RenderLevelCard({
        name: "Ein wirklich sehr langer Anzeigename",
        avatarURL: null,
        level: 999,
        xp: 99_999_999,
        into: 1,
        need: 1,
        rank: 148,
        total: 148,
        messages: 999_999,
        voiceMinutes: 100_000,
    });

    check("Auch mit langen Namen und großen Zahlen", long.length > 5_000);
}

/* ----------------------------------------------------------
   Datenbank
   ---------------------------------------------------------- */
async function checkDatabase(client: BotClient): Promise<void> {
    console.log("\n  — Datenbank —");

    const guild = FakeGuild();

    await client.levels.Add(GUILD, USER, 120, { messages: 1, stamp: Date.now() });
    await client.levels.Add(GUILD, USER, 80, { messages: 1 });
    await client.levels.Add(GUILD, OTHER, 50, { voiceMinutes: 3 });

    const entry = await client.levels.Of(GUILD, USER);

    check("Punkte werden addiert", entry?.xp === 200, String(entry?.xp));
    check("Nachrichten werden gezählt", entry?.messages === 2);
    check("Voice-Minuten auch", (await client.levels.Of(GUILD, OTHER))?.voiceMinutes === 3);
    check("Die Sperre merkt sich den Zeitpunkt", (entry?.lastMessage ?? 0) > 0);

    await client.levels.SetLevel(GUILD, USER, 2);

    check("Das Level lässt sich setzen", (await client.levels.Of(GUILD, USER))?.level === 2);

    const top = await client.levels.Top(GUILD, 10);

    check("Die Rangliste sortiert nach Punkten", top[0]?.userId === USER && top[1]?.userId === OTHER);
    check("Die Plätze zählen mit", top[0]?.rank === 1 && top[1]?.rank === 2);
    check("Der Platz einzeln stimmt", (await client.levels.Rank(GUILD, OTHER)) === 2);
    check("Gezählt wird richtig", (await client.levels.Total(GUILD)) === 2);
    check("Wer ein Level hat, wird gefunden", (await client.levels.AtLeast(GUILD, 2)).length === 1);

    console.log("\n  — Punkte von Hand —");

    const service = client.levelService;

    await client.moduleSettings.Save(GUILD, "levels", { ...DefaultLevelSettings(), rewards: [{ level: 1, roleId: REWARD }, { level: 3, roleId: ROLE }], stack: false });

    const member = FakeMember(guild, USER);

    guild.members.cache.set(USER, member);

    const set = await service.Adjust(guild, USER, "set", 1_000);

    check("Setzen rechnet das Level neu", set?.xp === 1_000 && set.level === 4, `${set?.xp}/${set?.level}`);
    check("Dabei kommt die Belohnungsrolle", member.added.includes(ROLE), member.added.join(","));
    check("Ohne Sammeln fliegt die alte weg", member.removed.includes(REWARD) || !member.added.includes(REWARD));

    const added = await service.Adjust(guild, USER, "add", -900);

    check("Abziehen geht auch", added?.xp === 100 && added.level === 1, String(added?.xp));

    await service.Adjust(guild, USER, "reset", 0);

    check("Zurücksetzen löscht den Eintrag", (await client.levels.Of(GUILD, USER)) === null);

    let refused = false;

    try {
        await service.Save(guild, { announce: "channel", announceChannelId: null });
    } catch (error) {
        refused = error instanceof LevelError;
    }

    check("Ohne Kanal kein fester Kanal", refused);

    await service.Reset(guild);

    check("Die ganze Rangliste lässt sich löschen", (await client.levels.Total(GUILD)) === 0);
}

async function cleanup(client: BotClient): Promise<void> {
    await client.databaseService.Write("DELETE FROM levels WHERE guild_id = ?", [GUILD]);
    await client.databaseService.Write("DELETE FROM module_settings WHERE guild_id = ?", [GUILD]);

    client.levels.Forget();
    client.moduleSettings.Forget();

    check("Aufgeräumt", (await client.levels.Total(GUILD)) === 0);
}

async function main(): Promise<void> {
    console.log("\n📈 Level System\n");

    const client = new BotClient();

    await client.configService.Initialize();

    checkMath();
    checkSettings(client);
    await checkCard();

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
