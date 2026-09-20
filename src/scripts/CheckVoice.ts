/**
 * Prüft Temp Voice ohne Discord: die Vorgaben eines Hubs, die Namensvorlage,
 * das Panel, die Presets - und, sofern eine Datenbank da ist, was passiert,
 * wenn jemand seinen Kanal umstellt.
 *
 *   npm run check:voice
 *
 * Die Sprachkanäle selbst sind erfunden: der Kanal merkt sich nur, was der
 * Bot an ihm ändern wollte. Ob Discord das auch tut, zeigt erst ein echter
 * Server.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import { ChannelType, Guild, GuildBasedChannel, GuildMember, Role, VoiceBasedChannel } from "discord.js";
import BotClient from "../client/BotClient";
import { VoicePanel, VoicePresetList, VoiceState } from "../builder/VoiceView";
import { DefaultHubConfig, DefaultVoiceSettings, FormatVoiceName, MAX_LIMIT, MAX_PRESETS, VOICE_ACTIONS } from "../constants/Voice";
import { IVoiceSettings } from "../interfaces/services/voice/IVoice";
import { VoiceError } from "../services/VoiceService";

const GUILD = "90071992547409961";
const USER = "90071992547409962";
const OTHER = "90071992547409963";
const HUB = "90071992547409964";
const TEMP = "90071992547409965";
const CATEGORY = "90071992547409966";
const TEXT = "90071992547409967";
const ROLE = "90071992547409968";

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

/** Ein Kanal, der sich nur merkt, was der Bot an ihm ändern wollte. */
interface IFakeChannel {
    channel: VoiceBasedChannel;
    edits: Record<string, unknown>[];
    deleted: boolean;
    invites: number;
}

function FakeGuild(): Guild {
    const channel = (id: string, type: ChannelType) => ({ id, type, name: `kanal-${id.slice(-2)}` }) as unknown as GuildBasedChannel;

    return {
        id: GUILD,
        name: "Dev Server",
        channels: {
            cache: new Map([
                [HUB, channel(HUB, ChannelType.GuildVoice)],
                [CATEGORY, channel(CATEGORY, ChannelType.GuildCategory)],
                [TEXT, channel(TEXT, ChannelType.GuildText)],
            ]),
        },
        roles: { cache: new Map([[ROLE, { id: ROLE, name: "Stammgast" } as unknown as Role], [GUILD, { id: GUILD, name: "@everyone" } as unknown as Role]]), everyone: { id: GUILD } },
        members: { cache: new Map() },
    } as unknown as Guild;
}

function FakeChannel(guild: Guild): IFakeChannel {
    const state: IFakeChannel = { channel: null as unknown as VoiceBasedChannel, edits: [], deleted: false, invites: 0 };

    state.channel = {
        id: TEMP,
        name: "Laras Kanal",
        guild,
        members: new Map(),
        isVoiceBased: () => true,
        edit: async (options: Record<string, unknown>) => {
            state.edits.push(options);

            return state.channel;
        },
        delete: async () => {
            state.deleted = true;

            return state.channel;
        },
        createInvite: async () => {
            state.invites++;

            return { url: "https://discord.gg/test" };
        },
        permissionOverwrites: { set: async () => undefined, edit: async () => undefined },
        send: async () => undefined,
    } as unknown as VoiceBasedChannel;

    return state;
}

function FakeMember(guild: Guild, id: string, channel: VoiceBasedChannel | null, patch: { disconnect?: () => void } = {}): GuildMember {
    return {
        id,
        displayName: id === USER ? "Lara" : "Mo",
        guild,
        user: { id, bot: false, username: id === USER ? "lara" : "mo" },
        roles: { cache: new Map() },
        voice: {
            channel,
            channelId: channel?.id ?? null,
            setChannel: async () => undefined,
            disconnect: async () => patch.disconnect?.(),
        },
        send: async () => undefined,
    } as unknown as GuildMember;
}

/* ----------------------------------------------------------
   Vorgaben und Namen
   ---------------------------------------------------------- */
