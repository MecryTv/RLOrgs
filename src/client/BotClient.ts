import { Client, Collection, GatewayIntentBits, Partials } from "discord.js";
import IBotClient from "../interfaces/client/IBotClient";
import Command from "../structures/Command";
import logger from "../utils/logger";
import ConstructionHandler from "../handler/ContructionHandler";
import { IConfig } from "../interfaces/config/IConfig";
import LoadConfig from "../utils/config";
import Guardian from "../Guardian";
import RunnableService from "../services/RunnableService";
import GalleryService from "../services/GalleryService";
import ConfigService from "../services/ConfigService";
import DevLogsService from "../services/DevLogsService";
import Server from "../Server";
import DashboardService from "../services/DashboardService";
import DatabaseService from "../services/DatabaseService";
import PrimeService from "../services/PrimeService";
import ActivityService from "../services/ActivityService";
import TicketService from "../services/TicketService";
import TranscriptService from "../services/TranscriptService";
import LiveService from "../services/LiveService";
import ModerationService from "../services/ModerationService";
import StreamService from "../services/StreamService";
import PollService from "../services/PollService";
import GiveawayService from "../services/GiveawayService";
import VoiceService from "../services/VoiceService";
import LevelService from "../services/LevelService";
import MessageService from "../services/MessageService";
import GuildSettings from "../models/GuildSettings";
import DashboardGroups from "../models/DashboardGroups";
import Notifications from "../models/Notifications";
import PlayerRanks from "../models/PlayerRanks";
import Clubs from "../models/Clubs";
import Team from "../models/Team";
import PlayerAccount from "../models/PlayerAccount";
import Match from "../models/Match";
import Activity from "../models/Activity";
import TicketSettings from "../models/TicketSettings";
import Tickets from "../models/Tickets";
import TicketBlacklist from "../models/TicketBlacklist";
import TicketTranscripts from "../models/TicketTranscripts";
import UserCodes from "../models/UserCodes";
import ModSettings from "../models/ModSettings";
import ModCases from "../models/ModCases";
import ModuleSettings from "../models/ModuleSettings";
import StreamNotifiers from "../models/StreamNotifiers";
import UserConnections from "../models/UserConnections";
import VoiceHubs from "../models/VoiceHubs";
import TempVoices from "../models/TempVoices";
import VoicePresets from "../models/VoicePresets";
import Levels from "../models/Levels";
import CustomMessages from "../models/CustomMessages";
import AutoResponses from "../models/AutoResponses";
import Polls from "../models/Polls";
import Giveaways from "../models/Giveaways";

export default class BotClient extends Client implements IBotClient {

    config: IConfig;
    constructionHandlers: ConstructionHandler;
    commands: Collection<string, Command>;
    cooldowns: Collection<string, Collection<string, number>>;
    developerMode: boolean;
    guardian: Guardian;
    runnableService: RunnableService;
    galleryService: GalleryService;
    configService: ConfigService;
    devLogsService: DevLogsService;
    server: Server;
    dashboardService: DashboardService;
    databaseService: DatabaseService;
    primeService: PrimeService;
    activityService: ActivityService;
    ticketService: TicketService;
    transcriptService: TranscriptService;
    liveService: LiveService;
    moderationService: ModerationService;
    streamService: StreamService;
    pollService: PollService;
    giveawayService: GiveawayService;
    voiceService: VoiceService;
    levelService: LevelService;
    messageService: MessageService;

    // Ein Model je Tabelle. Sie hängen am Client, damit Befehle, Events und
    // Routen dieselbe Instanz benutzen - und damit denselben Cache.
    groups: DashboardGroups;
    notifications: Notifications;
    ranks: PlayerRanks;
    clubs: Clubs;
    settings: GuildSettings;
    teams: Team;
    accounts: PlayerAccount;
    matches: Match;
    activity: Activity;
    ticketSettings: TicketSettings;
    tickets: Tickets;
    ticketBlacklist: TicketBlacklist;
    ticketTranscripts: TicketTranscripts;
    userCodes: UserCodes;
    modSettings: ModSettings;
    modCases: ModCases;
    moduleSettings: ModuleSettings;
    streamNotifiers: StreamNotifiers;
    userConnections: UserConnections;
    voiceHubs: VoiceHubs;
    tempVoices: TempVoices;
    voicePresets: VoicePresets;
    levels: Levels;
    customMessages: CustomMessages;
    autoResponses: AutoResponses;
    polls: Polls;
    giveaways: Giveaways;

