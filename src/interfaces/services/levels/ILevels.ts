import { IMessageDoc } from "../../builder/IMessageDoc";

/* ----------------------------------------------------------
   Level System - siehe docs/Levels.md
   ---------------------------------------------------------- */

/** Der Stand eines Mitglieds. */
export interface ILevelEntry {
    guildId: string;
    userId: string;
    xp: number;
    level: number;
    messages: number;
    voiceMinutes: number;
    lastMessage: number;
}

/** Ab diesem Level gibt es diese Rolle. */
export interface ILevelReward {
    level: number;
    roleId: string;
}

/** Mehr oder weniger Punkte in bestimmten Kanälen oder für bestimmte Rollen. */
export interface ILevelBonus {
    id: string;
    factor: number;
}

export interface ILevelSettings {
    /** Punkte je Nachricht - zufällig zwischen min und max. */
    chat: { on: boolean; min: number; max: number; cooldown: number };
    /** Punkte je Minute im Sprachkanal. */
    voice: { on: boolean; xp: number; alone: boolean; muted: boolean };
    /** Wie steil es nach oben geht: Level n braucht base * n Punkte. */
    base: number;
    /** Mehr oder weniger Punkte - je Rolle und je Kanal. */
    roleBonus: ILevelBonus[];
    channelBonus: ILevelBonus[];
    /** Hier gibt es gar keine Punkte. */
    noChannels: string[];
    noRoles: string[];
    /** Wo die Aufstiegs-Nachricht landet. */
    announce: "current" | "channel" | "dm" | "off";
    announceChannelId: string | null;
    /** Die Nachricht selbst - ohne eigene gilt die Vorlage. */
    message: IMessageDoc | null;
    /** Rollen ab Level X. */
    rewards: ILevelReward[];
    /** Alte Belohnungsrollen behalten oder durch die neue ersetzen. */
    stack: boolean;
    /** Die Rangliste ist ohne Anmeldung zu sehen. Standard: aus. */
    public: boolean;
}

/** Ein Platz in der Rangliste. */
export interface ILevelRank extends ILevelEntry {
    rank: number;
}
