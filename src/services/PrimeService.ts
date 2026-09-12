import http2, { ClientHttp2Session } from "node:http2";
import { LRUCache } from "lru-cache";
import BotClient from "../client/BotClient";
import logger from "../utils/logger";
import IPrimeService, {
    IPrimeClub,
    IPrimeClubMember,
    IPrimeLinkedAccount,
    IPrimeProfile,
    IPrimeRank,
    IPrimeStat,
} from "../interfaces/services/prime/IPrimeService";
import { TeamMMR } from "../constants/WTSI";
import {
    CAREER_STATS,
    DivisionName,
    PLACEMENT_MATCHES,
    PRIME_BASE_URL,
    PRIME_CACHE_KEEP,
    PRIME_CACHE_MAX,
    PRIME_CACHE_TTL,
    PRIME_TIMEOUT,
    TierName,
    ToMMR,
    ToPlayerID,
    TRACKED_PLAYLISTS,
} from "../constants/Prime";

/** Was Prime zu einem Namen zurückgibt. */
interface IRawUser {
    AccountID: string;
    DisplayName: string;
    IdentityProvider: string;
    LinkedAccounts?: { AccountID: string; DisplayName: string; IdentityProvider: string }[];
}

interface IRawSkill {
    Playlist: number;
    Mu: number;
    Sigma: number;
    Tier: number;
    Division: number;
    MMR: number;
    WinStreak: number;
    MatchesPlayed: number;
    PlacementMatchesPlayed: number;
}

interface IRawLeaderboard {
    LeaderboardID: string;
    bHasValue: boolean;
    Value: string;
}

/** Der Ingame-Club, so wie GetFullProfile ihn mitliefert. */
interface IRawClubMember {
    PlayerID: string;
    EpicPlayerID?: string;
    PlayerName: string;
    EpicPlayerName?: string;
    RoleID?: number;
    DeletedTime?: number;
}

interface IRawClub {
    ClubID: number;
    ClubName: string;
    ClubTag: string;
    OwnerPlayerID: string;
    Members?: IRawClubMember[];
    bVerified?: boolean;
    CreatedTime?: number;
    DeletedTime?: number;
}

interface IRawProfile {
    Skills?: IRawSkill[];
    Leaderboards?: IRawLeaderboard[];
    RewardLevels?: { SeasonLevel?: number; SeasonLevelWins?: number };
    // Fehlt, wenn der Spieler in keinem Club ist - das ist der Normalfall.
    ClubDetails?: IRawClub;
}

interface IRawPlayersSkills {
    Players?: { PlayerID: string; Skills?: IRawSkill[] }[];
}

interface IRawEnvelope<T> {
    Result?: T;
    Error?: { Type?: string; Message?: string };
}

/**
 * Ein Fehler von Prime. "type" trägt den Fachfehler durch, damit Aufrufer einen
 * unbekannten Spieler von einer kaputten Verbindung unterscheiden können.
 */
export class PrimeError extends Error {
    type: string;
    status: number;

    constructor(message: string, type = "Unknown", status = 0) {
        super(message);
        this.name = "PrimeError";
        this.type = type;
        this.status = status;
    }
}

// Der Dienst kennt den Spieler nicht - das ist kein Ausfall, sondern eine Antwort.
const NOT_FOUND = new Set(["InvalidPlayer", "PlayerNotFound", "NotFound"]);

export default class PrimeService implements IPrimeService {
    client: BotClient;

    // Profile ändern sich nur nach Spielen. null steht für "kennt Prime nicht" und
    // wird bewusst mitgespeichert, sonst fragt jeder Tippfehler erneut nach.
    //
    // Aufgehoben wird ein Eintrag deutlich länger als er frisch ist: die Frist
    // hier ist PRIME_CACHE_KEEP, über die Frische entscheidet der Zeitstempel in
    // der Zeile. So bleibt ein alter Stand als Notvorrat übrig, falls Prime
    // gerade nicht antwortet.
    private cache = new LRUCache<string, { value: IPrimeProfile | null; at: number }>({
        max: PRIME_CACHE_MAX,
        ttl: PRIME_CACHE_KEEP,
    });

    private session: ClientHttp2Session | null = null;

    // Wie viele Anfragen gerade offen sind. Solange es welche gibt, hält die
    // Verbindung den Prozess wach; danach wird sie wieder losgelassen.
    private pending = 0;

    constructor(client: BotClient) {
        this.client = client;
    }

