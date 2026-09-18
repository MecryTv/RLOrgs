/**
 * Prüft das Ticket-System ohne Discord: die Aktionsliste aus der Konfiguration,
 * die Platzhalter, die Prüfung der Einstellungen (TicketService.Clean), das
 * Aktions-Menü und - sofern eine Datenbank da ist - die Tabellen dahinter.
 *
 *   npm run check:tickets
 *
 * Absichtlich ohne Test-Framework - der Bot hat keins, und ein Durchlauf reicht.
 *
 * Alles Geschriebene hängt an einer erfundenen Guild-ID und wird am Ende wieder
 * entfernt. Was nur mit echter Discord-Verbindung ginge (Kanäle anlegen, Relay,
 * Webhooks), steht hier nicht - das fängt erst ein Lauf auf einem Testserver.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import { ChannelType, Guild } from "discord.js";
import BotClient from "../client/BotClient";
import { CleanDoc, IsImageSource } from "../builder/MessageDoc";
import { MenuOptions, PanelView } from "../builder/TicketPanel";
import { Fill, PLACEHOLDER_KEYS } from "../constants/Placeholders";
import {
    ACTIONS,
    ACTIONS_CONFIG,
    CORE_ACTIONS,
    DefaultConfig,
    DELETE_NOW,
    DeleteLabel,
    MESSAGE_KEYS,
    TicketNumber,
} from "../constants/Tickets";
import { ITicket, ITicketConfig } from "../interfaces/services/tickets/ITicket";
import { SlowmodeLabel } from "../services/TicketService";

// Erfundene Snowflakes - 17-stellig wie echte, aber es gibt sie bei Discord nicht.
const GUILD = "90071992547409991";
const USER = "90071992547409992";
const STAFF = "90071992547409993";
const ROLE = "90071992547409994";
const CATEGORY = "90071992547409995";
const FORUM = "90071992547409996";
const BOT = "90071992547409997";

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

/** Ein Server, wie Clean() ihn anfasst: Rollen und Kanäle nachschlagen, sonst nichts. */
function FakeGuild(): Guild {
    return {
        id: GUILD,
        roles: { cache: new Map([[ROLE, { id: ROLE }]]) },
        channels: {
            cache: new Map([
                [CATEGORY, { id: CATEGORY, type: ChannelType.GuildCategory }],
                [FORUM, { id: FORUM, type: ChannelType.GuildForum }],
            ]),
        },
    } as unknown as Guild;
}

function FakeTicket(patch: Partial<ITicket> = {}): ITicket {
    return {
        id: 1,
        guildId: GUILD,
        number: 42,
        optionId: "support",
        openerId: USER,
        contact: "direct",
        channelId: "1",
        messageId: "2",
        claimedBy: null,
        status: "open",
        priority: null,
        slowmode: 0,
        members: [],
        notes: [],
        anonymous: [],
        messages: 0,
        reminderAt: null,
        deleteAt: null,
        createdAt: new Date(),
        closedAt: null,
        ...patch,
    };
}

/**
 * Die Liste im Menü kommt aus src/config/ticketactions.json, die Logik aus
 * ACTIONS. Laufen beide auseinander, fehlt im Ticket ein Eintrag oder es steht
 * einer da, den kein Handler kennt.
 */
function checkConfig(client: BotClient): void {
    console.log("\n  — Aktionsliste —");

    const entries = client.configService.Options(ACTIONS_CONFIG, "options");
    const values = entries.map((entry) => entry.value);

    check(`ticketactions.json ist geladen (${entries.length} Aktionen)`, entries.length > 0);
    check(
        "Jede Aktion aus ACTIONS steht in der Datei",
        ACTIONS.every((action) => values.includes(action)),
        ACTIONS.filter((action) => !values.includes(action)).join(", ")
    );
    check(
        "Die Datei kennt keine Aktion, die der Bot nicht kennt",
        values.every((value) => (ACTIONS as readonly string[]).includes(value)),
        values.filter((value) => !(ACTIONS as readonly string[]).includes(value)).join(", ")
    );
    check(
        "Jede Aktion hat Name, Beschreibung und Emoji",
        entries.every((entry) => entry.name && entry.description && entry.emoji),
        entries.filter((entry) => !entry.name || !entry.description || !entry.emoji).map((entry) => entry.value).join(", ")
    );
    check(
        "Die festen Aktionen stehen ebenfalls darin",
        CORE_ACTIONS.every((action) => values.includes(action))
    );
    check("Die Nummer wird vierstellig geschrieben", TicketNumber(42) === "#0042", TicketNumber(42));
    check("Slowmode-Beschriftung", SlowmodeLabel(0) === "Aus" && SlowmodeLabel(30) === "30 Sekunden" && SlowmodeLabel(300) === "5 Minuten");
}

