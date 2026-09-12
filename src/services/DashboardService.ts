import { randomBytes } from "node:crypto";
import { LRUCache } from "lru-cache";
import BotClient from "../client/BotClient";
import IDashboardGuild, { DashboardRole } from "../interfaces/services/dashboard/IDashboardGuild";
import IDashboardService, { IDashboardPayload } from "../interfaces/services/dashboard/IDashboardService";
import IDashboardGuildDetail, {
    IDashboardMemberFacts,
    IDashboardServerFacts,
} from "../interfaces/services/dashboard/IDashboardGuildDetail";
import IDashboardSession from "../interfaces/services/dashboard/IDashboardSession";
import IDashboardUser, { DashboardGroup } from "../interfaces/services/dashboard/IDashboardUser";
import {
    ADMINISTRATOR,
    AvatarURL,
    CreatedAt,
    CrestColors,
    DASHBOARD_PATH,
    DISCORD_API,
    GUILD_CACHE_TTL,
    IconURL,
    Initials,
    INVITE_PERMISSIONS,
    MANAGE_GUILD,
    MAX_SESSIONS,
    OAUTH_SCOPES,
} from "../constants/Dashboard";
import { Open, Seal } from "../utils/seal";
import logger from "../utils/logger";
import { ModuleId } from "../constants/Modules";
import IDashboardActivity from "../interfaces/services/dashboard/IDashboardActivity";

interface IRawGuild {
    id: string;
    name: string;
    icon: string | null;
    owner?: boolean;
    permissions: string;
    approximate_member_count?: number;
}

interface IRawMember {
    nick?: string | null;
    joined_at?: string | null;
    roles?: string[];
}

// Was das Dashboard über die Discord-Antwort hinaus braucht. Kommt in zwei
// Abfragen für die ganze Liste, nicht in einer je Karte.
interface IGuildFacts {
    teams: Map<string, number>;
    modules: Map<string, string[]>;
}

interface IRawUser {
    id: string;
    username: string;
    global_name?: string | null;
    avatar: string | null;
    // Kommt nur mit dem Scope "email" und nur, wenn eine Adresse hinterlegt ist.
    email?: string | null;
    // Ob am Discord-Konto die Zwei-Faktor-Anmeldung eingeschaltet ist. Kommt mit
    // "identify" bei /users/@me mit - nachgemessen, nicht angenommen.
    mfa_enabled?: boolean;
}

/**
 * Das Discord-Konto hat keine Zwei-Faktor-Anmeldung.
 *
 * Kein Fehler im Sinne von "etwas ist kaputt", sondern eine Absage: die Anmeldung
 * war technisch erfolgreich, das Konto erfüllt nur die Bedingung nicht. Deshalb
 * ein eigener Typ - die Route soll das von einem Ausfall unterscheiden können und
 * eine Anleitung zeigen statt einer Fehlermeldung.
 */
export class MfaRequired extends Error {
    constructor() {
        super("Das Discord-Konto hat keine Zwei-Faktor-Anmeldung.");
        this.name = "MfaRequired";
    }
}

// Discord hat den Zugriff verweigert - der Token ist zurückgezogen oder abgelaufen.
// Wird oben in ein 401 übersetzt, damit der Browser sauber neu anmeldet.
export class SessionExpired extends Error {
    constructor() {
        super("Discord hat den Zugriffstoken abgelehnt.");
        this.name = "SessionExpired";
    }
}

export default class DashboardService implements IDashboardService {
    client: BotClient;

    // Die Sitzung steckt verschlüsselt im Cookie selbst, nicht in einem Speicher hier.
    // Deshalb übersteht ein Login jeden Neustart des Bots - siehe docs/Dashboard.md.
    // Die beiden Caches darunter sind reine Abkürzungen für Discord-Abfragen und
    // dürfen jederzeit leer sein.
    private guilds = new LRUCache<string, IDashboardGuild[]>({ max: MAX_SESSIONS, ttl: GUILD_CACHE_TTL });

    // Läuft höchstens einmal gleichzeitig - sonst stößt jeder Seitenaufruf eine
    // weitere Mitglieder-Abfrage an.
    private warming: Promise<void> | null = null;
    private members = new LRUCache<string, IDashboardMemberFacts>({ max: MAX_SESSIONS, ttl: GUILD_CACHE_TTL });

    constructor(client: BotClient) {
        this.client = client;
    }