    get IsConfigured(): boolean {
        return Boolean(this.client.config.PRIME_API_TOKEN);
    }

    /* ----------------------------------------------------------
       Transport
       Prime spricht die HTTP-Methode QUERY, und die geht nur über HTTP/2.
       Über HTTP/1.1 - und damit über fetch und die meisten Clients - kommt
       stumpf ein 400 zurück. Deshalb hier node:http2 statt einer Bibliothek.
       ---------------------------------------------------------- */
    private Session(): ClientHttp2Session {
        if (this.session && !this.session.closed && !this.session.destroyed) return this.session;

        const session = http2.connect(PRIME_BASE_URL);

        session.on("error", () => {
            this.session = null;
        });
        session.on("close", () => {
            this.session = null;
        });

        // Losgelassen, damit eine ruhende Verbindung den Prozess nicht am Leben
        // hält. Für die Dauer einer Anfrage wird sie unten wieder festgehalten.
        session.unref();

        this.session = session;

        return session;
    }

    // Ohne dieses Festhalten beendet sich ein kurzlebiger Prozess mitten in der
    // Anfrage: die unref-te Verbindung allein hält die Ereignisschleife nicht.
    private Hold(session: ClientHttp2Session): void {
        this.pending += 1;
        session.ref();
    }

    private Release(session: ClientHttp2Session): void {
        this.pending -= 1;

        if (this.pending <= 0) {
            this.pending = 0;
            session.unref();
        }
    }

    private Query<T>(path: string, body: unknown): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const payload = JSON.stringify(body);
            const session = this.Session();

            this.Hold(session);

            const request = session.request({
                ":method": "QUERY",
                ":path": path,
                authorization: `Bearer ${this.client.config.PRIME_API_TOKEN}`,
                "content-type": "application/json",
                accept: "application/json",
                "content-length": Buffer.byteLength(payload),
            });

            let status = 0;
            let raw = "";
            let done = false;

            const settle = (error: PrimeError | null, value?: T): void => {
                if (done) return;

                done = true;
                this.Release(session);

                if (error) reject(error);
                else resolve(value as T);
            };

            request.setEncoding("utf8");
            request.setTimeout(PRIME_TIMEOUT, () => {
                request.close(http2.constants.NGHTTP2_CANCEL);
                settle(new PrimeError(`Prime antwortet nicht (${PRIME_TIMEOUT} ms)`, "Timeout"));
            });

            request.on("response", (headers) => {
                status = Number(headers[":status"] ?? 0);
            });

            request.on("data", (chunk: string) => {
                raw += chunk;
            });

            request.on("error", (error) => settle(new PrimeError(error.message, "Transport")));

            request.on("end", () => {
                if (status !== 200) {
                    settle(new PrimeError(`Prime antwortete mit ${status}`, "HTTP", status));
                    return;
                }

                let envelope: IRawEnvelope<T>;

                try {
                    envelope = JSON.parse(raw) as IRawEnvelope<T>;
                } catch {
                    settle(new PrimeError("Prime hat kein gültiges JSON geschickt", "Parse", status));
                    return;
                }

                // Fachfehler kommen mit HTTP 200 und einem Error-Objekt.
                if (envelope.Error) {
                    const type = envelope.Error.Type ?? "Unknown";

                    settle(new PrimeError(envelope.Error.Message ?? type, type, status));
                    return;
                }

                if (envelope.Result === undefined) {
                    settle(new PrimeError("Prime hat kein Result geliefert", "Empty", status));
                    return;
                }

                settle(null, envelope.Result);
            });

