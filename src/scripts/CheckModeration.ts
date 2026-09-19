/**
 * Prüft das Moderations-Modul ohne Discord: Dauer-Angaben, Stufen, die Prüfung
 * der Einstellungen, Log-Ziele (Textkanal oder Forum-Beitrag), die Karten in
 * Discord - und, sofern eine Datenbank da ist, die Tabellen dahinter.
 *
 *   npm run check:moderation
 *
 * Wie check:tickets ohne Test-Framework. Alles Geschriebene hängt an einer
 * erfundenen Guild-ID und wird am Ende wieder entfernt. Bannen, Kicken und
 * Timeouts selbst brauchen einen echten Server - die fängt erst ein Lauf dort.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import { ChannelType, Guild, GuildBasedChannel } from "discord.js";
import BotClient from "../client/BotClient";
import { CaseView, DirectView, DoneView, HistoryView, StatusText } from "../builder/ModerationView";
import { DefaultModConfig, FormatDuration, MAX_REASON, ParseDuration, StageFor } from "../constants/Moderation";
import { IModCase } from "../interfaces/services/moderation/IModeration";
import { ModerationError } from "../services/ModerationService";
import { IsLogTarget } from "../utils/logtarget";
import { ReadDuration } from "../utils/modcommand";

// Erfundene Snowflakes - 17-stellig wie echte, aber es gibt sie bei Discord nicht.
const GUILD = "90071992547409981";
const USER = "90071992547409982";
const MOD = "90071992547409983";
const TEXT = "90071992547409984";
const THREAD = "90071992547409985";
const VOICE = "90071992547409986";
const FORUM = "90071992547409987";

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

function FakeGuild(): Guild {
    const channel = (id: string, type: ChannelType) => ({ id, type }) as unknown as GuildBasedChannel;

    return {
        id: GUILD,
        channels: {
            cache: new Map([
                [TEXT, channel(TEXT, ChannelType.GuildText)],
                [THREAD, channel(THREAD, ChannelType.PublicThread)],
                [VOICE, channel(VOICE, ChannelType.GuildVoice)],
                [FORUM, channel(FORUM, ChannelType.GuildForum)],
            ]),
        },
    } as unknown as Guild;
}

function SampleCase(patch: Partial<IModCase> = {}): IModCase {
    return {
        id: 1,
        guildId: GUILD,
        number: 12,
        action: "warn",
        targetId: USER,
        targetName: "xX_Dribbler_Xx",
        moderatorId: MOD,
        moderatorName: "Helfer Hanna",
        reason: "Spam in #allgemein",
        duration: null,
        expiresAt: null,
        active: true,
        source: "dashboard",
        related: null,
        details: { warns: 3, dm: true, stage: { warns: 3, action: "timeout", duration: 3_600, case: 13 } },
        evidence: [],
        notes: [],
        logChannel: null,
        logMessage: null,
        createdAt: Date.now(),
        ...patch,
    };
}

function checkDurations(): void {
    console.log("\n  — Dauer-Angaben —");

    const cases: [string, number | null][] = [
        ["10m", 600],
        ["1h30m", 5_400],
        ["1h 30m", 5_400],
        ["2 Tage", 172_800],
        ["90", 5_400],
        ["1w", 604_800],
        ["3 foo", null],
        ["abc", null],
        ["", null],
    ];

    for (const [text, expected] of cases) check(`"${text}" → ${expected}`, ParseDuration(text) === expected, String(ParseDuration(text)));

    check("5400 s heißen 1 Std. 30 Min.", FormatDuration(5_400) === "1 Std. 30 Min.", FormatDuration(5_400));
    check("Eine Woche heißt 7 Tage", FormatDuration(604_800) === "7 Tage", FormatDuration(604_800));
    check("Unter einer Minute in Sekunden", FormatDuration(45) === "45 Sek.", FormatDuration(45));
    check("\"dauerhaft\" beim Bann: keine Dauer", ReadDuration("dauerhaft", true) === null);

    let threw = false;

    try {
        ReadDuration("3 foo", true);
    } catch (error) {
        threw = error instanceof ModerationError;
    }

    check("Ein Tippfehler wird kein dauerhafter Bann", threw);
}

function checkStages(client: BotClient): void {
    console.log("\n  — Stufen —");

    const stages = DefaultModConfig().stages;

    check("Standard: 3 Verwarnungen → Timeout", StageFor(stages, 3)?.action === "timeout");
    check("Standard: bei der vierten passiert nichts", StageFor(stages, 4) === null);
    check("Standard: 5 Verwarnungen → Kick", StageFor(stages, 5)?.action === "kick");

    const cleaned = client.moderationService.CleanStages([
        { warns: 5, action: "kick", duration: 999 },
        { warns: 2, action: "timeout", duration: 600 },
        { warns: 2, action: "ban", duration: null },
        { warns: 7, action: "timeout" },
        { warns: 8, action: "ban", duration: null },
        { warns: 0, action: "kick" },
        { warns: 9, action: "explode" },
        "quatsch",
    ]);

    check("Ungültige Stufen fallen raus, doppelte Zahlen auch", cleaned.length === 3, JSON.stringify(cleaned));
    check("Aufsteigend sortiert", cleaned.map((stage) => stage.warns).join(",") === "2,5,8", JSON.stringify(cleaned));
    check("Ein Kick hat keine Dauer", cleaned.find((stage) => stage.action === "kick")?.duration === null);
    check("Ein Bann ohne Dauer bleibt dauerhaft", cleaned.find((stage) => stage.action === "ban")?.duration === null);
}

function checkConfig(client: BotClient): void {
    console.log("\n  — Einstellungen und Log-Ziele —");

    const guild = FakeGuild();
    const previous = DefaultModConfig();
    const service = client.moderationService;

    check("Ein Textkanal ist ein Log-Ziel", IsLogTarget(guild.channels.cache.get(TEXT)));
    check("Ein Forum-Beitrag (Thread) auch", IsLogTarget(guild.channels.cache.get(THREAD)));
    check("Ein Sprachkanal nicht", !IsLogTarget(guild.channels.cache.get(VOICE)));
    check("Das Forum selbst nicht - nur seine Beiträge", !IsLogTarget(guild.channels.cache.get(FORUM)));

    check("Log in einen Forum-Beitrag wird gespeichert", service.Clean(guild, { logChannelId: THREAD }, previous).logChannelId === THREAD);
    check("Ein fremder Kanal wird zu keinem", service.Clean(guild, { logChannelId: "12345678901234567" }, previous).logChannelId === null);
    check("Ohne Angabe bleibt der Log-Kanal", service.Clean(guild, {}, { ...previous, logChannelId: TEXT }).logChannelId === TEXT);
    check("Verwarnungen zählen höchstens ein Jahr", service.Clean(guild, { warnDays: 9999 }, previous).warnDays === previous.warnDays);
    check("30 Tage gehen", service.Clean(guild, { warnDays: 30 }, previous).warnDays === 30);

    let threw = false;

    try {
        service.Clean(guild, "kaputt", previous);
    } catch (error) {
        threw = error instanceof ModerationError;
    }

    check("Keine Einstellungen - ein klarer Fehler", threw);
}

function checkViews(): void {
    console.log("\n  — Karten in Discord —");

    const warn = SampleCase();
    const ban = SampleCase({ number: 9, action: "ban", duration: 604_800, expiresAt: Date.now() + 604_800_000, details: { deleteSeconds: 86_400, dm: false } });
    const ended = SampleCase({ active: false, details: { ended: { how: "lifted", at: Date.now(), by: MOD, byName: "Helfer Hanna", reason: null, case: 14 } } });
    const long = SampleCase({ reason: "x".repeat(MAX_REASON), notes: Array.from({ length: 50 }, (_, index) => ({ id: index, by: MOD, byName: "Hanna", at: 0, text: "y".repeat(1000) })) });

    for (const [name, entry] of [["Verwarnung", warn], ["Bann", ban], ["aufgehoben", ended], ["sehr lang", long]] as const) {
        let fine = true;

        try {
            CaseView(entry, "https://example.com/fall");
            DirectView(entry, "Dev Server");
            DoneView(entry, true);
        } catch (error) {
            fine = false;
            check(`Karten für "${name}"`, false, String(error));
        }

        if (fine) check(`Karten für "${name}" bauen sich`, true);
    }

    check("Status: gilt bis …", StatusText(ban).startsWith("gilt bis"));
    check("Status: aufgehoben durch Fall #14", StatusText(ended).includes("#14"), StatusText(ended));
    check("Verlauf mit zehn Fällen", HistoryView("Kevin", Array.from({ length: 10 }, () => warn), { warn: 10 }, null).components.length === 1);

    const dm = JSON.stringify(DirectView(warn, "Dev Server").components[0].toJSON());

    check("Die DM nennt den Moderator nicht", !dm.includes("Helfer Hanna"));
    check("Die DM nennt die Zahl der Verwarnungen", dm.includes("3."));
}

async function checkDatabase(client: BotClient): Promise<void> {
    console.log("\n  — Datenbank —");

    const cases = client.modCases;
    const base = {
        guildId: GUILD,
        targetId: USER,
        targetName: "Kevin",
        moderatorId: MOD,
        moderatorName: "Hanna",
        reason: "Test",
        duration: null,
        expiresAt: null,
        source: "dashboard" as const,
        related: null,
        details: {},
    };

    const first = await cases.Create({ ...base, action: "warn", active: true });
    const second = await cases.Create({ ...base, action: "timeout", active: true, duration: 60, expiresAt: Date.now() - 1_000, related: first.number });

    check("Fälle werden je Server fortlaufend nummeriert", second.number === first.number + 1, `${first.number}, ${second.number}`);
    check("Fall #1 steht wieder so da", (await cases.Get(GUILD, first.number))?.reason === "Test");
    check("Suche nach Nummer", (await cases.List(GUILD, { query: `#${second.number}` }, null, 10)).length === 1);
    check("Suche nach User-ID", (await cases.List(GUILD, { query: USER }, null, 10)).length === 2);
    check("Filter: nur Verwarnungen", (await cases.List(GUILD, { action: "warn" }, null, 10)).every((entry) => entry.action === "warn"));
    check("Aktive Verwarnungen des Users", (await cases.ActiveOf(GUILD, USER, "warn")).length === 1);
    check("Zählen je Aktion", (await cases.CountsOf(GUILD, USER)).timeout === 1);
    check("Der abgelaufene Timeout ist fällig", (await cases.Due(Date.now())).some((entry) => entry.id === second.id));
    check("Zusammenhang: der Timeout bezieht sich auf den Warn", (await cases.RelatedTo(GUILD, first.number)).some((entry) => entry.id === second.id));

    const noted = await cases.Mutate(first.id, (current) => ({ notes: [...current.notes, { id: 1, by: MOD, byName: "Hanna", at: Date.now(), text: "Notiz" }] }));

    check("Eine Notiz wird angehängt", noted?.notes.length === 1);

    const ended = await cases.Mutate(first.id, (current) => ({ active: false, details: { ...current.details, ended: { how: "lifted", at: Date.now(), by: MOD, byName: "Hanna", reason: null, case: second.number } } }));

    check("Beenden setzt den Status", ended?.active === false && ended.details.ended?.case === second.number);
    check("Die Zahlen oben", (await cases.Stats(GUILD)).total === 2);

    let rolled = false;

    try {
        await cases.Mutate(first.id, () => {
            throw new ModerationError("abgelehnt");
        });
    } catch (error) {
        rolled = error instanceof ModerationError;
    }

    check("Ein Fehler beim Ändern lässt den Fall, wie er war", rolled && (await cases.ById(first.id))?.notes.length === 1);

    const config = { ...DefaultModConfig(), logChannelId: THREAD, warnDays: 30 };

    await client.modSettings.Save(GUILD, config);

    const stored = await client.modSettings.Of(GUILD);

    check("Einstellungen kommen so zurück", stored.logChannelId === THREAD && stored.warnDays === 30 && stored.stages.length === 2);
}

async function cleanup(client: BotClient): Promise<void> {
    await client.databaseService.Write("DELETE FROM mod_cases WHERE guild_id = ?", [GUILD]);
    await client.databaseService.Write("DELETE FROM mod_settings WHERE guild_id = ?", [GUILD]);

    client.modCases.Forget();
    client.modSettings.Forget();

    check("Aufgeräumt", (await client.modCases.List(GUILD, {}, null, 10)).length === 0);
}

async function main(): Promise<void> {
    console.log("\n🛡️ Moderation\n");

    const client = new BotClient();

    await client.configService.Initialize();

    checkDurations();
    checkStages(client);
    checkConfig(client);
    checkViews();

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