    get ClientId(): string {
        const { developerMode, config } = this.client;

        return developerMode ? config.DEV_CLIENT_ID : config.CLIENT_ID;
    }

    private get ClientSecret(): string {
        const { developerMode, config } = this.client;

        return developerMode ? config.DEV_CLIENT_SECRET : config.CLIENT_SECRET;
    }

    // Muss Zeichen für Zeichen mit dem Redirect im Developer Portal übereinstimmen.
    get RedirectURI(): string {
        return `${this.client.server.BaseURL}${DASHBOARD_PATH}/callback`;
    }

    get Secure(): boolean {
        return this.RedirectURI.startsWith("https:");
    }

    get IsConfigured(): boolean {
        return Boolean(this.ClientId && this.ClientSecret);
    }

    AuthorizeURL(state: string): string {
        const query = new URLSearchParams({
            client_id: this.ClientId,
            redirect_uri: this.RedirectURI,
            response_type: "code",
            scope: OAUTH_SCOPES.join(" "),
            state,
        });

        return `https://discord.com/oauth2/authorize?${query}`;
    }

    InviteURL(guildId?: string): string {
        const query = new URLSearchParams({
            client_id: this.ClientId,
            permissions: INVITE_PERMISSIONS,
            scope: "bot applications.commands",
        });

        if (guildId) {
            query.set("guild_id", guildId);
            query.set("disable_guild_select", "true");
        }

        return `https://discord.com/oauth2/authorize?${query}`;
    }

    /**
     * Die Gruppe eines Nutzers. Administrator, Partner und Premium stehen in der
     * Datenbank und werden unter /dashboard/admins vergeben. Developer bleibt in
     * DEV_USER_IDs: das ist der Einstieg, über den die erste Berechtigung
     * überhaupt vergeben werden kann - käme auch sie aus der Datenbank, käme
     * niemand mehr hinein.
     *
     * Ohne Datenbank bleibt nur Developer übrig, alle anderen sind Testphase.
     */
    async GroupOf(userId: string): Promise<DashboardGroup> {
        const stored = this.client.databaseService.Ready ? await this.client.groups.Of(userId) : null;

        // Administrator steht über Developer - wer beides hat, ist Administrator.
        if (stored === "administrator") return "administrator";
        if (this.client.config.DEV_USER_IDs.includes(userId)) return "developer";

        return stored ?? "testphase";
    }

    async IsStaff(userId: string): Promise<boolean> {
        const group = await this.GroupOf(userId);

        return group === "administrator" || group === "developer";
    }

    // Ohne das Members-Intent bleibt der Mitglieder-Cache leer und es gibt keine
    // Bot-Zahl. Mit Intent holt discord.js die Liste einmal und hält sie danach
    // über die Gateway-Ereignisse selbst aktuell.
    Warm(): void {
        if (!this.client.config.GUILD_MEMBER_INTENT || this.warming) return;

        this.warming = this.FetchMembers().finally(() => {
            this.warming = null;
        });
    }

    private async FetchMembers(): Promise<void> {
        for (const guild of this.client.guilds.cache.values()) {
            if (guild.members.cache.size >= guild.memberCount) continue;

            try {
                await guild.members.fetch();
            } catch (error) {
                // Ein Server, dessen Liste nicht kommt, kostet nur seine Bot-Zahl.
                logger.warn(`Mitgliederliste von ${guild.name} nicht abrufbar: ${String(error)}`);
            }
        }
    }