    constructor() {
        // Vor super(): die Intents hängen an der Konfiguration, und this gibt es
        // hier noch nicht. Deshalb wird sie einmal in eine lokale Variable geladen.
        const config = LoadConfig();

        // MessageContent bleibt: der Galerie-Upload sammelt Links aus einer Nachricht ein.
        // GuildVoiceStates zählt die Zeit im Sprachkanal für die Server-Übersicht -
        // nicht privilegiert, also ohne Schalter im Developer Portal.
        // GuildMembers ist privilegiert und kommt nur dazu, wenn es in der
        // .env steht - siehe docs/Dashboard.md.
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
                // ModMail lebt in der DM: ohne dieses Intent bekommt der Bot sie nie
                // zu sehen. Es ist nicht privilegiert.
                GatewayIntentBits.DirectMessages,
                // Bans und Entbannungen - die Moderation schließt damit offene Fälle
                // und hält die Bannliste für /unban aktuell. Nicht privilegiert.
                GatewayIntentBits.GuildModeration,
                ...(config.GUILD_MEMBER_INTENT ? [GatewayIntentBits.GuildMembers] : []),
                // Nur für die Live-Rolle des Twitch Notifiers - privilegiert wie oben.
                ...(config.GUILD_PRESENCE_INTENT ? [GatewayIntentBits.GuildPresences] : []),
            ],
            // Einen DM-Kanal kennt der Bot beim ersten Mal noch nicht - ohne dieses
            // Partial verwirft discord.js die Nachricht, statt sie zu melden.
            partials: [Partials.Channel],
        });

        this.config = config;
        this.constructionHandlers = new ConstructionHandler(this);
        this.commands = new Collection();
        this.cooldowns = new Collection();
        this.developerMode = process.argv.includes("--dev");
        this.guardian = new Guardian(this);
        this.runnableService = new RunnableService(this);
        this.galleryService = new GalleryService(this);
        this.configService = new ConfigService(this);
        this.devLogsService = new DevLogsService(this);
        this.server = new Server(this);
        this.dashboardService = new DashboardService(this);
        this.databaseService = new DatabaseService(this);
        this.primeService = new PrimeService(this);
        this.activityService = new ActivityService(this);
        this.ticketService = new TicketService(this);
        this.transcriptService = new TranscriptService(this);
        this.liveService = new LiveService(this);
        this.moderationService = new ModerationService(this);
        this.streamService = new StreamService(this);
        this.pollService = new PollService(this);
        this.giveawayService = new GiveawayService(this);
        this.voiceService = new VoiceService(this);
        this.levelService = new LevelService(this);
        this.messageService = new MessageService(this);

        this.groups = new DashboardGroups(this);
        this.notifications = new Notifications(this);
        this.ranks = new PlayerRanks(this);
        this.clubs = new Clubs(this);
        this.settings = new GuildSettings(this);
        this.teams = new Team(this);
        this.accounts = new PlayerAccount(this);
        this.matches = new Match(this);
        this.activity = new Activity(this);
        this.ticketSettings = new TicketSettings(this);
        this.tickets = new Tickets(this);
        this.ticketBlacklist = new TicketBlacklist(this);
        this.ticketTranscripts = new TicketTranscripts(this);
        this.userCodes = new UserCodes(this);
        this.modSettings = new ModSettings(this);
        this.modCases = new ModCases(this);
        this.moduleSettings = new ModuleSettings(this);
        this.streamNotifiers = new StreamNotifiers(this);
        this.userConnections = new UserConnections(this);
        this.voiceHubs = new VoiceHubs(this);
        this.tempVoices = new TempVoices(this);
        this.voicePresets = new VoicePresets(this);
        this.levels = new Levels(this);
        this.customMessages = new CustomMessages(this);
        this.autoResponses = new AutoResponses(this);
        this.polls = new Polls(this);
        this.giveaways = new Giveaways(this);
    }

    Init(): void {
        this.guardian.Initialize();

        logger.asciiBanner();
        logger.info(`🤖 Bot Mode: ${this.developerMode ? "Development" : "Production"}`);

        logger.beforeExit(async (signal) => {
            logger.info(`🛑 Shutting down (${signal})...`);
            this.runnableService.Stop();
            this.configService.Unwatch();
            await this.server.Stop();
            // Vor dem Schließen der Datenbank: die letzte Minute Aktivität soll noch hinein.
            await this.activityService.Stop();
            await this.databaseService.Close();
            this.primeService.Close();
            await this.destroy();
            logger.info("👋 Discord connection closed");
        });

        // Bewusst ohne await: eine nicht erreichbare Datenbank meldet sich im Log
        // und hält den Start nicht auf. Was sie braucht, prüft jeder Aufrufer
        // über databaseService.Ready.
        this.databaseService.Connect().catch((err) => logger.error("🗄️  Datenbank konnte nicht starten", err));

        this.runnableService.Initialize().catch((err) => logger.error("🔄 RunnableService konnte nicht starten", err));
        this.galleryService.Initialize().catch((err) => logger.error("🖼️  Galerie konnte nicht starten", err));

        // Live Tickets: Nachrichten in Ticket-Kanälen gehen an offene Dashboards.
        this.liveService.Initialize();

        // Zählt Nachrichten, Sprachkanäle und Beitritte mit und schreibt einmal
        // pro Minute gebündelt weg - siehe docs/Activity.md.
        this.activityService.Start();

        this.configService
            .Initialize()
            .then(() => {
                if (this.developerMode) this.configService.Watch();
            })
            .catch((err) => logger.error("⚙️  Konfigurationen konnten nicht geladen werden", err));

        this.server.Start().catch((err) => logger.error("🌐 Server konnte nicht starten", err));

        this.LoadContructionHandlers();
        this.login(this.developerMode ? this.config.DEV_CLIENT_TOKEN : this.config.CLIENT_TOKEN)
            .catch((err) => { console.error(err); });
    }

    async LoadContructionHandlers(): Promise<void> {
        await this.constructionHandlers.LoadEvents();
        await this.constructionHandlers.LoadCommands();
    }
}
