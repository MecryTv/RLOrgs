import Model from "../structures/Model";
import { OrNull, TABLES, TableName, TeamRole } from "../constants/Database";

export interface ITeamRow {
    id: number;
    guild_id: string;
    name: string;
    tag: string | null;
    role_id: string | null;
    active: number;
    created_at: Date;
    updated_at: Date;
}

export interface ITeamMemberRow {
    team_id: number;
    user_id: string;
    role: TeamRole;
    joined_at: Date;
}

/**
 * Teams und ihre Mitglieder. Die Mitglieder stehen in einer eigenen Tabelle,
 * werden aber nie ohne ihr Team gebraucht - deshalb liegen beide hier zusammen
 * statt in zwei Models.
 */
export default class Team extends Model<ITeamRow> {
    readonly Table: TableName = TABLES.teams;
    readonly Key = ["id"] as const;

    async OfGuild(guildId: string, onlyActive = true): Promise<ITeamRow[]> {
        const match: Record<string, unknown> = { guild_id: guildId };

        if (onlyActive) match.active = 1;

        return this.Where(match, "`name` ASC");
    }

    async ByName(guildId: string, name: string): Promise<ITeamRow | null> {
        const rows = await this.Where({ guild_id: guildId, name });

        return rows[0] ?? null;
    }

    async Create(guildId: string, name: string, tag?: string, roleId?: string): Promise<number> {
        const result = await this.Insert({
            guild_id: guildId,
            name,
            tag: OrNull(tag),
            role_id: OrNull(roleId),
            active: 1,
        });

        return result.insertId;
    }

    /** Auflösen heißt hier: stillgelegt, nicht gelöscht - die Partien bleiben zuordenbar. */
    async Archive(teamId: number): Promise<void> {
        await this.Update([teamId], { active: 0 });
    }

    /* ----------------------------------------------------------
       Mitglieder
       ---------------------------------------------------------- */
    async Members(teamId: number): Promise<ITeamMemberRow[]> {
        return this.db.Cached(TABLES.members, `team:${teamId}`, () =>
            this.db.Query<ITeamMemberRow>(
                `SELECT * FROM \`${TABLES.members}\` WHERE team_id = ? ORDER BY FIELD(role, 'captain', 'player', 'substitute', 'coach'), joined_at ASC`,
                [teamId]
            )
        );
    }

    /** Die Teams eines Spielers auf einem Server - für "in welchem Team bin ich?". */
    async TeamsOf(guildId: string, userId: string): Promise<ITeamRow[]> {
        return this.db.Cached(TABLES.members, `user:${guildId}:${userId}`, () =>
            this.db.Query<ITeamRow>(
                `SELECT t.* FROM \`${TABLES.teams}\` t
                 JOIN \`${TABLES.members}\` m ON m.team_id = t.id
                 WHERE t.guild_id = ? AND m.user_id = ? AND t.active = 1
                 ORDER BY t.name ASC`,
                [guildId, userId]
            )
        );
    }

    async AddMember(teamId: number, userId: string, role: TeamRole = "player"): Promise<void> {
        await this.db.Write(
            `INSERT INTO \`${TABLES.members}\` (team_id, user_id, role) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE role = VALUES(role)`,
            [teamId, userId, role]
        );

        this.db.Bump(TABLES.members);
    }

    async RemoveMember(teamId: number, userId: string): Promise<boolean> {
        const result = await this.db.Write(`DELETE FROM \`${TABLES.members}\` WHERE team_id = ? AND user_id = ?`, [
            teamId,
            userId,
        ]);

        this.db.Bump(TABLES.members);

        return result.affectedRows > 0;
    }

    /**
     * Wie viele aktive Teams je Server. Eine Abfrage für die ganze Serverliste
     * des Dashboards statt einer pro Karte.
     */
    async CountsOf(guildIds: string[]): Promise<Map<string, number>> {
        const counts = new Map<string, number>();

        if (guildIds.length === 0) return counts;

        const marks = guildIds.map(() => "?").join(", ");

        const rows = await this.db.Cached(this.Table, `counts:${guildIds.join(",")}`, () =>
            this.db.Query<{ guild_id: string; total: number }>(
                `SELECT guild_id, COUNT(*) AS total FROM \`${this.Table}\`
                 WHERE active = 1 AND guild_id IN (${marks}) GROUP BY guild_id`,
                guildIds
            )
        );

        for (const row of rows) counts.set(row.guild_id, Number(row.total));

        return counts;
    }
}
