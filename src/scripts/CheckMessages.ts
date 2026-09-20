/**
 * Prüft Custom Message ohne Discord: die Prüfung der Eingaben, die Knöpfe, das
 * Ausrechnen der Termine, die Stichwörter - und, sofern eine Datenbank da ist,
 * die Tabellen dahinter.
 *
 *   npm run check:messages
 *
 * Senden, Nachträgliches Ändern und die Antworten im Chat brauchen einen
 * echten Server; hier wird geprüft, gerechnet und gezeichnet.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import { ChannelType, Guild, GuildBasedChannel, Role } from "discord.js";
import BotClient from "../client/BotClient";
import { CustomMessageView } from "../builder/CustomView";
import { DefaultMessageDoc, DefaultResponseDoc, MAX_BUTTONS, Matches, NextRun, WEEKDAYS } from "../constants/Messages";
import { ISchedule } from "../interfaces/services/messages/IMessages";
import { MessageError } from "../services/MessageService";

const GUILD = "90071992547409941";
const USER = "90071992547409942";
const TEXT = "90071992547409943";
const VOICE = "90071992547409944";
const ROLE = "90071992547409945";

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

function FakeGuild(): Guild {
    const channel = (id: string, type: ChannelType) => ({ id, type, name: `kanal-${id.slice(-2)}`, isTextBased: () => type === ChannelType.GuildText }) as unknown as GuildBasedChannel;

    return {
        id: GUILD,
        name: "Dev Server",
        channels: { cache: new Map([[TEXT, channel(TEXT, ChannelType.GuildText)], [VOICE, channel(VOICE, ChannelType.GuildVoice)]]) },
        roles: { cache: new Map([[ROLE, { id: ROLE, name: "Stammgast" } as unknown as Role], [GUILD, { id: GUILD, name: "@everyone" } as unknown as Role]]) },
    } as unknown as Guild;
}

/* ----------------------------------------------------------
   Eingaben
   ---------------------------------------------------------- */
function checkClean(client: BotClient): void {
    console.log("\n  — Nachrichten prüfen —");

    const guild = FakeGuild();
    const service = client.messageService;
    const valid = { name: "Regeln", doc: DefaultMessageDoc(), buttons: [], channelId: TEXT, schedule: { mode: "off" } };
    const fails = (name: string, input: object, expect: string): void => {
        try {
            service.Clean(guild, { ...valid, ...input });
            check(name, false, "kein Fehler");
        } catch (error) {
            check(name, error instanceof MessageError && error.message.toLowerCase().includes(expect.toLowerCase()), String(error));
        }
    };

    const clean = service.Clean(guild, valid);

    check("Eine gültige Nachricht kommt durch", clean.name === "Regeln" && clean.channelId === TEXT);
    check("Ein Sprachkanal fällt weg", service.Clean(guild, { ...valid, channelId: VOICE }).channelId === null);
    fails("Ohne Namen geht nichts", { name: "  " }, "Namen");
    fails("Ohne Inhalt auch nicht", { doc: { blocks: [] } }, "leer");

    console.log("\n  — Knöpfe —");

    const buttons = service.CleanButtons(guild, [
        { label: "Rolle", action: "role", roleId: ROLE, mode: "add", tone: "success" },
        { label: "Ohne Rolle", action: "role", roleId: "999" },
        { label: "Link", action: "link", url: "https://nexus-emb.de" },
        { label: "Kaputter Link", action: "link", url: "javascript:alert(1)" },
        { label: "Text", action: "text", text: "Nur für dich." },
        { label: "Leerer Text", action: "text", text: "  " },
        { label: "", action: "text", text: "Ohne Beschriftung" },
        ...Array.from({ length: 12 }, () => ({ label: "Viele", action: "text", text: "x" })),
    ]);

    check("Nur gültige Knöpfe bleiben", buttons.filter((entry) => entry.label === "Ohne Rolle" || entry.label === "Kaputter Link").length === 0);
    check("Die Rolle kommt mit", buttons[0]?.roleId === ROLE && buttons[0].mode === "add");
    check("Die Farbe auch", buttons[0]?.tone === "success");
    check("Links bleiben Links", buttons.some((entry) => entry.action === "link" && entry.url?.startsWith("https://")));
    check("Höchstens zehn Knöpfe", buttons.length === MAX_BUTTONS, String(buttons.length));
    check("Jede ID nur einmal", new Set(buttons.map((entry) => entry.id)).size === buttons.length);

    console.log("\n  — Termine —");

    const daily: ISchedule = { mode: "daily", at: null, hour: 18, minute: 30, weekday: 1, next: null, replace: false };
    const next = NextRun(daily, Date.UTC(2026, 8, 20, 6, 0));

    check("Täglich findet einen Zeitpunkt", next !== null);
    check("Der Zeitpunkt liegt in der Zukunft", (next ?? 0) > Date.UTC(2026, 8, 20, 6, 0));
    check("Die Uhrzeit stimmt", next !== null && new Date(next).getHours() === 18 && new Date(next).getMinutes() === 30);

    const weekly = NextRun({ ...daily, mode: "weekly", weekday: 3 }, Date.now());

    check("Wöchentlich trifft den Wochentag", weekly !== null && new Date(weekly).getDay() === 3, weekly ? WEEKDAYS[new Date(weekly).getDay()] : "nichts");
    check("Ohne Termin kein Zeitpunkt", NextRun({ ...daily, mode: "off" }) === null);
    check("Ein vergangener Einzeltermin zählt nicht", NextRun({ ...daily, mode: "once", at: Date.now() - 1000 }) === null);
    check("Ein künftiger schon", NextRun({ ...daily, mode: "once", at: Date.now() + 60_000 }) !== null);

    let refused = false;

    try {
        service.CleanSchedule({ mode: "once", at: Date.now() - 10_000 });
    } catch (error) {
        refused = error instanceof MessageError;
    }

    check("Ein Termin in der Vergangenheit wird abgelehnt", refused);
    check("Der nächste Termin wird gleich ausgerechnet", service.CleanSchedule({ mode: "daily", hour: 9, minute: 0 }).next !== null);
}