function checkPlaceholders(): void {
    console.log("\n  — Platzhalter —");

    const values = { user: "<@1>", "ticket.id": "#0042" };

    check("Bekannte Platzhalter werden ersetzt", Fill("Hallo {user}", values) === "Hallo <@1>");
    check("Unbekannte bleiben stehen", Fill("{gibt.es.nicht}", values) === "{gibt.es.nicht}", Fill("{gibt.es.nicht}", values));
    check("Mehrere in einer Zeile", Fill("{user} · {ticket.id}", values) === "<@1> · #0042");
    check("Die Liste ist eindeutig", new Set(PLACEHOLDER_KEYS).size === PLACEHOLDER_KEYS.length);
}

function checkDocs(): void {
    console.log("\n  — Nachrichten-Dokumente —");

    const doc = CleanDoc(
        {
            accent: "#FF1E2D",
            blocks: [
                { type: "text", body: "Hallo {user}" },
                { type: "image", images: [`${GUILD}/custom/logo.webp`, "https://example.com/x.png", "kaputt"] },
                { type: "image", images: ["99999999999999999/fremd/logo.webp"] },
                { type: "separator", big: true, line: false },
                { type: "quatsch" },
            ],
        },
        GUILD
    );

    check("Ein gültiges Dokument kommt durch", doc !== null);
    check("Die Farbe wird klein geschrieben", doc?.accent === "#ff1e2d", String(doc?.accent));
    check("Unbekannte Bausteine fallen raus", doc?.blocks.length === 3, JSON.stringify(doc?.blocks.map((block) => block.type)));

    const images = doc?.blocks.find((block) => block.type === "image");

    check(
        "Kaputte Bildquellen fallen raus",
        images?.type === "image" && images.images.length === 2,
        JSON.stringify(images?.type === "image" ? images.images : null)
    );
    check("Ein Bild aus einem fremden Server wird abgelehnt", !IsImageSource("99999999999999999/fremd/logo.webp", GUILD));
    check("Vorlagen sind für jeden erlaubt", IsImageSource("default/rocketleague/logo.png", GUILD));
    check("Bild-Platzhalter sind erlaubt", IsImageSource("{user.avatar}", GUILD));
    check("http wird abgelehnt", !IsImageSource("http://example.com/x.png", GUILD));
    check("Kein Dokument ohne blocks", CleanDoc({ accent: "#ffffff" }, GUILD) === null);
    check("Die Standard-Nachrichten sind vollständig", MESSAGE_KEYS.every((key) => DefaultConfig().messages[key].blocks.length > 0));
}

function checkClean(client: BotClient): void {
    console.log("\n  — Einstellungen prüfen —");

    const guild = FakeGuild();
    const previous = DefaultConfig();

    const config = client.ticketService.Clean(
        guild,
        {
            contact: "modmail",
            surface: "forum",
            style: "select",
            supportRoleId: ROLE,
            forumId: FORUM,
            limit: 3,
            deleteAfter: 24,
            actions: ["freeze", "close", "gibt-es-nicht", "freeze"],
            options: [
                { name: "Bewerbung", description: "Team-Bewerbung", emoji: "📝", categoryId: CATEGORY, supportRoleId: ROLE },
                { name: "Bewerbung", description: "", emoji: "<:kaputt:123>", categoryId: "erfunden" },
            ],
        },
        previous
    ) as ITicketConfig;

    check("Kontakt und Oberfläche werden übernommen", config.contact === "modmail" && config.surface === "forum");
    check("Die Support-Rolle muss es geben", config.supportRoleId === ROLE);
    check("Eine erfundene Kategorie fällt weg", config.options[1].categoryId === null, String(config.options[1].categoryId));
    check("Feste Aktionen stehen nie in der Liste", !config.actions.includes("close" as never), config.actions.join(", "));
    check("Unbekannte Aktionen fallen weg", !config.actions.includes("gibt-es-nicht" as never));
    check("Doppelte Aktionen fallen weg", config.actions.filter((action) => action === "freeze").length === 1);
    check("Zwei gleiche Namen bekommen verschiedene IDs", config.options[0].id !== config.options[1].id, config.options.map((option) => option.id).join(", "));
    check("Die ID entsteht aus dem Namen", config.options[0].id === "bewerbung", config.options[0].id);
    check("Ein Server-Emoji, das es nicht gibt, fällt weg", config.options[1].emoji === null, String(config.options[1].emoji));
    check("Ein Standard-Emoji bleibt", config.options[0].emoji === "📝", String(config.options[0].emoji));
    check("Panel und Tags bleiben unangetastet", config.panel.channelId === null && config.tags.closed === null);

    const kept = client.ticketService.Clean(guild, { limit: 99, deleteAfter: 7 }, config) as ITicketConfig;

    check("Ein unmögliches Limit bleibt beim alten Wert", kept.limit === 3, String(kept.limit));
    check("Eine unbekannte Löschfrist bleibt beim alten Wert", kept.deleteAfter === 24, String(kept.deleteAfter));
    check(
        "„Sofort“ ist eine gültige Löschfrist",
        client.ticketService.Clean(guild, { deleteAfter: DELETE_NOW }, config).deleteAfter === DELETE_NOW && DeleteLabel(DELETE_NOW) === "sofort"
    );
    check("Was nicht mitkommt, bleibt stehen", kept.options.length === 2 && kept.contact === "modmail");

    let thrown: unknown;

    try {
        client.ticketService.Clean(guild, { options: [{ name: "   " }] }, config);
    } catch (error) {
        thrown = error;
    }

    check("Eine Option ohne Namen wird abgelehnt", thrown instanceof Error, String(thrown));
    check("Emoji-Prüfung: Unicode ja, Buchstaben nein", client.ticketService.CleanEmoji("✅") === "✅" && client.ticketService.CleanEmoji("abc") === null);
}