function checkConfig(client: BotClient): void {
    console.log("\n  — Vorgaben eines Hubs —");

    const guild = FakeGuild();
    const service = client.voiceService;
    const base = DefaultHubConfig();

    check("Standard: alle 13 Optionen", base.actions.length === 13);
    check("Standard: Presets erlaubt", base.presets);

    const clean = service.CleanConfig(guild, { name: "  {user} zockt  ", categoryId: CATEGORY, actions: ["name", "quatsch", "region"], presets: false }, base);

    check("Der Name wird sauber übernommen", clean.name === "{user} zockt", clean.name);
    check("Die Kategorie wird geprüft", clean.categoryId === CATEGORY);
    check("Unbekannte Optionen fallen weg", clean.actions.join(",") === "name,region", clean.actions.join(","));
    check("Presets lassen sich abschalten", clean.presets === false);
    check("Ein Textkanal ist keine Kategorie", service.CleanConfig(guild, { categoryId: TEXT }, base).categoryId === null);
    check("Ohne Angabe bleibt alles, wie es war", service.CleanConfig(guild, {}, clean).name === "{user} zockt");

    const settings = service.CleanSettings({ limit: 500, privacy: "quatsch", stealth: true, region: "frankfurt", trusted: ["123", USER, USER], blocked: [OTHER] });

    check("Zu große Zahlen werden gedeckelt", settings.limit === MAX_LIMIT, String(settings.limit));
    check("Unsinn beim Zutritt fällt zurück", settings.privacy === "public");
    check("Stealth kommt an", settings.stealth);
    check("Die Region wird geprüft", settings.region === "frankfurt");
    check("Keine Fantasie-IDs, keine Doppelten", settings.trusted.join(",") === USER, settings.trusted.join(","));
    check("Eine unbekannte Region fällt weg", service.CleanSettings({ region: "mond" }).region === null);

    console.log("\n  — Namen —");

    const values = { user: "Lara", number: 3, game: "Rocket League" };

    check("{user} wird ersetzt", FormatVoiceName("{user}s Kanal", values) === "Laras Kanal");
    check("{nummer} wird ersetzt", FormatVoiceName("Voice #{nummer}", values) === "Voice #3");
    check("{spiel} wird ersetzt", FormatVoiceName("{user} | {spiel}", values) === "Lara | Rocket League");
    check("Ohne Spiel steht Voice da", FormatVoiceName("{spiel}", { ...values, game: null }) === "Voice");
    check("Ein leerer Name wird zum Namen des Users", FormatVoiceName("   ", values) === "Lara");
    check("Zu lange Namen werden gekürzt", FormatVoiceName("x".repeat(200), values).length === 90);
}

/* ----------------------------------------------------------
   Panel und Presets
   ---------------------------------------------------------- */
function checkViews(): void {
    console.log("\n  — Panel —");

    const config = DefaultHubConfig();
    const panel = JSON.stringify(VoicePanel(config, true).components[0].toJSON());

    check("Das Panel hat ein Auswahlmenü", panel.includes("voice:menu"));
    check("Alle 13 Optionen stehen drin", VOICE_ACTIONS.every((action) => panel.includes(`"${action.value}"`)));
    check("Die Beschreibungen kommen mit", panel.includes("Ändere den Namen des temporären Sprachkanals"));
    check("Der Preset-Knopf ist da", panel.includes("voice:presets"));
    check("Ohne Presets kein Knopf", !JSON.stringify(VoicePanel({ ...config, presets: false }, true).components[0].toJSON()).includes("voice:presets"));

    const trimmed = JSON.stringify(VoicePanel({ ...config, actions: ["name", "userlimit"] }, false).components[0].toJSON());

    check("Abgeschaltete Optionen fehlen", !trimmed.includes("deletechannel") && trimmed.includes("userlimit"));

    const state = JSON.stringify(
        VoiceState(
            { channelId: TEMP, guildId: GUILD, hubId: 1, ownerId: USER, createdAt: Date.now(), settings: { ...DefaultVoiceSettings(), limit: 4, privacy: "private", trusted: [OTHER] } },
            "🔒 Privat."
        ).components[0].toJSON()
    );

    check("Der Stand nennt den Besitzer", state.includes(`<@${USER}>`));
    check("Der Stand nennt die Plätze", state.includes("4 Plätze"));
    check("Der Stand nennt die Vertrauten", state.includes(`<@${OTHER}>`));

    console.log("\n  — Presets —");

    const presets = [
        { id: 1, userId: USER, name: "Ranked 2v2", config: { ...DefaultVoiceSettings(), limit: 2 }, isDefault: true, createdAt: Date.now() },
        { id: 2, userId: USER, name: "Chill", config: DefaultVoiceSettings(), isDefault: false, createdAt: Date.now() },
    ];
    const list = JSON.stringify(VoicePresetList(presets, MAX_PRESETS, null).components[0].toJSON());

    check("Beide Presets stehen da", list.includes("Ranked 2v2") && list.includes("Chill"));
    check("Anwenden gibt es je Preset", (list.match(/voice:preset:apply:/g) ?? []).length === 2);
    check("Das Standard-Preset ist markiert", list.includes("Standard"));
    check("Speichern geht", list.includes("voice:preset:save"));
    check("Voll ist voll", JSON.stringify(VoicePresetList(Array.from({ length: MAX_PRESETS }, (_, index) => ({ ...presets[0], id: index + 1, name: `P${index}` })), MAX_PRESETS, null).components[0].toJSON()).includes(`Höchstens ${MAX_PRESETS} Presets`));
    check("Ohne Presets ein Hinweis", JSON.stringify(VoicePresetList([], MAX_PRESETS, null).components[0].toJSON()).includes("Noch keins"));
}