/* ----------------------------------------------------------
   Stichwörter
   ---------------------------------------------------------- */
function checkResponses(client: BotClient): void {
    console.log("\n  — Stichwörter —");

    const guild = FakeGuild();
    const service = client.messageService;

    check("enthält", Matches("Wann ist denn Training?", "training", "contains"));
    check("enthält nicht", !Matches("Nichts dergleichen", "training", "contains"));
    check("ist genau", Matches("  Training  ", "training", "exact"));
    check("ist genau (nur genau)", !Matches("Training heute?", "training", "exact"));
    check("beginnt mit", Matches("Training heute?", "training", "starts"));
    check("Regex", Matches("Um 20:00 Uhr", "\\d{2}:\\d{2}", "regex"));
    check("Eine kaputte Regex löst nichts aus", !Matches("egal", "(unfertig", "regex"));
    check("Ein leeres Stichwort auch nicht", !Matches("egal", "  ", "contains"));

    const clean = service.CleanResponse(guild, {
        phrase: " Discord Link ",
        match: "starts",
        doc: DefaultResponseDoc(),
        settings: { reply: false, cooldown: 99_999, channels: [TEXT, "999"], roles: [ROLE], ignoreRoles: [GUILD] },
    });

    check("Das Stichwort wird sauber übernommen", clean.phrase === "Discord Link");
    check("Der Vergleich kommt mit", clean.match === "starts");
    check("Die Sperre wird gedeckelt", clean.settings.cooldown === 3600, String(clean.settings.cooldown));
    check("Unbekannte Kanäle fallen weg", clean.settings.channels.join(",") === TEXT);
    check("Rollen bleiben", clean.settings.roles.join(",") === ROLE);

    let refused = false;

    try {
        service.CleanResponse(guild, { phrase: "(kaputt", match: "regex", doc: DefaultResponseDoc() });
    } catch (error) {
        refused = error instanceof MessageError;
    }

    check("Eine kaputte Regex wird abgelehnt", refused);
}

/* ----------------------------------------------------------
   Die Karte
   ---------------------------------------------------------- */