function checkMenu(client: BotClient): void {
    console.log("\n  — Aktions-Menü —");

    const config = DefaultConfig();

    config.actions = ["freeze", "priority"];

    const open = MenuOptions(client, config, FakeTicket());
    const claimed = MenuOptions(client, config, FakeTicket({ claimedBy: STAFF }));
    const frozen = MenuOptions(client, config, FakeTicket({ status: "frozen" }));
    const values = open.map((entry) => entry.value);

    check("Feste Aktionen stehen immer im Menü", CORE_ACTIONS.filter((action) => action !== "unclaim").every((action) => values.includes(action)), values.join(", "));
    check("Zugeschaltete Aktionen stehen im Menü", values.includes("freeze") && values.includes("priority"));
    check("Abgeschaltete Aktionen fehlen", !values.includes("blacklist") && !values.includes("media_vault"));
    check("Ohne Bearbeiter gibt es kein Zurückgeben", !values.includes("unclaim") && values.includes("claim"));
    check("Mit Bearbeiter ist es umgekehrt", claimed.map((entry) => entry.value).includes("unclaim") && !claimed.map((entry) => entry.value).includes("claim"));
    check("Ein eingefrorenes Ticket bietet das Auftauen an", frozen.find((entry) => entry.value === "freeze")?.label === "Ticket auftauen");
    check("Das Menü bleibt unter Discords Grenze von 25", MenuOptions(client, { ...config, actions: [...ACTIONS] as never }, FakeTicket()).length <= 25);
}

/**
 * Das Panel: Klassisch zeigt den normalen Text, ModMail den DM-Hinweis mit einem
 * Knopf zum Bot - die Themen bleiben in beiden Fällen stehen.
 */
async function checkPanel(client: BotClient): Promise<void> {
    console.log("\n  — Panel —");

    // Ohne Login gibt es keinen client.user; für Erwähnung und Link reicht eine ID.
    (client as unknown as { user: unknown }).user = { id: BOT, displayName: "RL Nexus" };

    const guild = {
        id: GUILD,
        name: "Check-Server",
        memberCount: 3,
        iconURL: () => null,
        roles: { cache: new Map() },
        client,
    } as unknown as Guild;

    const text = (view: Awaited<ReturnType<typeof PanelView>>) =>
        JSON.stringify(view.components.map((component) => component.toJSON()));

    const config = DefaultConfig();
    const direct = text(await PanelView(client, guild, config));

    config.contact = "modmail";

    const modmail = text(await PanelView(client, guild, config));

    check("Klassisch: das normale Panel ohne Link zum Bot", direct.includes("Support") && !direct.includes("discord.com/users/"));
    check("ModMail: der DM-Hinweis steht im Panel", modmail.includes("Support per DM"), modmail.slice(0, 160));
    check("ModMail: {bot} wird zur Erwähnung des Bots", modmail.includes(`<@${BOT}>`));
    check("ModMail: ein Knopf führt zum Bot", modmail.includes(`https://discord.com/users/${BOT}`));
    check("ModMail: die Themen bleiben stehen", modmail.includes("ticket:open:support"));
}

