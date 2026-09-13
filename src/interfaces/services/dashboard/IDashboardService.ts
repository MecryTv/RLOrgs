import BotClient from "../../../client/BotClient";
import { ModuleId } from "../../../constants/Modules";
import IDashboardActivity from "./IDashboardActivity";
import IDashboardGuild from "./IDashboardGuild";
import IDashboardGuildDetail from "./IDashboardGuildDetail";
import IDashboardSession from "./IDashboardSession";
import IDashboardUser, { DashboardGroup } from "./IDashboardUser";

export interface IDashboardPayload {
    user: IDashboardUser;
    guilds: IDashboardGuild[];
    inviteURL: string;
}

export default interface IDashboardService {
    client: BotClient;

    readonly ClientId: string;
    readonly RedirectURI: string;
    readonly Secure: boolean;
    readonly IsConfigured: boolean;

    AuthorizeURL(state: string): string;
    InviteURL(guildId?: string): string;

    Exchange(code: string): Promise<IDashboardSession>;
    Session(cookie: string | undefined): IDashboardSession | null;
    Sign(session: IDashboardSession): string;
    Destroy(session: IDashboardSession): void;

    /** Wirft SessionExpired, wenn Discord den Token abgelehnt hat. */
    Payload(session: IDashboardSession): Promise<IDashboardPayload>;
    /** null heißt "der Nutzer darf diesen Server nicht sehen". Wirft SessionExpired. */
    Detail(session: IDashboardSession, guildId: string): Promise<IDashboardGuildDetail | null>;
    /** Schaltet ein Modul an oder aus. null heißt "darf diesen Server nicht verwalten". Wirft SessionExpired. */
    SetModule(session: IDashboardSession, guildId: string, moduleId: ModuleId, on: boolean): Promise<string[] | null>;
    /** Darf diese Sitzung den Server verwalten? Wirft SessionExpired. */
    CanManage(session: IDashboardSession, guildId: string): Promise<boolean>;
    /**
     * Die Aktivität eines Servers für die Übersicht. null heißt "darf diesen
     * Server nicht sehen", "offline" heißt: ohne Datenbank wird nicht gezählt.
     * Wirft SessionExpired.
     */
    Activity(session: IDashboardSession, guildId: string): Promise<IDashboardActivity | "offline" | null>;
    /** Holt fehlende Mitgliederlisten nach, sofern das Members-Intent an ist. Kehrt sofort zurück. */
    Warm(): void;
    /** Anzeigegruppe einer Discord-ID aus der Datenbank - "testphase", wenn dort nichts steht. */
    GroupOf(userId: string): Promise<DashboardGroup>;
    IsStaff(userId: string): Promise<boolean>;
}
