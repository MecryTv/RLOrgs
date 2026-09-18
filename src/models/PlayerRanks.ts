import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { PLAYLIST_IDS } from "../constants/Prime";
import { IWTSIInput } from "../constants/WTSI";
import { IPrimeClub, IPrimeRank, IPrimeStat } from "../interfaces/services/prime/IPrimeService";

export interface IPlayerRankRow {
    user_id: string;
    playlist: number;
    mmr: number;
    peak_mmr: number;
    tier: number;
    division: number;
    matches: number;
    streak: number;
    placement: number;
    updated_at: Date;
}

/**
 * Der zuletzt bekannte Stand der Ränge, je Spieler und Playlist.
 *
 * Zwei Aufgaben: die Rocket-League-API vor Dauerfeuer schützen (gelesen wird
 * höchstens alle zehn Minuten), und den Peak führen - die höchste je gesehene
 * MMR, auf der die WTSI-Rechnung aufsetzt.
 */
export default class PlayerRanks extends Model<IPlayerRankRow> {
    readonly Table: TableName = TABLES.ranks;
    readonly Key = ["user_id", "playlist"] as const;

    async Of(userId: string): Promise<IPlayerRankRow[]> {
        return this.Where({ user_id: userId }, "`playlist` ASC");
    }

    /**
     * Wie alt der Stand ist, in Millisekunden. null heißt: es gibt keinen.
     *
     * Maßgeblich ist die **älteste** der drei Zeilen - sonst würde eine einzelne
     * frisch geschriebene Playlist die beiden anderen als aktuell ausweisen.
     */
    async AgeOf(userId: string): Promise<number | null> {
        const row = await this.db.Cached(this.Table, `age:${userId}`, () =>
            this.db.One<{ oldest: Date | null }>(
                `SELECT MIN(updated_at) AS oldest FROM \`${this.Table}\` WHERE user_id = ?`,
                [userId]
            )
        );

        if (!row?.oldest) return null;

        const oldest = new Date(row.oldest).getTime();

        return Number.isNaN(oldest) ? null : Date.now() - oldest;
    }

    /**
     * Schreibt den frischen Stand.
     *
     * GREATEST hält den Peak fest: er wächst mit, fällt aber nie - genau das
     * verankert die WTSI-Rechnung an der besten je erreichten Leistung.
     */
    async Snapshot(userId: string, ranks: IPrimeRank[]): Promise<void> {
        if (ranks.length === 0) return;

        for (const rank of ranks) {
            const playlist = PLAYLIST_IDS[rank.key];

            if (playlist === undefined) continue;

            await this.db.Write(
                `INSERT INTO \`${this.Table}\`
                     (user_id, playlist, mmr, peak_mmr, tier, division, matches, streak, placement)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                     mmr = VALUES(mmr),
                     peak_mmr = GREATEST(peak_mmr, VALUES(mmr)),
                     tier = VALUES(tier),
                     division = VALUES(division),
                     matches = VALUES(matches),
                     streak = VALUES(streak),
                     placement = VALUES(placement),
                     updated_at = CURRENT_TIMESTAMP`,
                [
                    userId,
                    playlist,
                    rank.mmr,
                    rank.mmr,
                    rank.tier,
                    rank.division,
                    rank.matches,
                    rank.streak,
                    rank.placementMatches,
                ]
            );
        }

        this.db.Bump(this.Table);
    }

    /* ----------------------------------------------------------
       Profil: Reward-Level und Karriere-Werte
       ---------------------------------------------------------- */
    async ProfileOf(
        userId: string
    ): Promise<{ level: number; wins: number; stats: IPrimeStat[]; club: IPrimeClub | null } | null> {
        const row = await this.db.Cached(TABLES.profiles, `user:${userId}`, () =>
            this.db.One<{
                season_level: number;
                season_wins: number;
                stats: string | IPrimeStat[];
                club: string | IPrimeClub | null;
            }>(`SELECT season_level, season_wins, stats, club FROM \`${TABLES.profiles}\` WHERE user_id = ?`, [userId])
        );

        if (!row) return null;

        return {
            level: Number(row.season_level),
            wins: Number(row.season_wins),
            stats: Unpack<IPrimeStat[]>(row.stats, []),
            club: Unpack<IPrimeClub | null>(row.club, null),
        };
    }

    async SaveProfile(
        userId: string,
        level: number,
        wins: number,
        stats: IPrimeStat[],
        club: IPrimeClub | null
    ): Promise<void> {
        await this.db.Write(
            `INSERT INTO \`${TABLES.profiles}\` (user_id, season_level, season_wins, stats, club)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 season_level = VALUES(season_level),
                 season_wins = VALUES(season_wins),
                 stats = VALUES(stats),
                 club = VALUES(club),
                 updated_at = CURRENT_TIMESTAMP`,
            [userId, level, wins, JSON.stringify(stats), club ? JSON.stringify(club) : null]
        );

        this.db.Bump(TABLES.profiles);
    }

    /** Aus den gespeicherten Zeilen die Eingabe für die WTSI-Rechnung bauen. */
    static ToWTSI(rows: IPlayerRankRow[]): IWTSIInput {
        const two = rows.find((row) => row.playlist === PLAYLIST_IDS["2v2"]);
        const three = rows.find((row) => row.playlist === PLAYLIST_IDS["3v3"]);

        return {
            current2s: two?.mmr ?? 0,
            peak2s: two?.peak_mmr ?? 0,
            current3s: three?.mmr ?? 0,
            peak3s: three?.peak_mmr ?? 0,
        };
    }

    /** Die gespeicherten Ränge mehrerer Spieler - eine Abfrage für einen ganzen Club. */
    async OfMany(userIds: string[]): Promise<Map<string, IPlayerRankRow[]>> {
        const found = new Map<string, IPlayerRankRow[]>();

        if (userIds.length === 0) return found;

        const marks = userIds.map(() => "?").join(", ");

        const rows = await this.db.Cached(this.Table, `many:${userIds.join(",")}`, () =>
            this.db.Query<IPlayerRankRow>(
                `SELECT * FROM \`${this.Table}\` WHERE user_id IN (${marks})`,
                userIds
            )
        );

        for (const row of rows) {
            const list = found.get(row.user_id) ?? [];

            list.push(row);
            found.set(row.user_id, list);
        }

        return found;
    }
}
