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

import { ChannelType, Collection, Guild, GuildMember, Message, User } from "discord.js";
import BotClient from "../client/BotClient";
import { CleanDoc, IsImageSource } from "../builder/MessageDoc";
import { InfoView, IsImageFile, IsPanelMessage, ITicketView, MenuOptions, PanelView, RELAY_MARK, RelayView } from "../builder/TicketPanel";
import { Duration, LIVE_CSS, RenderLive, RenderTranscript } from "../builder/TranscriptHtml";
import { Fill, PLACEHOLDER_KEYS } from "../constants/Placeholders";
import {
    ACTIONS,
    ACTIONS_CONFIG,
    CORE_ACTIONS,
    DefaultConfig,
    DELETE_NOW,
    DeleteLabel,
    LEGACY_MODMAIL_PANEL,
    MESSAGE_KEYS,
    TicketNumber,
    AssignCodes,
} from "../constants/Tickets";
import { AttachmentKey } from "../constants/Transcripts";
import { ITicket, ITicketConfig } from "../interfaces/services/tickets/ITicket";
import { ITranscript, ITranscriptMessage, ITranscriptUser } from "../interfaces/services/tickets/ITranscript";
import { ITicketContext, SlowmodeLabel, TicketError } from "../services/TicketService";
import { ILiveAccess, Preview } from "../services/LiveService";

// Erfundene Snowflakes - 17-stellig wie echte, aber es gibt sie bei Discord nicht.
const GUILD = "90071992547409991";
const USER = "90071992547409992";
const STAFF = "90071992547409993";
const ROLE = "90071992547409994";
const CATEGORY = "90071992547409995";
const FORUM = "90071992547409996";
const BOT = "90071992547409997";
const TEXT = "90071992547409998";
const RECRUIT = "90071992547409999";

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
                [TEXT, { id: TEXT, type: ChannelType.GuildText }],
            ]),
        },
    } as unknown as Guild;
}

