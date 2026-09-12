import Model from "../structures/Model";
import { MatchState, Playlist, TABLES, TableName } from "../constants/Database";

export interface IMatchRow {
    id: number;
    guild_id: string;
    home_team_id: number | null;
    away_team_id: number | null;
    home_score: number;
    away_score: number;
    playlist: Playlist;
    state: MatchState;
    played_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

/** Bilanz eines Teams: Siege, Niederlagen, Unentschieden und Tordifferenz. */
export interface ITeamRecord {
    wins: number;
    losses: number;
    draws: number;
    goalsFor: number;
    goalsAgainst: number;
}

export default class Match extends Model<IMatchRow> {
    readonly Table: TableName = TABLES.matches;
    readonly Key = ["id"] as const;

    async Schedule(guildId: string, homeTeamId: number, awayTeamId: number, playlist: Playlist = "3v3"): Promise<number> {
        const result = await this.Insert({
            guild_id: guildId,
            home_team_id: homeTeamId,
            away_team_id: awayTeamId,
            playlist,
            state: "scheduled",
        });

        return result.insertId;
    }

    /** Ergebnis eintragen. Setzt den Zeitpunkt, wenn er noch fehlt. */
    async Report(matchId: number, homeScore: number, awayScore: number, playedAt: Date = new Date()): Promise<void> {
        await this.Update([matchId], {
            home_score: homeScore,
            away_score: awayScore,
            state: "finished",
            played_at: playedAt,
        });
    }

    async Recent(guildId: string, limit = 10): Promise<IMatchRow[]> {
        return this.db.Cached(this.Table, `recent:${guildId}:${limit}`, () =>
            this.db.Query<IMatchRow>(
                `SELECT * FROM \`${this.Table}\` WHERE guild_id = ? AND state = 'finished'
                 ORDER BY played_at DESC, id DESC LIMIT ?`,
                [guildId, limit]
            )
        );
    }

    async Upcoming(guildId: string, limit = 10): Promise<IMatchRow[]> {
        return this.db.Cached(this.Table, `upcoming:${guildId}:${limit}`, () =>
            this.db.Query<IMatchRow>(
                `SELECT * FROM \`${this.Table}\` WHERE guild_id = ? AND state IN ('scheduled', 'live')
                 ORDER BY played_at IS NULL, played_at ASC, id ASC LIMIT ?`,
                [guildId, limit]
            )
        );
    }

    /**
     * Bilanz eines Teams. Wird in SQL gerechnet, nicht im Bot: sonst müssten alle
     * Partien einer Saison durch den Speicher, nur um vier Zahlen zu bilden.
     */
    async RecordOf(teamId: number): Promise<ITeamRecord> {
        const row = await this.db.Cached(this.Table, `record:${teamId}`, () =>
            this.db.One<Record<keyof ITeamRecord, number>>(
                `SELECT
                     SUM(CASE WHEN (home_team_id = ? AND home_score > away_score)
                               OR (away_team_id = ? AND away_score > home_score) THEN 1 ELSE 0 END) AS wins,
                     SUM(CASE WHEN (home_team_id = ? AND home_score < away_score)
                               OR (away_team_id = ? AND away_score < home_score) THEN 1 ELSE 0 END) AS losses,
                     SUM(CASE WHEN home_score = away_score THEN 1 ELSE 0 END) AS draws,
                     SUM(CASE WHEN home_team_id = ? THEN home_score ELSE away_score END) AS goalsFor,
                     SUM(CASE WHEN home_team_id = ? THEN away_score ELSE home_score END) AS goalsAgainst
                 FROM \`${this.Table}\`
                 WHERE state = 'finished' AND (home_team_id = ? OR away_team_id = ?)`,
                [teamId, teamId, teamId, teamId, teamId, teamId, teamId, teamId]
            )
        );

        // Ohne eine einzige Partie liefert SUM() null - daraus wird hier eine 0.
        return {
            wins: Number(row?.wins ?? 0),
            losses: Number(row?.losses ?? 0),
            draws: Number(row?.draws ?? 0),
            goalsFor: Number(row?.goalsFor ?? 0),
            goalsAgainst: Number(row?.goalsAgainst ?? 0),
        };
    }
}
