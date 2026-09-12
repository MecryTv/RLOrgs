import IDashboardGuild from "./IDashboardGuild";

// Was der Bot selbst über den Server weiß. Nur gefüllt, wenn er dort drauf ist -
// kostet keinen API-Aufruf, die Werte stehen im Cache aus dem GUILD_CREATE.
export interface IDashboardServerFacts {
    channels: number;
    roles: number;
    boosts: number;
    boostTier: number;
    isOwner: boolean;
}

// Der angemeldete Nutzer auf genau diesem Server, aus dem Scope guilds.members.read.
export interface IDashboardMemberFacts {
    nick: string | null;
    joinedAt: string | null;
    roles: number;
}

export default interface IDashboardGuildDetail {
    guild: IDashboardGuild;
    server: IDashboardServerFacts | null;
    member: IDashboardMemberFacts | null;
    // Die eingeschalteten Module, frisch aus der Datenbank. null heißt: ohne
    // Datenbank lässt sich nichts schalten.
    modules: string[] | null;
}