            request.end(payload);
        });
    }

    /* ----------------------------------------------------------
       Profil
       ---------------------------------------------------------- */
    async Profile(name: string): Promise<IPrimeProfile | null> {
        const wanted = name.trim();

        if (!wanted) return null;

        if (!this.IsConfigured) {
            throw new PrimeError("PRIME_API_TOKEN fehlt in der .env", "Unconfigured");
        }

        const key = wanted.toLowerCase();
        const hit = this.cache.get(key);

        // Frisch genug: nicht noch einmal fragen.
        if (hit && Date.now() - hit.at < PRIME_CACHE_TTL) return hit.value;

        try {
            const profile = await this.Load(wanted);

            this.cache.set(key, { value: profile, at: Date.now() });

            return profile;
        } catch (error) {
            // Prime antwortet nicht. Gibt es einen alten Stand, ist der brauchbarer
            // als eine Fehlermeldung - aber er wird als alt gekennzeichnet, damit
            // niemand eine Zahl für aktuell hält, die es nicht ist.
            if (!hit) throw error;

            logger.warn(`🎮 Prime nicht erreichbar, alter Stand für "${wanted}": ${String(error)}`);

            return hit.value ? { ...hit.value, stale: true } : hit.value;
        }
    }

    /**
     * Holt ein Profil wirklich - zwei Anfragen, Auflösung und Profil.
     *
     * protected und nicht private, damit die Prüfung einen Ausfall von Prime
     * nachstellen kann. Anders ist der Weg "Prime antwortet nicht, nimm den
     * alten Stand" nicht zu testen, und ungetestet wäre er das Papier nicht
     * wert, auf dem er steht.
     */
    protected async Load(name: string): Promise<IPrimeProfile | null> {
        let user: IRawUser;

        try {
            // Schritt 1: Anzeigename zu einem Konto auflösen.
            user = await this.Query<IRawUser>("/Resolver/ResolveUser", { User: name });
        } catch (error) {
            if (error instanceof PrimeError && NOT_FOUND.has(error.type)) return null;

            throw error;
        }

        const playerId = ToPlayerID(user.IdentityProvider, user.AccountID);

        if (!playerId) {
            throw new PrimeError(`Unbekannte Plattform: ${user.IdentityProvider}`, "Platform");
        }

        // Schritt 2: das Profil über die zusammengesetzte PlayerID.
        const profile = await this.Query<IRawProfile>("/Players/GetFullProfile", { PlayerID: playerId });

        return {
            name: user.DisplayName,
            platform: user.IdentityProvider,
            accountId: user.AccountID,
            playerId,
            linked: (user.LinkedAccounts ?? []).map(
                (entry): IPrimeLinkedAccount => ({
                    platform: entry.IdentityProvider,
                    name: entry.DisplayName,
                    accountId: entry.AccountID,
                })
            ),
            seasonLevel: profile.RewardLevels?.SeasonLevel ?? 0,
            seasonWins: profile.RewardLevels?.SeasonLevelWins ?? 0,
            ranks: this.Ranks(profile.Skills ?? []),
            stats: this.Career(profile.Leaderboards ?? []),
            club: await this.Club(profile.ClubDetails),
            fetchedAt: new Date().toISOString(),
        };
    }

    /**
     * Der Ingame-Club aus derselben Antwort.
     *
     * Fuer die Club-MMR braucht es die Raenge der Mitglieder, und die stehen
     * nicht im Profil - dafuer gibt es GetPlayersSkills, das eine ganze Liste
     * auf einmal beantwortet. Das ist die einzige zusaetzliche Anfrage, und sie
     * geht nur raus, wenn der Spieler ueberhaupt in einem Club ist.
     */
    private async Club(raw: IRawClub | undefined): Promise<IPrimeClub | null> {
        if (!raw?.ClubID) return null;

        // Ausgetretene Mitglieder bleiben mit DeletedTime in der Antwort stehen.
        const roster = (raw.Members ?? []).filter((member) => !member.DeletedTime);
        const skills = await this.SkillsOf(roster.map((member) => member.PlayerID));

        const members: IPrimeClubMember[] = roster.map((member) => {
            const own = skills.get(member.PlayerID) ?? [];
            const value = this.MemberMMR(own);

            return {
                playerId: member.PlayerID,
                name: member.PlayerName,
                // Nur zeigen, wenn er sich vom Namen auf der Plattform unterscheidet.
                epicName:
                    member.EpicPlayerName && member.EpicPlayerName !== member.PlayerName
                        ? member.EpicPlayerName
                        : null,
                owner: member.PlayerID === raw.OwnerPlayerID,
                mmr: value > 0 ? Math.round(value) : null,
            };
        });

        // ponytail: Fuer fremde Mitglieder kennt der Bot keinen Peak - Prime
        // liefert nur den aktuellen Stand. Die WTSI-Rechnung laeuft deshalb mit
        // "aktuell = Peak", was den Schutz gegen Deranking wegfallen laesst.
        // Wer das genauer will, muesste die Werte je Mitglied mitschreiben, so
        // wie player_ranks es fuer eigene Nutzer tut.
        const inputs = roster.map((member) => this.ToWTSI(skills.get(member.PlayerID) ?? []));

        return {
            id: raw.ClubID,
            name: raw.ClubName,
            tag: raw.ClubTag,
            ownerPlayerId: raw.OwnerPlayerID,
            members,
            verified: Boolean(raw.bVerified),
            createdAt: raw.CreatedTime ? new Date(raw.CreatedTime * 1000).toISOString() : null,
            averageMMR: TeamMMR(inputs),
        };
    }

    /** Die Raenge mehrerer Spieler in einer Anfrage. */
    private async SkillsOf(playerIds: string[]): Promise<Map<string, IRawSkill[]>> {
        const found = new Map<string, IRawSkill[]>();

        if (playerIds.length === 0) return found;

        // Ein Ausfall hier darf den Club nicht mitreissen: dann steht eben ein
        // Strich statt einer Zahl.
        let result: IRawPlayersSkills;

        try {
            result = await this.Query<IRawPlayersSkills>("/Skills/GetPlayersSkills", { PlayerIDs: playerIds });
        } catch {
            return found;
        }

        for (const player of result.Players ?? []) found.set(player.PlayerID, player.Skills ?? []);

        return found;
    }

    /** Aus rohen Skills die Eingabe fuer die WTSI-Rechnung - ohne Peak-Historie. */
    private ToWTSI(skills: IRawSkill[]): { current2s: number; peak2s: number; current3s: number; peak3s: number } {
        const value = (id: number): number => {
            const skill = skills.find((entry) => entry.Playlist === id);

            return skill ? ToMMR(skill.MMR) : 0;
        };

        const two = value(11);
        const three = value(13);

        return { current2s: two, peak2s: two, current3s: three, peak3s: three };
    }

    private MemberMMR(skills: IRawSkill[]): number {
        const input = this.ToWTSI(skills);
        const total = input.peak2s + input.peak3s;

        if (total <= 0) return 0;

        // Dieselbe Gewichtung wie in WTSI - nur ohne den Peak-Anteil, den es
        // hier nicht gibt: aktuell gleich Peak macht den Wurzelterm zu 1.
        return input.current2s * (input.peak2s / total) + input.current3s * (input.peak3s / total);
    }

    /**
     * Nur die drei Ranked-Playlists, in fester Reihenfolge. Eine Playlist, die
     * Prime nicht liefert, wird nicht erfunden - sie fällt weg.
     */
    private Ranks(skills: IRawSkill[]): IPrimeRank[] {
        const ranks: IPrimeRank[] = [];

        for (const playlist of TRACKED_PLAYLISTS) {
            const skill = skills.find((entry) => entry.Playlist === playlist.id);

            if (!skill) continue;

            ranks.push({
                key: playlist.key,
                label: playlist.label,
                mmr: ToMMR(skill.MMR),
                tier: skill.Tier,
                tierName: TierName(skill.Tier),
                division: skill.Division,
                // Ohne Rang hat die Division keine Bedeutung.
                divisionName: skill.Tier > 0 ? DivisionName(skill.Division) : null,
                matches: skill.MatchesPlayed,
                streak: skill.WinStreak,
                // Zehn Platzierungsspiele, danach steht der Rang.
                placement: skill.PlacementMatchesPlayed < PLACEMENT_MATCHES,
                placementMatches: skill.PlacementMatchesPlayed,
            });
        }

        return ranks;
    }

    /**
     * Die Karriere-Werte in fester Reihenfolge. Ein Wert ohne bHasValue wird
     * ausgelassen statt als 0 gezeigt - das wäre eine andere Aussage.
     */
    private Career(rows: IRawLeaderboard[]): IPrimeStat[] {
        const stats: IPrimeStat[] = [];

        for (const wanted of CAREER_STATS) {
            const row = rows.find((entry) => entry.LeaderboardID === wanted.id);

            if (!row?.bHasValue) continue;

            const value = Number(row.Value);

            if (!Number.isFinite(value)) continue;

            stats.push({ key: wanted.key, label: wanted.label, value });
        }

        return stats;
    }

    Forget(name?: string): void {
        if (name) this.cache.delete(name.trim().toLowerCase());
        else this.cache.clear();
    }

    Close(): void {
        try {
            this.session?.close();
        } catch {
            // Beim Herunterfahren ist eine hängende Verbindung kein Grund für einen Fehler.
        }

        this.session = null;
    }

    /** Für den Prüflauf und die Diagnose. */
    Stats(): { size: number; configured: boolean } {
        return { size: this.cache.size, configured: this.IsConfigured };
    }
}
