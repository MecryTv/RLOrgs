import Model from "../structures/Model";
import { TABLES, TableName } from "../constants/Database";
import { TeamMMR } from "../constants/WTSI";
import PlayerRanks, { IPlayerRankRow } from "./PlayerRanks";

export const CLUB_ROLES = ["leader", "officer", "member"] as const;

export type ClubRole = (typeof CLUB_ROLES)[number];

export interface IClubRow {
    id: number;
    name: string;
    tag: string;
    leader_id: string;
    max_members: number;
    created_at: Date;
    updated_at: Date;
}

export interface IClubMemberRow {
    club_id: number;
    user_id: string;
    role: ClubRole;
    joined_at: Date;
}

/** Ein Club samt allem, was das Dashboard davon zeigt. */
export interface IClubView {
    id: number;
    name: string;
    tag: string;
    leaderId: string;
    members: { userId: string; role: ClubRole; joinedAt: string }[];
    memberCount: number;
    maxMembers: number;
    /** Durchschnitt der WTSI-Werte. null, wenn zu niemandem Ränge vorliegen. */
    averageMMR: number | null;
}

/**
 * Clubs hängen am Spieler, nicht am Discord-Server - anders als teams. Ein
 * Spieler ist in höchstens einem Club, deshalb ist user_id der Schlüssel in
 * club_members.
 */
export default class Clubs extends Model<IClubRow> {
    readonly Table: TableName = TABLES.clubs;
    readonly Key = ["id"] as const;

    async ByTag(tag: string): Promise<IClubRow | null> {
        const rows = await this.Where({ tag });

        return rows[0] ?? null;
    }

    async Create(name: string, tag: string, leaderId: string, maxMembers = 6): Promise<number> {
        const result = await this.Insert({ name, tag, leader_id: leaderId, max_members: maxMembers });
        const id = result.insertId;

        // Der Gründer ist das erste Mitglied - ein Club ohne Leader wäre keiner.
        await this.AddMember(id, leaderId, "leader");

        return id;
    }

    async Members(clubId: number): Promise<IClubMemberRow[]> {
        return this.db.Cached(TABLES.clubMembers, `club:${clubId}`, () =>
            this.db.Query<IClubMemberRow>(
                `SELECT * FROM \`${TABLES.clubMembers}\`
                 WHERE club_id = ? ORDER BY FIELD(role, 'leader', 'officer', 'member'), joined_at ASC`,
                [clubId]
            )
        );
    }

    async AddMember(clubId: number, userId: string, role: ClubRole = "member"): Promise<void> {
        await this.db.Write(
            `INSERT INTO \`${TABLES.clubMembers}\` (club_id, user_id, role) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE club_id = VALUES(club_id), role = VALUES(role)`,
            [clubId, userId, role]
        );

        this.db.Bump(TABLES.clubMembers);
    }

    async RemoveMember(userId: string): Promise<boolean> {
        const result = await this.db.Write(`DELETE FROM \`${TABLES.clubMembers}\` WHERE user_id = ?`, [userId]);

        this.db.Bump(TABLES.clubMembers);

        return result.affectedRows > 0;
    }

    /** Der Club eines Spielers, oder null. */
    async Of(userId: string): Promise<IClubRow | null> {
        const row = await this.db.Cached(TABLES.clubMembers, `user:${userId}`, () =>
            this.db.One<IClubRow>(
                `SELECT c.* FROM \`${this.Table}\` c
                 JOIN \`${TABLES.clubMembers}\` m ON m.club_id = c.id
                 WHERE m.user_id = ? LIMIT 1`,
                [userId]
            )
        );

        return row;
    }

    /**
     * Alles, was die Club-Karte zeigt - samt Durchschnitts-MMR nach WTSI.
     *
     * Gerechnet wird über die gespeicherten Ränge: die stehen ohnehin schon da
     * und der Peak, den WTSI braucht, wächst nur dort mit.
     */
    async View(userId: string, ranks: PlayerRanks): Promise<IClubView | null> {
        const club = await this.Of(userId);

        if (!club) return null;

        const members = await this.Members(club.id);
        const byUser = await ranks.OfMany(members.map((member) => member.user_id));

        const inputs = members.map((member) => PlayerRanks.ToWTSI(byUser.get(member.user_id) ?? ([] as IPlayerRankRow[])));

        return {
            id: club.id,
            name: club.name,
            tag: club.tag,
            leaderId: club.leader_id,
            members: members.map((member) => ({
                userId: member.user_id,
                role: member.role,
                joinedAt: new Date(member.joined_at).toISOString(),
            })),
            memberCount: members.length,
            maxMembers: club.max_members,
            averageMMR: TeamMMR(inputs),
        };
    }
}
