import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { AvatarURL, DASHBOARD_PATH } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import {
    DivisionName,
    PLAYLIST_IDS,
    RANK_MAX_AGE,
    TierName,
    TRACKED_PLAYLISTS,
    PLACEMENT_MATCHES,
} from "../constants/Prime";
import { IPrimeRank } from "../interfaces/services/prime/IPrimeService";
import { WTSI } from "../constants/WTSI";
import PlayerRanks, { IPlayerRankRow } from "../models/PlayerRanks";
import { PrimeError } from "../services/PrimeService";
import { SessionOf } from "../utils/dashboard";
import logger from "../utils/logger";

/** Aus den gespeicherten Zeilen wieder Ränge in der Reihenfolge der Playlists. */
function Restore(rows: IPlayerRankRow[]): IPrimeRank[] {
    const ranks: IPrimeRank[] = [];

    for (const playlist of TRACKED_PLAYLISTS) {
        const row = rows.find((entry) => entry.playlist === PLAYLIST_IDS[playlist.key]);

        if (!row) continue;

        ranks.push({
            key: playlist.key,
            label: playlist.label,
            mmr: row.mmr,
            tier: row.tier,
            tierName: TierName(row.tier),
            division: row.division,
            divisionName: row.tier > 0 ? DivisionName(row.division) : null,
            matches: row.matches,
            streak: row.streak,
            placement: row.placement < PLACEMENT_MATCHES,
            placementMatches: row.placement,
        });
    }

    return ranks;
}

/** Der jüngste Zeitstempel der gespeicherten Zeilen. */
function Freshest(rows: IPlayerRankRow[]): string | null {
    let newest = 0;

    for (const row of rows) {
        const at = new Date(row.updated_at).getTime();

        if (!Number.isNaN(at) && at > newest) newest = at;
    }

    return newest > 0 ? new Date(newest).toISOString() : null;
}

export default class DashboardApiTracking extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/tracking/:userId`,
            description: "Ränge eines Spielers anhand seines verknüpften Epic-Kontos",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 30, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        const { userId } = request.params as { userId?: string };

        if (!userId || !SNOWFLAKE.test(userId)) return reply.code(404).send({ error: "Not Found" });

        // Die eigene Seite immer, fremde nur für Administratoren und Developer.
        const own = userId === session.userId;

        if (!own && !(await this.client.dashboardService.IsStaff(session.userId))) {
            return reply.code(403).send({
                error: "Kein Zugriff",
                hint: "Fremde Rang-Seiten sehen nur Administratoren und Developer.",
            });
        }

        if (!this.client.databaseService.Ready) {
            return reply.code(503).send({ error: "Keine Datenbank", hint: "Verknüpfungen stehen in der Datenbank." });
        }

        // Epic ist die Klammer: die Raenge sind ueber alle Plattformen dieselben,
        // nur dieses eine Konto laesst sich zuverlaessig aufloesen.
        const account = await this.client.accounts.On(userId, "epic");

        if (!account) {
            return reply.code(404).send({
                error: "Kein Spielerkonto verknüpft",
                hint: own ? "Verknüpfe es in den Einstellungen unter „Konten verknüpfen“." : undefined,
                own,
            });
        }

        const user = this.client.users.cache.get(userId);
        const name = account.display_name ?? account.account_id;

        // Erst nachsehen, wie alt der gespeicherte Stand ist. Nur wenn er älter
        // als zehn Minuten ist, geht überhaupt eine Anfrage nach draußen.
        const age = await this.client.ranks.AgeOf(userId);
        const stale = age === null || age > RANK_MAX_AGE;

        let profile = null;
        let failed: string | null = null;

        if (stale) {
            try {
                // Aufgeloest wird ueber die Konto-ID, nicht ueber den Namen:
                // Prime nimmt beides, aber der Name aendert sich, wenn sich
                // jemand im Spiel umbenennt - die ID nie.
                profile = await this.client.primeService.Profile(account.account_id);

                if (profile) {
                    await this.client.ranks.Snapshot(userId, profile.ranks);
                    await this.client.ranks.SaveProfile(
                        userId,
                        profile.seasonLevel,
                        profile.seasonWins,
                        profile.stats,
                        profile.club
                    );
                }
            } catch (error) {
                const prime = error instanceof PrimeError ? error : null;

                logger.warn(`🎮 Prime: ${prime ? `${prime.type} ${prime.message}` : String(error)}`);

                failed =
                    prime?.type === "Unconfigured"
                        ? "Rang-Tracking ist nicht eingerichtet."
                        : "Rocket League antwortet gerade nicht.";
            }
        }

        // Gezeigt wird immer der gespeicherte Stand: er ist die eine Wahrheit,
        // egal ob gerade frisch geholt oder aus den letzten zehn Minuten.
        const stored = await this.client.ranks.Of(userId);
        const saved = await this.client.ranks.ProfileOf(userId);
        const ranks = stored.length > 0 ? Restore(stored) : (profile?.ranks ?? []);
        const updatedAt = Freshest(stored) ?? profile?.fetchedAt ?? null;

        // Ist die API gestört, steht wenigstens der letzte bekannte Stand da.
        if (failed && ranks.length > 0) failed = null;

        // Der Club steht in derselben Antwort wie Raenge und Karriere-Werte und
        // wird mit ihnen gespeichert. Gemeint ist der Club aus dem Spiel - nicht
        // die Tabelle clubs, die der Bot fuer eigene Zwecke fuehrt.
        const club = saved?.club ?? profile?.club ?? null;

        // Der eigene WTSI-Wert: derselbe, mit dem der Spieler in den Club-Schnitt
        // eingeht. 0 heisst, dass zu 2v2 und 3v3 nichts vorliegt - dann lieber
        // null, damit die Seite einen Strich zeigt statt einer Null.
        const wtsi = Math.round(WTSI(PlayerRanks.ToWTSI(stored)));

        return reply.header("Cache-Control", "private, max-age=60").send({
            own,
            user: {
                id: userId,
                name: user ? (user.globalName ?? user.username) : null,
                avatar: user ? AvatarURL(userId, user.avatar) : null,
            },
            account: {
                platform: "epic",
                name,
                verified: account.verified === 1,
                linkedAt: new Date(account.linked_at).toISOString(),
            },
            ranks,
            updatedAt,
            season: saved ? { level: saved.level, wins: saved.wins } : null,
            stats: saved?.stats ?? [],
            club,
            wtsi: wtsi > 0 ? wtsi : null,
            failed,
        });
    }
}