async function checkView(client: BotClient): Promise<void> {
    console.log("\n  — Karte in Discord —");

    const buttons = client.messageService.CleanButtons(FakeGuild(), [
        { label: "Rolle", action: "role", roleId: ROLE },
        { label: "Link", action: "link", url: "https://nexus-emb.de" },
        { label: "Text", action: "text", text: "Nur für dich." },
        ...Array.from({ length: 5 }, (_, index) => ({ label: `Nr ${index}`, action: "text", text: "x" })),
    ]);
    const view = await CustomMessageView(client, 7, DefaultMessageDoc(), buttons, { guild: "Dev Server" });
    const json = JSON.stringify(view.components[0].toJSON());

    check("Die Karte entsteht", view.components.length === 1);
    check("Der Rollen-Knopf trägt die IDs", json.includes("cm:btn:7:"));
    check("Der Link-Knopf hat keine Custom-ID", json.includes("nexus-emb.de"));
    check("Acht Knöpfe ergeben zwei Reihen", (json.match(/"type":1,/g) ?? []).length >= 2, json.slice(0, 120));
    check("Ohne Knöpfe geht es auch", (await CustomMessageView(client, 1, DefaultResponseDoc(), [])).components.length === 1);
}

/* ----------------------------------------------------------
   Datenbank
   ---------------------------------------------------------- */
async function checkDatabase(client: BotClient): Promise<void> {
    console.log("\n  — Datenbank —");

    const message = await client.customMessages.Create({
        guildId: GUILD,
        name: "Regeln",
        doc: DefaultMessageDoc(),
        buttons: client.messageService.CleanButtons(FakeGuild(), [{ label: "Rolle", action: "role", roleId: ROLE }]),
        channelId: TEXT,
        schedule: { mode: "daily", at: null, hour: 9, minute: 0, weekday: 1, next: Date.now() - 1000, replace: true },
        createdBy: USER,
    });

    check("Die Nachricht steht in der Tabelle", message.id > 0 && message.buttons.length === 1);
    check("Sie steht beim Server", (await client.customMessages.OfGuild(GUILD)).length === 1);
    check("Was fällig ist, wird gefunden", (await client.customMessages.Due(Date.now())).some((entry) => entry.id === message.id));

    await client.customMessages.Save(message.id, { messageId: "900000000000000001", schedule: { ...message.schedule, next: Date.now() + 86_400_000 } });

    const saved = await client.customMessages.Get(message.id);

    check("Die gesendete Nachricht wird gemerkt", saved?.messageId === "900000000000000001");
    check("Und der nächste Termin auch", !(await client.customMessages.Due(Date.now())).some((entry) => entry.id === message.id));

    const response = await client.autoResponses.Create({
        guildId: GUILD,
        phrase: "training",
        match: "contains",
        doc: DefaultResponseDoc(),
        settings: { reply: true, delete: false, quiet: false, cooldown: 30, channels: [], roles: [], ignoreRoles: [] },
        createdBy: USER,
    });

    check("Das Stichwort steht in der Tabelle", response.id > 0 && response.enabled);

    await client.autoResponses.Used(response.id);

    check("Benutzungen werden gezählt", (await client.autoResponses.Get(response.id))?.uses === 1);

    await client.autoResponses.Save(response.id, { enabled: false, phrase: "training heute" });

    const changed = await client.autoResponses.Get(response.id);

    check("Ausschalten klappt", changed?.enabled === false);
    check("Ändern auch", changed?.phrase === "training heute");

    await client.customMessages.Remove(message.id);
    await client.autoResponses.Remove(response.id);

    check("Löschen klappt", (await client.customMessages.OfGuild(GUILD)).length === 0 && (await client.autoResponses.OfGuild(GUILD)).length === 0);
}

async function cleanup(client: BotClient): Promise<void> {
    await client.databaseService.Write("DELETE FROM custom_messages WHERE guild_id = ?", [GUILD]);
    await client.databaseService.Write("DELETE FROM auto_responses WHERE guild_id = ?", [GUILD]);

    client.customMessages.Forget();
    client.autoResponses.Forget();

    check("Aufgeräumt", (await client.customMessages.OfGuild(GUILD)).length === 0);
}

async function main(): Promise<void> {
    console.log("\n✉️ Custom Message\n");

    const client = new BotClient();

    await client.configService.Initialize();

    checkClean(client);
    checkResponses(client);
    await checkView(client);

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