async function checkDatabase(client: BotClient): Promise<void> {
    console.log("\n  — Datenbank —");

    const tickets = client.tickets;

    // Zwei Tickets im selben Augenblick: die Nummern müssen verschieden sein.
    const [first, second] = await Promise.all([
        tickets.Create(GUILD, "support", USER, "direct"),
        tickets.Create(GUILD, "support", STAFF, "direct"),
    ]);

    check("Zwei gleichzeitige Tickets bekommen verschiedene Nummern", first.number !== second.number, `${first.number} / ${second.number}`);
    check("Die Nummern beginnen bei 1", Math.min(first.number, second.number) === 1, String(Math.min(first.number, second.number)));
    check("Ein frisches Ticket ist offen und leer", first.status === "open" && first.members.length === 0 && first.notes.length === 0);

    await tickets.Patch(first.id, {
        channelId: "111111111111111111",
        messageId: "222222222222222222",
        claimedBy: STAFF,
        priority: "high",
        members: [STAFF],
        notes: [{ by: STAFF, at: Date.now(), text: "Notiz" }],
        reminderAt: Date.now() - 1000,
    });

    const patched = await tickets.Get(first.id);

    check("Gepatchte Felder kommen zurück", patched?.claimedBy === STAFF && patched?.priority === "high", JSON.stringify({ claimedBy: patched?.claimedBy, priority: patched?.priority }));
    check("JSON-Spalten bleiben Listen", patched?.members.length === 1 && patched?.notes[0]?.text === "Notiz");
    check("Das Ticket ist über seinen Kanal auffindbar", (await tickets.ByChannel("111111111111111111"))?.id === first.id);
    check("Offene Tickets eines Users", (await tickets.OpenOf(GUILD, USER)).length === 1);

    const due = await tickets.DueReminders(Date.now());

    check("Ein fälliger Termin wird gefunden", due.some((ticket) => ticket.id === first.id));

    await tickets.Patch(first.id, { status: "closed", closedAt: new Date(), reminderAt: null, deleteAt: Date.now() - 1000 });

    check("Geschlossene Tickets fallen aus der Liste", (await tickets.OpenOf(GUILD, USER)).length === 0);
    check("Eine fällige Löschung wird gefunden", (await tickets.DueDeletions(Date.now())).some((ticket) => ticket.id === first.id));
    check("Offene Kanäle zählen den geschlossenen nicht mehr", !(await tickets.OpenChannels()).includes("111111111111111111"));

    // Einstellungen
    const config = DefaultConfig();

    config.contact = "modmail";

    await client.ticketSettings.Save(GUILD, config);

    const stored = await client.ticketSettings.Of(GUILD);

    check("Die Einstellungen kommen zurück", stored.contact === "modmail" && stored.options.length === 1);
    check("ModMail-Server werden gefunden", (await client.ticketSettings.ModMailGuilds()).includes(GUILD));

    stored.options[0].name = "Geändert";

    check("Eine Kopie verändert den Cache nicht", (await client.ticketSettings.Of(GUILD)).options[0].name === "Support");

    // Sperrliste
    await client.ticketBlacklist.Add(GUILD, USER, "Spam", STAFF);

    check("Gesperrt ist gesperrt", await client.ticketBlacklist.Has(GUILD, USER));
    check("Die Sperre steht in der Liste", (await client.ticketBlacklist.Of(GUILD)).some((row) => row.user_id === USER && row.reason === "Spam"));
    check("Entsperren geht", await client.ticketBlacklist.Remove(GUILD, USER));
    check("Danach ist niemand mehr gesperrt", !(await client.ticketBlacklist.Has(GUILD, USER)));
}

async function cleanup(client: BotClient): Promise<void> {
    const service = client.databaseService;

    await service.Write("DELETE FROM tickets WHERE guild_id = ?", [GUILD]);
    await service.Write("DELETE FROM ticket_settings WHERE guild_id = ?", [GUILD]);
    await service.Write("DELETE FROM ticket_blacklist WHERE guild_id = ?", [GUILD]);

    client.tickets.Forget();
    client.ticketSettings.Forget();
    client.ticketBlacklist.Forget();

    check("Aufgeräumt", (await client.tickets.OpenOf(GUILD, USER)).length === 0);
}

async function main(): Promise<void> {
    console.log("\n🎫 Ticket-System\n");

    const client = new BotClient();

    await client.configService.Initialize();

    checkConfig(client);
    checkPlaceholders();
    checkDocs();
    checkClean(client);
    checkMenu(client);
    await checkPanel(client);

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

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
