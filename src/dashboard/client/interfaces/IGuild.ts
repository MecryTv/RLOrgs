/** Ein Server, wie ihn /api/me liefert. Spiegelt IDashboardGuild aus dem Backend. */

export type DashboardRole = "Owner" | "Admin" | "Staff";

export interface IGuild {
    id: string;
    name: string;
    tag: string;
    icon: string | null;
    members: number;
    bots: number | null;
    active: boolean;
    role: DashboardRole;
    canManage: boolean;
    created: string;
    teams: number;
    modules: string[];
    c1: string;
    c2: string;
}

export interface IServerFacts {
    channels: number;
    roles: number;
    boosts: number;
    boostTier: number;
    isOwner: boolean;
}

export interface IMemberFacts {
    nick: string | null;
    joinedAt: string | null;
    roles: number;
}

export interface IGuildDetail {
    guild: IGuild;
    server: IServerFacts | null;
    member: IMemberFacts | null;
    /** Eingeschaltete Module, frisch aus der Datenbank. null: ohne Datenbank nicht schaltbar. */
    modules: string[] | null;
}