/* ----------------------------------------------------------
   Datenbank und die Aktionen des Panels
   ---------------------------------------------------------- */
async function checkDatabase(client: BotClient): Promise<void> {
    console.log("\n  — Datenbank —");

    const guild = FakeGuild();
    const hub = await client.voiceHubs.Create({ guildId: GUILD, channelId: HUB, config: DefaultHubConfig(), createdBy: USER });

    check("Der Hub steht in der Tabelle", hub.id > 0 && hub.config.actions.length === 13);
    check("Er wird über den Kanal gefunden", (await client.voiceHubs.ByChannel(HUB))?.id === hub.id);
    check("Er steht beim Server", (await client.voiceHubs.OfGuild(GUILD)).length === 1);

    await client.voiceHubs.SaveConfig(hub.id, { ...hub.config, name: "{user} zockt", presets: false });

    check("Einstellungen kommen so zurück", (await client.voiceHubs.Get(hub.id))?.config.name === "{user} zockt");

    const settings: IVoiceSettings = { ...DefaultVoiceSettings(), name: "Laras Kanal", limit: 5 };

    await client.tempVoices.Create({ channelId: TEMP, guildId: GUILD, hubId: hub.id, ownerId: USER, settings });

    check("Der offene Kanal steht in der Tabelle", (await client.tempVoices.Get(TEMP))?.ownerId === USER);
    check("Er steht beim Server", (await client.tempVoices.OfGuild(GUILD)).length === 1);
    check("Der Start findet ihn", (await client.tempVoices.All()).some((entry) => entry.channelId === TEMP));

    await client.tempVoices.Save(TEMP, { ...settings, privacy: "private" }, OTHER);

    const moved = await client.tempVoices.Get(TEMP);

    check("Besitzerwechsel und Einstellungen bleiben", moved?.ownerId === OTHER && moved.settings.privacy === "private");

    await client.tempVoices.Save(TEMP, settings, USER);

    console.log("\n  — Was das Panel auslöst —");

    const fake = FakeChannel(guild);
    let kicked = false;
    const owner = FakeMember(guild, USER, fake.channel);
    const other = FakeMember(guild, OTHER, fake.channel, { disconnect: () => (kicked = true) });
    const service = client.voiceService;

    guild.members.cache.set(USER, owner);
    guild.members.cache.set(OTHER, other);
    (fake.channel.members as unknown as Map<string, GuildMember>).set(OTHER, other);

    const fails = async (name: string, run: () => Promise<unknown>, expect: string): Promise<void> => {
        try {
            await run();
            check(name, false, "kein Fehler");
        } catch (error) {
            check(name, error instanceof VoiceError && error.message.toLowerCase().includes(expect.toLowerCase()), String(error));
        }
    };

    check("Umbenennen", (await service.Run(owner, "name", { text: "Ranked 2v2" })).includes("Ranked 2v2"));
    check("Der Kanal wurde wirklich geändert", fake.edits.at(-1)?.name === "Ranked 2v2");
    check("Größe setzen", (await service.Run(owner, "userlimit", { text: "4" })).includes("4"));
    check("0 heißt unbegrenzt", (await service.Run(owner, "userlimit", { text: "0" })).includes("unbegrenzt"));
    await fails("Eine Größe muss eine Zahl sein", () => service.Run(owner, "userlimit", { text: "viele" }), "Zahl");
    check("Privat schalten", (await service.Run(owner, "privacy")).includes("Privat"));
    check("Und wieder offen", (await service.Run(owner, "privacy")).includes("Offen"));
    check("Unsichtbar schalten", (await service.Run(owner, "stealthmode")).includes("Unsichtbar"));
    await service.Run(owner, "stealthmode");
    check("Region setzen", (await service.Run(owner, "region", { text: "frankfurt" })).includes("Frankfurt"));
    await fails("Eine erfundene Region nicht", () => service.Run(owner, "region", { text: "mond" }), "Region");

    check("Jemandem vertrauen", (await service.Run(owner, "trustuser", { target: other })).includes(OTHER));
    check("Er steht in der Liste", (await client.tempVoices.Get(TEMP))?.settings.trusted.includes(OTHER) === true);
    check("Blockieren nimmt das Vertrauen weg", (await service.Run(owner, "blockuser", { target: other })).includes(OTHER));

    const blocked = await client.tempVoices.Get(TEMP);

    check("Er ist blockiert und nicht mehr vertraut", blocked?.settings.blocked.includes(OTHER) === true && blocked.settings.trusted.length === 0);
    check("Blockierte fliegen raus", kicked);
    check("Blockierung aufheben", (await service.Run(owner, "unblockuser", { target: other })).includes(OTHER));
    await fails("Sich selbst blockiert niemand", () => service.Run(owner, "blockuser", { target: owner }), "selbst");
    await fails("Ohne Ziel geht es nicht", () => service.Run(owner, "trustuser", {}), "aus");

    check("Einladen verschickt eine DM", (await service.Run(owner, "inviteuser", { target: other })).includes("Einladung"));
    check("Eine Einladung wurde erstellt", fake.invites === 1);
    check("Rauswerfen", (await service.Run(owner, "kickuser", { target: other })).includes("raus"));

    check("Den Kanal übergeben", (await service.Run(owner, "transferownership", { target: other })).includes(OTHER));
    check("Jetzt gehört er dem anderen", (await client.tempVoices.Get(TEMP))?.ownerId === OTHER);
    await fails("Und der Alte darf nichts mehr", () => service.Run(owner, "name", { text: "Meins" }), "gehört");

    console.log("\n  — Presets —");

    check("Preset speichern", (await service.SavePreset(other, "Ranked 2v2")).includes("Ranked 2v2"));
    check("Das erste ist gleich Standard", (await client.voicePresets.Default(OTHER))?.name === "Ranked 2v2");

    const preset = (await client.voicePresets.Of(OTHER))[0];

    check("Anwenden klappt", (await service.ApplyPreset(other, preset.id)).includes("Ranked 2v2"));

    // Ein Preset, das jemand anderem gehoert - der Besitzer des Kanals darf es trotzdem nicht anwenden.
    const stranger = await client.voicePresets.Save(USER, "Fremd", DefaultVoiceSettings());

    await fails("Fremde Presets gehen niemanden etwas an", () => service.ApplyPreset(other, stranger.id), "gibt es nicht");

    await service.DeletePreset(OTHER, preset.id);

    check("Löschen klappt", (await client.voicePresets.Of(OTHER)).length === 0);

    check("Den Kanal löschen", (await service.Run(other, "deletechannel")).includes("weg"));
    check("Er ist wirklich weg", fake.deleted && (await client.tempVoices.Get(TEMP)) === null);
}

async function cleanup(client: BotClient): Promise<void> {
    const db = client.databaseService;

    await db.Write("DELETE FROM voice_hubs WHERE guild_id = ?", [GUILD]);
    await db.Write("DELETE FROM temp_voices WHERE guild_id = ?", [GUILD]);
    await db.Write("DELETE FROM voice_presets WHERE user_id IN (?, ?)", [USER, OTHER]);

    client.voiceHubs.Forget();
    client.tempVoices.Forget();
    client.voicePresets.Forget();

    check("Aufgeräumt", (await client.voiceHubs.OfGuild(GUILD)).length === 0 && (await client.tempVoices.OfGuild(GUILD)).length === 0);
}

async function main(): Promise<void> {
    console.log("\n🔊 Temp Voice\n");

    const client = new BotClient();

    await client.configService.Initialize();

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