function FakeTicket(patch: Partial<ITicket> = {}): ITicket {
    return {
        id: 1,
        guildId: GUILD,
        number: 42,
        code: "SUP",
        optionId: "support",
        openerId: USER,
        openerCode: "7K3F",
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
        closedBy: null,
        closeReason: null,
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
    check("Die Ticket-ID: Kürzel und Nummer", TicketNumber(42, "SUP") === "SUP-42", TicketNumber(42, "SUP"));
    check("Ältere Tickets ohne Kürzel: #42", TicketNumber(42) === "#42" && TicketNumber(42, null) === "#42");

    const codes = AssignCodes([{ name: "Support" }, { name: "Supporter" }, { name: "Übersicht" }, { name: "VIP", code: "vip1" }, { name: "X", code: "?!" }]);

    check("Kürzel aus dem Namen: SUP", codes[0].code === "SUP", codes[0].code);
    check("Ein zweites SUP wird SUP2", codes[1].code === "SUP2", codes[1].code);
    check("Umlaute ohne Punkte: UBE", codes[2].code === "UBE", codes[2].code);
    check("Eingetragene Kürzel bleiben, groß geschrieben", codes[3].code === "VIP1", codes[3].code);
    check("Ungültiges Kürzel: aus dem Namen, aufgefüllt", codes[4].code === "XTK", codes[4].code);
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

    const archived = client.ticketService.Clean(guild, { transcripts: { enabled: false, channelId: TEXT, dm: true } }, config);
    const partial = client.ticketService.Clean(guild, { transcripts: { dm: false } }, archived);
    const invented = client.ticketService.Clean(guild, { transcripts: { channelId: FORUM } }, archived);

    check("Transcripts: Schalter und Log-Kanal werden übernommen", !archived.transcripts.enabled && archived.transcripts.channelId === TEXT && archived.transcripts.dm);
    check("Transcripts: was fehlt, bleibt stehen", !partial.transcripts.enabled && partial.transcripts.channelId === TEXT && !partial.transcripts.dm);
    check("Transcripts: der Log-Kanal muss ein Textkanal sein", invented.transcripts.channelId === null, String(invented.transcripts.channelId));
    check("Transcripts: ohne Angabe bleibt alles, wie es war", client.ticketService.Clean(guild, {}, archived).transcripts.channelId === TEXT);

    // Moderatoren: echte IDs, doppelte nur einmal, Rollen nur, wenn es sie gibt.
    const mods = client.ticketService.CleanModerators(guild, { users: [STAFF, STAFF, "abc", 42], roles: [ROLE, "90071992547400001", GUILD] });

    check("Moderatoren: User-IDs, doppelte nur einmal", JSON.stringify(mods.users) === JSON.stringify([STAFF]), JSON.stringify(mods.users));
    check("Moderatoren: nur Rollen, die es gibt - @everyone nicht", JSON.stringify(mods.roles) === JSON.stringify([ROLE]), JSON.stringify(mods.roles));
    check(
        "Moderatoren gehören dem Server - die Ticket-Einstellungen ändern sie nicht",
        client.ticketService.Clean(guild, { moderators: { users: [USER] } }, { ...config, moderators: mods }).moderators.users[0] === STAFF
    );
    check("Moderatoren: ältere Einstellungen haben leere Listen", DefaultConfig().moderators.users.length === 0 && DefaultConfig().moderators.roles.length === 0);
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
 * Das Panel: Klassisch zeigt Text und Themen, ModMail nur den DM-Hinweis mit
 * einem Knopf - die Themen kommen dort erst per DM. Dazu die Erkennung, die
 * ein zweites Panel im selben Kanal verhindert.
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
    const directView = await PanelView(client, guild, config);
    const direct = text(directView);

    config.contact = "modmail";

    const modmailView = await PanelView(client, guild, config);
    const modmail = text(modmailView);

    check("Klassisch: Text und Themen", direct.includes("Support") && direct.includes("ticket:open:support"));
    check("ModMail: der DM-Hinweis steht im Panel", modmail.includes("Support per DM"), modmail.slice(0, 160));
    check("ModMail: {bot} wird zur Erwähnung des Bots", modmail.includes(`<@${BOT}>`));
    check("ModMail: ein Knopf startet das Ticket per DM", modmail.includes('"custom_id":"ticket:dm"'));
    check("ModMail: keine Themen im Kanal", !modmail.includes("ticket:open"), modmail.slice(0, 200));
    check("ModMail: kein Link aufs Profil mehr", !modmail.includes("discord.com/users/"));

    const message = (author: string, components: unknown[]) => ({ author: { id: author }, components }) as unknown as Message;

    check("Ein Panel des Bots wird erkannt (Klassisch)", IsPanelMessage(message(BOT, directView.components), BOT));
    check("Ein Panel des Bots wird erkannt (ModMail)", IsPanelMessage(message(BOT, modmailView.components), BOT));
    check("Fremde Nachrichten sind kein Panel", !IsPanelMessage(message(USER, directView.components), BOT));
    check("Eine Bot-Nachricht ohne Panel-Knöpfe ist keins", !IsPanelMessage(message(BOT, []), BOT));
}

/* ----------------------------------------------------------
   Transcripts
   ---------------------------------------------------------- */
const CDN = "https://cdn.discordapp.com/attachments/1/2";

function Person(id: string, name: string, bot = false): ITranscriptUser {
    return { id, name, avatar: `https://cdn.discordapp.com/avatars/${id}/abc.webp`, bot, color: bot ? null : "#35e07f" };
}

function Line(id: string, author: ITranscriptUser, at: number, patch: Partial<ITranscriptMessage> = {}): ITranscriptMessage {
    return { id, type: 0, author, at, edited: null, content: "", reply: null, embeds: [], components: [], files: [], stickers: [], reactions: [], ...patch };
}

/** Ein Verlauf mit allem, was vorkommt: Markdown, Embeds, Components V2, Anhänge - und Versuche, HTML einzuschleusen. */
function SampleTranscript(): ITranscript {
    const opener = Person(USER, "Kunde");
    const staff = Person(STAFF, "Helfer");
    const bot = Person(BOT, "RL Nexus", true);
    const start = Date.UTC(2026, 8, 18, 10, 0);

    return {
        version: 1,
        ticketId: 1,
        number: 42,
        guild: { id: GUILD, name: "Check-Server", icon: null },
        channel: { id: "1", name: "support-0042" },
        meta: {
            optionId: "support",
            option: "Support",
            contact: "direct",
            opener,
            claimer: staff,
            closer: staff,
            reason: "Erledigt",
            members: [STAFF],
            openedAt: start,
            closedAt: start + 134 * 60_000,
            messages: 6,
            files: 3,
            participants: [opener, staff],
        },
        messages: [
            Line("10", bot, start, {
                components: [
                    {
                        type: 17,
                        accent_color: 0xff1e2d,
                        components: [
                            { type: 10, content: `## Ticket #0042 · Support\nHallo <@${USER}>` },
                            {
                                type: 9,
                                components: [{ type: 10, content: "Abschnitt" }],
                                accessory: { type: 11, media: { url: "https://example.com/bild.png" } },
                            },
                            { type: 12, items: [{ media: { url: "https://example.com/a.png" } }, { media: { url: "https://example.com/b.png" } }] },
                            { type: 14, divider: true, spacing: 2 },
                            { type: 13, file: { url: "attachment://regeln.pdf" } },
                            { type: 1, components: [{ type: 2, style: 1, label: "Claim", custom_id: "x", emoji: { name: "✅" } }] },
                            {
                                type: 1,
                                components: [
                                    {
                                        type: 3,
                                        custom_id: "ticket:act:1",
                                        placeholder: "⚙️ | Aktion wählen …",
                                        options: [{ label: "Schließen", value: "close", description: "Ticket schließen" }],
                                    },
                                ],
                            },
                        ],
                    },
                ],
                files: [
                    { name: "regeln.pdf", size: 2048, type: "application/pdf", url: `${CDN}/regeln.pdf?ex=1`, width: null, height: null, spoiler: false, description: null },
                ],
            }),
            Line("11", opener, start + 60_000, {
                content: [
                    `**fett** *kursiv* __unter__ ~~weg~~ \`code\` ||geheim|| <@&${ROLE}> <#${TEXT}> <:nexus:${BOT}> <t:1789725600:F>`,
                    "# Titel",
                    "- Punkt",
                    "> Zitat",
                    "[Link](https://example.com/a?b=1&c=2) https://example.org/x.",
                    "```js",
                    'const a = "<b>";',
                    "```",
                ].join("\n"),
            }),
            Line("12", opener, start + 120_000, {
                content: '<script>alert(1)</script> "><img src=x onerror=alert(1)> [x](javascript:alert(1))',
                files: [
                    { name: "screen.png", size: 4096, type: "image/png", url: `${CDN}/screen.png?ex=1`, width: 10, height: 10, spoiler: false, description: null },
                    { name: "weg.png", size: 4096, type: "image/png", url: `${CDN}/weg.png?ex=1`, width: 10, height: 10, spoiler: false, description: null },
                ],
                reactions: [{ emoji: "👍", count: 2 }],
            }),
            Line("13", staff, start + 180_000, {
                content: "Antwort",
                reply: "12",
                embeds: [{ title: "Embed", description: "**Beschreibung**", color: 0x00afff, fields: [{ name: "Feld", value: "Wert", inline: true }] }],
            }),
            Line("14", { ...staff, id: "5", name: "Check-Server Team", bot: true, color: null }, start + 240_000, { content: "anonym" }),
            Line("15", staff, start + 300_000, { type: 6 }),
        ],
        mentions: { users: { [USER]: "Kunde" }, roles: { [ROLE]: { name: "Support", color: "#ff1e2d" } }, channels: { [TEXT]: "allgemein" } },
        media: { "/attachments/1/2/screen.png": "0.png", "/attachments/1/2/regeln.pdf": "1.pdf" },
        truncated: false,
    };
}

async function checkTranscripts(client: BotClient): Promise<void> {
    console.log("\n  — Transcripts —");

    const transcript = SampleTranscript();
    const html = RenderTranscript(transcript, { file: (stored) => `/files/${stored}`, bar: { back: "/zurueck", download: "/laden" } });
    const has = (text: string) => html.includes(text);

    check("Ein Skript bleibt Text", !has("<script>alert") && has("&lt;script&gt;alert(1)&lt;/script&gt;"));
    check("Ein eingeschleustes Bild bleibt Text", !has("<img src=x") && has("&lt;img src=x"));
    check("javascript:-Links werden keine Links", !has('href="javascript:'));
    check("Die Seite verbietet Skripte selbst", has("Content-Security-Policy") && has("default-src 'none'"));
    check(
        "Markdown: fett, kursiv, unterstrichen, durchgestrichen",
        has("<strong>fett</strong>") && has("<em>kursiv</em>") && has("<u>unter</u>") && has("<s>weg</s>")
    );
    check(
        "Markdown: Code, Codeblock, Spoiler",
        has("<code>code</code>") && has("<pre><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>") && has('class="spoiler"')
    );
    check("Markdown: Überschrift, Liste, Zitat", has('class="h1">Titel') && has("<ul><li>Punkt</li></ul>") && has("<blockquote>"));
    check(
        "Links: & bleibt heil, der Punkt am Ende gehört nicht dazu",
        has('href="https://example.com/a?b=1&amp;c=2"') && has('href="https://example.org/x"')
    );
    check("Erwähnungen tragen Namen", has("@Kunde") && has("@Support") && has("#allgemein") && has("--role:#ff1e2d"));
    check("Server-Emojis werden Bilder", has(`cdn.discordapp.com/emojis/${BOT}.webp`));
    check("Zeitstempel werden ein Datum", has('class="stamp"') && has("2026"));
    check("V2: Container mit Akzentfarbe", has('class="container" style="--c:#ff1e2d"'));
    check("V2: Abschnitt mit Vorschaubild", has('class="section"') && has('class="thumb"'));
    check(
        "V2: Galerie, Trenner, Knopf, Menü",
        has("gallery gallery--2") && has('class="sep sep--large"') && has("btn btn--1") && has('class="choices"')
    );
    check("V2: Datei-Komponente zeigt auf die gesicherte Kopie", has('href="/files/1.pdf"'));
    check("V2: die Datei steht nicht noch einmal darunter", html.split("regeln.pdf").length - 1 === 1, String(html.split("regeln.pdf").length - 1));
    check("Gesicherte Bilder kommen von der eigenen Adresse", has('src="/files/0.png"'));
    check(
        "Nicht gesicherte Anhänge sind als solche markiert",
        has("nicht gesichert") && !has('src="https://cdn.discordapp.com/attachments/1/2/weg.png')
    );
    check("Embeds: Titel, Farbe, Felder", has('class="embed" style="--c:#00afff"') && has("embed__field is-inline"));
    check("Antworten verweisen auf die Originalnachricht", has('class="reply" href="#m-12"'));
    check("Reaktionen mit Zahl", has('class="reaction"') && has("<b>2</b>"));
    check("Bots und Webhooks tragen das BOT-Schild", html.split('class="tag"').length - 1 === 2, String(html.split('class="tag"').length - 1));
    check("Anpinnen erscheint als Systemzeile", has("hat eine Nachricht angepinnt"));
    check(
        "Dieselbe Person kurz nacheinander ohne neuen Kopf",
        !has('class="msg msg--head" id="m-12"') && has('class="msg msg--head" id="m-11"')
    );
    check("Kopf: Dauer und Grund", has("2 Std. 14 Min.") && has("Erledigt") && Duration(26 * 60 * 60_000) === "1 Tag 2 Std.");
    check(
        "Online gibt es den Weg zurück, als Datei nicht",
        has('href="/zurueck"') && !RenderTranscript(transcript, { file: () => null }).includes('class="bar"')
    );

    check(
        "Anhang-Schlüssel: CDN und Media-Proxy sind derselbe",
        AttachmentKey(`${CDN}/a.png?ex=1`) === AttachmentKey("https://media.discordapp.net/attachments/1/2/a.png?x=2")
    );
    check(
        "Anhang-Schlüssel: fremde Hosts und http gibt es nicht",
        AttachmentKey("https://example.com/attachments/1/2/a.png") === null && AttachmentKey("http://cdn.discordapp.com/attachments/1/2/a.png") === null
    );

    const entry = { ticketId: 1, guildId: GUILD, number: 42, code: "SUP", meta: transcript.meta };
    const modmail = { ...entry, meta: { ...transcript.meta, contact: "modmail" as const } };

    check("Klassisch: der Ersteller darf sein Transcript öffnen", await client.transcriptService.CanRead(USER, entry));
    check("Klassisch: hinzugefügte User auch", await client.transcriptService.CanRead(STAFF, entry));
    check("ModMail: der Ersteller sieht die Team-Seite nicht", !(await client.transcriptService.CanRead(USER, modmail)));
    check(
        "Anhänge nur unter Namen, die der Bot vergibt",
        client.transcriptService.FilePath(entry, "../../.env") === null && client.transcriptService.FilePath(entry, "0.png") !== null
    );
}

/* ----------------------------------------------------------
   Live Tickets
   ---------------------------------------------------------- */
async function checkLive(client: BotClient): Promise<void> {
    console.log("\n  — Live Tickets —");

    const transcript = SampleTranscript();
    const rendered = RenderLive(transcript.messages.slice(1, 3), transcript.mentions);

    check("Live: jede Nachricht einzeln gerendert", rendered.length === 2 && rendered[0].id === "11");
    check("Live: dieselbe Person kurz danach ohne Kopf", rendered[0].html.includes("msg--head") && !rendered[1].html.includes("msg--head"));
    check("Live: compact ist dieselbe Nachricht ohne Kopf", !rendered[0].compact.includes("msg--head") && rendered[0].compact.includes('id="m-11"'));
    check(
        "Live: Discord-Links sind frisch - nichts ist „nicht gesichert“",
        !rendered[1].html.includes("nicht gesichert") && rendered[1].html.includes("cdn.discordapp.com/attachments/1/2/weg.png")
    );
    check("Live: auch hier bleibt ein Skript Text", !rendered[1].html.includes("<script>") && rendered[1].html.includes("&lt;script&gt;"));
    check("Live: Antwort auf eine Nachricht außerhalb", RenderLive([transcript.messages[3]], transcript.mentions)[0].html.includes("Antwort auf eine ältere Nachricht"));
    check("Live: das Aussehen passt ins Shadow DOM", LIVE_CSS.includes(":host{") && !LIVE_CSS.includes(":root{") && !/^body\{/m.test(LIVE_CSS));

    // Wer was sieht: dieselbe Regel wie im Ticket - "Server verwalten" oder die Rolle des Themas.
    const config = DefaultConfig();

    config.supportRoleId = ROLE;
    config.options.push({
        id: "bewerbung",
        name: "Bewerbung",
        code: "BEW",
        description: "",
        emoji: null,
        categoryId: null,
        tagId: null,
        supportRoleId: RECRUIT,
        opened: null,
    });

    const member = (roles: string[], manage = false) =>
        ({ id: STAFF, permissions: { has: () => manage }, roles: { cache: new Map(roles.map((role) => [role, {}])) } }) as unknown as GuildMember;
    const visible = (roles: string[], manage = false) => JSON.stringify(client.transcriptService.Visible(member(roles, manage), config));

    check("Transcripts: „Server verwalten“ sieht alles", visible([], true) === "{}");
    check("Transcripts: die allgemeine Rolle sieht alles außer Themen mit eigener Rolle", visible([ROLE]) === JSON.stringify({ exclude: ["bewerbung"] }));
    check("Transcripts: eine Themen-Rolle sieht nur ihr Thema", visible([RECRUIT]) === JSON.stringify({ include: ["bewerbung"] }));
    check("Transcripts: ohne Rolle nichts", visible([]) === JSON.stringify({ include: [] }));

    const access = (roles: string[]): ILiveAccess => ({ guild: { id: GUILD } as Guild, member: member(roles), config, manage: false });

    check("Live: die Support-Rolle sieht Support-Tickets", client.liveService.CanSee(access([ROLE]), FakeTicket()));
    check("Live: aber keine Bewerbungen mit eigener Rolle", !client.liveService.CanSee(access([ROLE]), FakeTicket({ optionId: "bewerbung" })));
    check("Live: die Themen-Rolle sieht ihre Bewerbungen", client.liveService.CanSee(access([RECRUIT]), FakeTicket({ optionId: "bewerbung" })));
    check("Live: Tickets anderer Server nie", !client.liveService.CanSee(access([ROLE]), FakeTicket({ guildId: "90071992547400000" })));

    // Moderatoren sehen jedes Thema - einzeln eingetragen oder über ihre Rolle.
    const MOD_ROLE = "90071992547400002";
    const moderated = { ...config, moderators: { users: [STAFF], roles: [MOD_ROLE] } };
    const mod = (roles: string[], id = STAFF) =>
        ({ id, permissions: { has: () => false }, roles: { cache: new Map(roles.map((role) => [role, {}])) } }) as unknown as GuildMember;
    const bewerbung = moderated.options.find((option) => option.id === "bewerbung") ?? null;

    check("Moderator (User) zählt bei jedem Thema zum Team", client.ticketService.IsStaff(mod([]), { config: moderated, option: bewerbung }));
    check("Moderator (Rolle) zählt bei jedem Thema zum Team", client.ticketService.IsStaff(mod([MOD_ROLE], USER), { config: moderated, option: bewerbung }));
    check("Ohne Eintrag und Rolle: kein Team", !client.ticketService.IsStaff(mod([], USER), { config: moderated, option: bewerbung }));
    check("Transcripts: Moderatoren sehen alle", JSON.stringify(client.transcriptService.Visible(mod([MOD_ROLE], USER), moderated)) === "{}");
}

/* ----------------------------------------------------------
   ModMail: Karten, Marken, Schließen
   ---------------------------------------------------------- */
interface IRawNode {
    type?: number;
    content?: string;
    items?: { media: { url: string } }[];
    file?: { url: string };
    components?: IRawNode[];
}

async function checkModMail(client: BotClient): Promise<void> {
    console.log("\n  — ModMail —");

    const team = RelayView("team", "Joe", "Hallo **du**", []);
    const teamJson = team.components[0].toJSON() as IRawNode;

    check("Team-Karte: oben steht, dass das Team schreibt", teamJson.components?.[0]?.content === `-# ${RELAY_MARK.team} · **Joe**`, teamJson.components?.[0]?.content);
    check("Team-Karte: der Text darunter", teamJson.components?.[1]?.content === "Hallo **du**");

    const files = [
        { attachment: "https://cdn.discordapp.com/a/1.png", name: "Mein Bild.png", image: true },
        { attachment: "https://cdn.discordapp.com/a/2.pdf", name: "Rechnung März.pdf", image: false },
        { attachment: "https://cdn.discordapp.com/a/3.jpg", name: "zwei.jpg", image: true },
    ];
    const user = RelayView("user", null, "", files, ["📎 https://cdn.discordapp.com/a/gross.zip"]);
    const userJson = user.components[0].toJSON() as IRawNode;
    const parts = userJson.components ?? [];
    const gallery = parts.find((part) => part.type === 12);
    const file = parts.find((part) => part.type === 13);
    const names = user.files.map((entry) => entry.name);

    check("User-Karte ohne Namen: nur die Marke (Name und Bild trägt der Webhook)", parts[0]?.content === `-# ${RELAY_MARK.user}`, parts[0]?.content);
    check("Große Dateien stehen als Link im Text", parts[1]?.content === "📎 https://cdn.discordapp.com/a/gross.zip", parts[1]?.content);
    check(
        "Bilder als Galerie, mit Verweis auf den Anhang",
        JSON.stringify(gallery?.items?.map((item) => item.media.url)) === JSON.stringify(["attachment://0-Mein_Bild.png", "attachment://2-zwei.jpg"]),
        JSON.stringify(gallery?.items)
    );
    check("Andere Dateien als Datei-Baustein", file?.file?.url === "attachment://1-Rechnung_Marz.pdf", file?.file?.url);
    check("Jeder Verweis hat seinen Anhang", JSON.stringify(names) === JSON.stringify(["0-Mein_Bild.png", "1-Rechnung_Marz.pdf", "2-zwei.jpg"]), names.join(", "));
    check("Bilder erkennt der Name, wenn der Typ fehlt", IsImageFile("a.WEBP") && !IsImageFile("a.pdf") && IsImageFile("x", "image/png"));

    const many = RelayView("user", "Kevin", "x", Array.from({ length: 14 }, (_, index) => ({ attachment: "a", name: `${index}.png`, image: true })));

    check("Höchstens zehn Anhänge", many.files.length === 10);
    check("Ohne Webhook steht der Name in der Karte", (many.components[0].toJSON() as IRawNode).components?.[0]?.content === `-# ${RELAY_MARK.user} · **Kevin**`);

    // Die Vorschau in der Liste liest Karten ohne Kopfzeile.
    const card = (view: ITicketView) =>
        ({ content: "", components: view.components, embeds: [], attachments: new Collection() }) as unknown as Parameters<typeof Preview>[0];

    check("Vorschau: der Text der Karte, ohne Kopfzeile", Preview(card(RelayView("user", "Kevin", "Mein **Rang** fehlt", []))) === "Mein Rang fehlt");
    check("Vorschau: Karten vom Bot zeigen ihren Text", Preview(card(InfoView("✅ Joe übernimmt das Ticket."))) === "✅ Joe übernimmt das Ticket.");

    // Weitergeleitet per Webhook: im Verlauf steht der Ersteller selbst - mit USER-Marke.
    const opener: ITranscriptUser = { id: USER, name: "Kevin", avatar: null, bot: false, color: null, team: false };
    const people = new Map([[USER, opener]]);
    const hook = (username: string, view: ITicketView | null) =>
        ({
            webhookId: "1",
            author: { id: "2", username, displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png" },
            components: view ? view.components : [],
        }) as unknown as Message;
    const transcripts = client.transcriptService;

    check("Weitergeleitete User-Nachricht zählt als der Ersteller", transcripts.Author(hook("Kevin", RelayView("user", null, "hi", [])), people, USER) === opener);
    check("Nachricht aus dem Dashboard: Team, kein Bot", JSON.stringify(transcripts.Author(hook("Joe · via Dashboard", null), people, USER)).includes('"bot":false,"color":null,"team":true'));
    check("Andere Webhooks bleiben ein Bot", transcripts.Author(hook("Server Team", null), people, USER).bot === true);

    const tagged = (team: boolean | undefined) => {
        const transcript = SampleTranscript();
        const [message] = transcript.messages.slice(1, 2);

        return RenderLive([{ ...message, author: { ...message.author, team } }], transcript.mentions)[0].html;
    };

    check("Marke TEAM", tagged(true).includes('class="tag tag--team">TEAM<'));
    check("Marke USER", tagged(false).includes('class="tag tag--user">USER<'));
    check("Ältere Transcripts ohne Angabe: keine Marke", !tagged(undefined).includes("tag--"));

    // Bei ModMail schließt nur das Team - der Ersteller aus der DM nicht.
    const config = DefaultConfig();
    const context = { ticket: FakeTicket({ contact: "modmail" }), config, guild: { id: GUILD } as Guild, option: config.options[0] ?? null, channel: null };
    let refused = "";

    try {
        await client.ticketService.Close(context as unknown as ITicketContext, { id: USER } as User, null);
    } catch (error) {
        refused = error instanceof TicketError ? error.message : String(error);
    }

    check("ModMail: der User kann nicht selbst schließen", refused === "Schließen kann nur das Team.", refused);

    // Die Server-Frage kommt einmal, bis ein Ticket aufgeht.
    const service = client.ticketService;
    const asker = "90071992547409990";

    check("Server-Frage beim ersten Mal", service.AskServer(asker));
    check("Keine zweite Frage für jede weitere Zeile", !service.AskServer(asker));

    await service.FlushPending({ id: asker } as User, FakeTicket());

    check("Nach dem Öffnen fragt der Bot beim nächsten Mal wieder", service.AskServer(asker));
}

async function checkDatabase(client: BotClient): Promise<void> {
    console.log("\n  — Datenbank —");

    const tickets = client.tickets;

    // Zwei Tickets im selben Augenblick: die Nummern müssen verschieden sein.
    const [first, second] = await Promise.all([
        tickets.Create(GUILD, "support", "SUP", USER, "7K3F", "direct"),
        tickets.Create(GUILD, "support", "SUP", STAFF, null, "direct"),
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
    check("Offene Tickets des Servers für Live Tickets", (await tickets.OpenOfGuild(GUILD)).length === 2);

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

    // Der alte Standardtext des ModMail-Panels versprach Themen, die es dort nicht mehr gibt.
    const legacy = DefaultConfig();

    legacy.messages.modmailPanel = { accent: "#ff1e2d", blocks: [{ type: "text", body: LEGACY_MODMAIL_PANEL }] };
    await client.ticketSettings.Save(GUILD, legacy);

    const migrated = (await client.ticketSettings.Of(GUILD)).messages.modmailPanel.blocks[0];

    check(
        "Der alte ModMail-Standardtext wird durch den neuen ersetzt",
        migrated?.type === "text" && migrated.body !== LEGACY_MODMAIL_PANEL && migrated.body.includes("Ticket per DM starten")
    );

    legacy.messages.modmailPanel = { blocks: [{ type: "text", body: "Eigener Text" }] };
    await client.ticketSettings.Save(GUILD, legacy);

    const own = (await client.ticketSettings.Of(GUILD)).messages.modmailPanel.blocks[0];

    check("Ein eigener Text bleibt, wie er ist", own?.type === "text" && own.body === "Eigener Text");

    const older = DefaultConfig() as Partial<ITicketConfig>;

    delete older.transcripts;
    await client.ticketSettings.Save(GUILD, older as ITicketConfig);

    check("Ältere Einstellungen bekommen die Transcript-Standards", (await client.ticketSettings.Of(GUILD)).transcripts.enabled === true);

    // Transcripts
    const transcript = SampleTranscript();

    transcript.ticketId = first.id;
    transcript.number = first.number;
    await client.ticketTranscripts.Save(transcript);

    const entry = await client.ticketTranscripts.Entry(first.id);
    const read = await client.ticketTranscripts.Read(first.id);

    check("Ein Transcript wird gespeichert", await client.ticketTranscripts.Has(first.id));
    check(
        "Kopf und Zahlen kommen ohne den Verlauf zurück",
        entry?.meta.opener.id === USER && entry?.meta.messages === transcript.meta.messages
    );
    check(
        "Der gepackte Verlauf kommt vollständig zurück",
        read?.messages.length === transcript.messages.length && read?.messages[1].content === transcript.messages[1].content
    );
    check("Die Liste findet es", (await client.ticketTranscripts.List(GUILD, "", null, 10)).some((row) => row.ticketId === first.id));
    check("Suche nach Nummer", (await client.ticketTranscripts.List(GUILD, `#${first.number}`, null, 10)).length === 1);
    check("Suche nach Name", (await client.ticketTranscripts.List(GUILD, "kund", null, 10)).length === 1);
    check("Suche ohne Treffer, auch mit % und _", (await client.ticketTranscripts.List(GUILD, "niemand_%", null, 10)).length === 0);
    check("Seitenweise über before", (await client.ticketTranscripts.List(GUILD, "", first.id, 10)).length === 0);
    check("Nur die eigenen Themen: include", (await client.ticketTranscripts.List(GUILD, "", null, 10, { include: ["support"] })).length === 1);
    check("Nur die eigenen Themen: ein fremdes Thema", (await client.ticketTranscripts.List(GUILD, "", null, 10, { include: ["bewerbung"] })).length === 0);
    check("Nur die eigenen Themen: exclude", (await client.ticketTranscripts.List(GUILD, "", null, 10, { exclude: ["support"] })).length === 0);
    check("Ohne eine einzige Rolle: nichts", (await client.ticketTranscripts.List(GUILD, "", null, 10, { include: [] })).length === 0);

    await tickets.Patch(first.id, { closedBy: STAFF, closeReason: "Erledigt" });

    const closed = await tickets.Get(first.id);

    check("Wer geschlossen hat und warum, steht am Ticket", closed?.closedBy === STAFF && closed?.closeReason === "Erledigt");

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
    await service.Write("DELETE FROM ticket_transcripts WHERE guild_id = ?", [GUILD]);

    client.tickets.Forget();
    client.ticketTranscripts.Forget();
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
    await checkTranscripts(client);
    await checkLive(client);
    await checkModMail(client);

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