    async Exchange(code: string): Promise<IDashboardSession> {
        const response = await fetch(`${DISCORD_API}/oauth2/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: this.ClientId,
                client_secret: this.ClientSecret,
                grant_type: "authorization_code",
                code,
                redirect_uri: this.RedirectURI,
            }),
        });

        if (!response.ok) {
            throw new Error(
                `Discord hat den Code abgelehnt (${response.status}). Pruefe Client Secret und Redirect URI.`
            );
        }

        const token = (await response.json()) as { access_token: string; expires_in: number };
        const user = await this.Fetch<IRawUser>("/users/@me", token.access_token);

        // Ohne Zwei-Faktor bei Discord kommt hier niemand herein. Die Anmeldung
        // haengt vollstaendig an diesem einen Konto - ist es schwach gesichert,
        // ist es das Dashboard auch.
        //
        // Geprueft wird auf genau true: fehlt das Feld, gilt das als "nicht
        // bestaetigt" und nicht als "wird schon passen". Bei einer Regel, die
        // Zugang gewaehrt, ist die vorsichtige Auslegung die richtige.
        if (user.mfa_enabled !== true) {
            logger.warn(`🔒 Anmeldung ohne Zwei-Faktor abgewiesen: ${user.username} (${user.id})`);

            throw new MfaRequired();
        }

        const session: IDashboardSession = {
            id: randomBytes(32).toString("base64url"),
            userId: user.id,
            username: user.global_name?.trim() || user.username,
            handle: user.username,
            email: user.email ?? null,
            avatar: user.avatar,
            accessToken: token.access_token,
            mfa: true,
            expiresAt: Date.now() + token.expires_in * 1000,
        };

        logger.user(`🔐 Dashboard-Login: ${session.username} (${session.userId})`);

        return session;
    }

    Sign(session: IDashboardSession): string {
        return Seal(session, this.client.config.SERVER_JWT_SECRET);
    }

    // Das Cookie trägt die ganze Sitzung, mit SERVER_JWT_SECRET verschlüsselt.
    // Der Browser sieht nur einen undurchsichtigen Block, und der Bot braucht
    // keinen Speicher, der einen Neustart überleben müsste.
    Session(cookie: string | undefined): IDashboardSession | null {
        const session = Open<IDashboardSession>(cookie ?? "", this.client.config.SERVER_JWT_SECRET);

        // Der Inhalt ist echt (GCM prüft das), aber er kann aus einer älteren
        // Version stammen. Deshalb wird die Form trotzdem geprüft.
        if (!session || typeof session !== "object") return null;
        if (typeof session.id !== "string" || !session.id) return null;
        if (typeof session.userId !== "string" || !session.userId) return null;
        if (typeof session.accessToken !== "string" || !session.accessToken) return null;
        if (typeof session.expiresAt !== "number" || session.expiresAt <= Date.now()) return null;

        // Cookies von vor der Zwei-Faktor-Pflicht tragen das Merkmal nicht. Sie
        // gelten damit nicht mehr - sonst liefe die Regel sieben Tage lang an
        // allen vorbei, die gerade angemeldet sind. Kostet einmal ein neues
        // Anmelden, und genau dabei wird geprueft.
        if (session.mfa !== true) return null;

        return session;
    }

    // Räumt die Caches. Die Sitzung selbst lebt im Cookie - die beendet erst der
    // Aufrufer, indem er es löscht (siehe DashboardLogout).
    Destroy(session: IDashboardSession): void {
        this.guilds.delete(session.id);

        // Erst einsammeln, dann löschen - während der Iteration zu mutieren
        // überspringt sonst Einträge.
        for (const key of [...this.members.keys()]) {
            if (key.startsWith(`${session.id}:`)) this.members.delete(key);
        }
    }

    async Payload(session: IDashboardSession): Promise<IDashboardPayload> {
        const guilds = await this.GuildsOf(session);

        return { user: await this.User(session), guilds, inviteURL: this.InviteURL() };
    }

    // Wirft SessionExpired weiter nach oben. Seit die Sitzung im Cookie steckt,
    // kann der Service sie nicht mehr selbst für ungültig erklären - nur die Route
    // kann das Cookie löschen. Ein null als Rückgabe wäre hier mehrdeutig.
    private async GuildsOf(session: IDashboardSession): Promise<IDashboardGuild[]> {
        try {
            return await this.Guilds(session);
        } catch (error) {
            if (error instanceof SessionExpired) this.Destroy(session);

            throw error;
        }
    }

    // Detailseite: alles echt. Der Bot-Cache liefert die Serverzahlen ohne einen
    // einzigen API-Aufruf, guilds.members.read den Nutzer auf genau diesem Server.
    async Detail(session: IDashboardSession, guildId: string): Promise<IDashboardGuildDetail | null> {
        const guilds = await this.GuildsOf(session);
        const guild = guilds.find((entry) => entry.id === guildId);

        // Nicht gefunden heißt: der Nutzer darf diesen Server hier nicht sehen.
        if (!guild) return null;

        const known = this.client.guilds.cache.get(guildId);

        const server: IDashboardServerFacts | null = known
            ? {
                  channels: known.channels.cache.size,
                  roles: known.roles.cache.size,
                  boosts: known.premiumSubscriptionCount ?? 0,
                  boostTier: Number(known.premiumTier) || 0,
                  isOwner: known.ownerId === session.userId,
              }
            : null;

        return {
            guild,
            server,
            member: await this.Member(session, guildId),
            modules: await this.ModulesOn(guildId),
        };
    }

    /**
     * Schaltet ein Modul an oder aus. null heißt: der Nutzer darf diesen Server
     * nicht verwalten - Staff-Zugriff allein reicht dafür nicht, wie überall im
     * Dashboard. Wirft SessionExpired.
     */
    async SetModule(
        session: IDashboardSession,
        guildId: string,
        moduleId: ModuleId,
        on: boolean
    ): Promise<string[] | null> {
        const guild = (await this.GuildsOf(session)).find((entry) => entry.id === guildId);

        if (!guild?.canManage) return null;

        // ponytail: Toggle() liest und schreibt die ganze Liste. Zwei Admins, die
        // im selben Augenblick schalten, können sich überschreiben - wird das je
        // ein Thema, gehört es in eine Transaktion mit SELECT ... FOR UPDATE.
        const modules = await this.client.settings.Toggle(guildId, moduleId, on);

        // Die Serverliste dieser Sitzung zeigt den neuen Stand sofort, nicht erst
        // nach Ablauf ihres Caches.
        guild.modules = modules;

        return modules;
    }

    /**
     * Darf diese Sitzung den Server verwalten? Dieselbe Frage, die SetModule
     * stellt - die Galerie-Routen stellen sie auch, und sie soll an genau einer
     * Stelle beantwortet werden. Wirft SessionExpired.
     */
    async CanManage(session: IDashboardSession, guildId: string): Promise<boolean> {
        const guild = (await this.GuildsOf(session)).find((entry) => entry.id === guildId);

        return Boolean(guild?.canManage);
    }

    // Frisch aus der Datenbank statt aus der zwischengespeicherten Serverliste,
    // sonst stünde nach dem Umschalten bis zu einer Minute der alte Stand da.
    // null heißt: ohne Datenbank lässt sich nichts schalten.
    private async ModulesOn(guildId: string): Promise<string[] | null> {
        if (!this.client.databaseService.Ready) return null;

        try {
            return (await this.client.settings.Of(guildId)).modules;
        } catch (error) {
            logger.warn(`🗄️  Dashboard: Module von ${guildId} nicht ladbar - ${String(error)}`);

            return null;
        }
    }

    /**
     * Die Aktivität eines Servers für die Übersicht. null heißt: der Nutzer darf
     * ihn nicht sehen. "offline" heißt: ohne Datenbank wird nicht gezählt, und
     * es gibt nichts zu zeigen. Wirft SessionExpired.
     */
    async Activity(session: IDashboardSession, guildId: string): Promise<IDashboardActivity | "offline" | null> {
        const guild = (await this.GuildsOf(session)).find((entry) => entry.id === guildId);

        if (!guild) return null;
        if (!this.client.databaseService.Ready) return "offline";

        return this.client.activityService.Overview(guildId);
    }

    private async Member(session: IDashboardSession, guildId: string): Promise<IDashboardMemberFacts | null> {
        const cacheKey = `${session.id}:${guildId}`;
        const cached = this.members.get(cacheKey);

        if (cached) return cached;

        let raw: IRawMember;

        try {
            raw = await this.Fetch<IRawMember>(`/users/@me/guilds/${guildId}/member`, session.accessToken);
        } catch (error) {
            // Fehlt der Scope oder ist der Nutzer nicht mehr Mitglied, bleibt der
            // Block einfach leer - die Seite funktioniert ohne ihn weiter.
            if (error instanceof SessionExpired) throw error;

            return null;
        }

        const facts: IDashboardMemberFacts = {
            nick: raw.nick?.trim() || null,
            joinedAt: raw.joined_at ?? null,
            roles: Array.isArray(raw.roles) ? raw.roles.length : 0,
        };

        this.members.set(cacheKey, facts);

        return facts;
    }

    private async User(session: IDashboardSession): Promise<IDashboardUser> {
        return {
            id: session.userId,
            name: session.username,
            handle: session.handle ?? "",
            email: session.email ?? null,
            avatar: AvatarURL(session.userId, session.avatar),
            group: await this.GroupOf(session.userId),
        };
    }

    private async Guilds(session: IDashboardSession): Promise<IDashboardGuild[]> {
        const cached = this.guilds.get(session.id);
        if (cached) return cached;

        // Nachziehen, was beim Start gefehlt hat - etwa ein Server, auf den der
        // Bot erst danach eingeladen wurde. Bewusst ohne await: die Zahl steht
        // dann beim nächsten Aufbau der Liste da.
        this.Warm();

        const raw = await this.Fetch<IRawGuild[]>("/users/@me/guilds?with_counts=true", session.accessToken);

        // Erst sammeln, welche Server überhaupt in die Liste gehören - danach
        // stehen die IDs fest und Teams und Module kommen in zwei Abfragen für
        // alle auf einmal statt in einer je Karte.
        const picked = new Map<string, { raw: IRawGuild; role: DashboardRole; canManage: boolean }>();

        for (const guild of raw) {
            const permissions = this.Permissions(guild.permissions);
            const admin = (permissions & ADMINISTRATOR) !== 0n || (permissions & MANAGE_GUILD) !== 0n;

            if (!guild.owner && !admin) continue;

            picked.set(guild.id, { raw: guild, role: guild.owner ? "Owner" : "Admin", canManage: true });
        }

        // Entwickler und Seiten-Admins sehen zusätzlich jeden Server, auf dem der Bot
        // sitzt. Bearbeiten dürfen sie dort nur mit eigener Berechtigung (canManage).
        if (await this.IsStaff(session.userId)) {
            for (const guild of this.client.guilds.cache.values()) {
                if (picked.has(guild.id)) continue;

                picked.set(guild.id, {
                    raw: { id: guild.id, name: guild.name, icon: guild.icon, permissions: "0" },
                    role: "Staff",
                    canManage: false,
                });
            }
        }

        const facts = await this.Facts([...picked.keys()]);

        const list = [...picked.values()]
            .map((entry) => this.Card(entry.raw, entry.role, entry.canManage, facts))
            .sort(
            (a, b) => Number(b.active) - Number(a.active) || b.members - a.members || a.name.localeCompare(b.name)
        );

        this.guilds.set(session.id, list);

        return list;
    }

    // Ohne Datenbank bleibt beides leer - die Karten zeigen dann 0 Teams und
    // keine Module, statt die Seite an einem Fehler scheitern zu lassen.
    private async Facts(guildIds: string[]): Promise<IGuildFacts> {
        const empty: IGuildFacts = { teams: new Map(), modules: new Map() };

        if (guildIds.length === 0 || !this.client.databaseService.Ready) return empty;

        try {
            const [teams, modules] = await Promise.all([
                this.client.teams.CountsOf(guildIds),
                this.client.settings.ModulesOf(guildIds),
            ]);

            return { teams, modules };
        } catch (error) {
            logger.warn(`🗄️  Dashboard: Teams und Module nicht ladbar - ${String(error)}`);

            return empty;
        }
    }

    private Card(guild: IRawGuild, role: DashboardRole, canManage: boolean, facts: IGuildFacts): IDashboardGuild {
        const known = this.client.guilds.cache.get(guild.id);

        // Nur zählen, wenn die Liste vollständig ist. Ein halb gefüllter Cache
        // ergäbe eine Zahl, die zu niedrig ist und trotzdem echt aussieht.
        const complete = known ? known.members.cache.size >= known.memberCount : false;

        return {
            id: guild.id,
            name: guild.name,
            tag: Initials(guild.name),
            icon: IconURL(guild.id, guild.icon),
            // Der Bot kennt seine eigenen Server genauer als die Näherung aus der OAuth-Liste.
            members: known?.memberCount ?? guild.approximate_member_count ?? 0,
            bots: complete ? known!.members.cache.filter((member) => member.user.bot).size : null,
            active: Boolean(known),
            role,
            canManage,
            created: CreatedAt(guild.id).toISOString(),
            teams: facts.teams.get(guild.id) ?? 0,
            modules: facts.modules.get(guild.id) ?? [],
            ...CrestColors(guild.id),
        };
    }

    private Permissions(value: string): bigint {
        try {
            return BigInt(value);
        } catch {
            return 0n;
        }
    }

    private async Fetch<T>(endpoint: string, accessToken: string): Promise<T> {
        const response = await fetch(`${DISCORD_API}${endpoint}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (response.status === 401) throw new SessionExpired();
        if (!response.ok) throw new Error(`Discord ${endpoint} antwortete mit ${response.status}.`);

        return (await response.json()) as T;
    }
}
