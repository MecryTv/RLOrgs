import { IMessageDoc } from "../../builder/IMessageDoc";

/* ----------------------------------------------------------
   Twitch und YouTube - siehe docs/Notifiers.md
   ---------------------------------------------------------- */
export type StreamPlatform = "twitch" | "youtube";

/** Was gemeldet wird: Twitch kennt nur live, YouTube dazu Videos und Shorts. */
export type StreamKind = "live" | "video" | "short";

export interface IStreamConfig {
    /** Textkanal oder Forum-Beitrag - wie die Log-Kanäle (utils/logtarget.ts). */
    channelId: string | null;
    /** "everyone", "here", eine Rollen-ID oder null. */
    ping: string | null;
    /** Was gemeldet wird. */
    kinds: StreamKind[];
    /** Die eigene Nachricht je Art, mit Platzhaltern. Fehlt eine, gilt die Vorlage. */
    messages: Partial<Record<StreamKind, IMessageDoc>>;
    /** Twitch: die Live-Karte zieht Titel, Spiel, Zuschauer und Bild nach. */
    update: boolean;
    /** Twitch: was nach dem Stream aus der Karte wird. */
    ended: "summary" | "delete" | "keep";
}

/** Ein laufender Twitch-Stream, wie der Bot ihn sich merkt. */
export interface ILiveState {
    streamId: string;
    messageId: string | null;
    channelId: string | null;
    startedAt: number;
    title: string;
    game: string;
    viewers: number;
    peak: number;
    /** Zuletzt an Discord geschickt - die Karte zieht höchstens alle paar Minuten nach. */
    renderedAt: number;
}

export interface IStreamState {
    /** Twitch: der Stream, der gerade läuft. */
    live?: ILiveState | null;
    /** Twitch: wann zuletzt live - für "zuletzt live vor 2 Tagen". */
    lastLiveAt?: number | null;
    /** YouTube: die zuletzt gesehenen Video-IDs - daran erkennt der Bot Neues. */
    seen?: string[];
    /** YouTube: angekündigte Livestreams, die noch nicht laufen. */
    upcoming?: string[];
    /** YouTube: das zuletzt gemeldete Video. */
    last?: { id: string; title: string; kind: StreamKind; at: number } | null;
    /** Ein Hinweis, warum gerade nichts ankommt (Kanal weg, keine Rechte ...). */
    problem?: string | null;
}

export interface IStreamNotifier {
    id: number;
    guildId: string;
    platform: StreamPlatform;
    accountId: string;
    accountName: string;
    accountLogin: string | null;
    avatar: string | null;
    enabled: boolean;
    config: IStreamConfig;
    state: IStreamState;
    createdBy: string;
    createdAt: number;
}

/** Twitch-Einstellungen des Servers, die zu keinem Streamer gehören. */
export interface ITwitchSettings {
    /** Diese Rolle bekommt, wer gerade auf Twitch live ist (Presence Intent). */
    liveRoleId: string | null;
    /** Nur Mitglieder mit dieser Rolle - etwa "Streamer". null: alle. */
    liveRoleFilter: string | null;
}

/* ----------------------------------------------------------
   Umfragen - siehe docs/Polls.md
   ---------------------------------------------------------- */
export type PollKind = "buttons" | "native";

export interface IPollOption {
    id: string;
    label: string;
    emoji: string | null;
}

export interface IPollSettings {
    /** Mehrere Antworten erlaubt. */
    multi: boolean;
    /** Höchstens so viele (0: alle). Nur eigene Umfragen. */
    maxChoices: number;
    /** Wer was gewählt hat, sieht niemand - auch nicht im Dashboard. Nur eigene Umfragen. */
    anonymous: boolean;
    /** Wann die Balken zu sehen sind: immer, nach der eigenen Stimme, erst am Ende. */
    results: "live" | "voted" | "end";
    /** Nur diese Rollen dürfen abstimmen. Leer: alle. */
    roles: string[];
    /** Beim Start anpingen: "everyone", "here", eine Rolle oder null. */
    ping: string | null;
    accent: string | null;
}

export interface IPoll {
    id: number;
    guildId: string;
    number: number;
    kind: PollKind;
    channelId: string;
    messageId: string | null;
    question: string;
    description: string | null;
    options: IPollOption[];
    settings: IPollSettings;
    status: "open" | "ended";
    /** Discord-Umfragen: das Ergebnis am Ende, je Antwort-ID. */
    results: Record<string, number> | null;
    createdBy: string;
    createdAt: number;
    endsAt: number | null;
    endedAt: number | null;
}

/* ----------------------------------------------------------
   Giveaways - siehe docs/Giveaways.md
   ---------------------------------------------------------- */
export interface IGiveawayRequirements {
    /** Braucht eine dieser Rollen (oder alle, siehe allRoles). */
    roles: string[];
    allRoles: boolean;
    /** Darf keine dieser Rollen haben - etwa das Team. */
    forbidden: string[];
    /** Server-Booster: egal, nur Booster oder keine Booster. */
    booster: "any" | "only" | "none";
    /** Mindestens so viele Tage auf dem Server. */
    serverDays: number;
    /** Das Discord-Konto mindestens so viele Tage alt. */
    accountDays: number;
    /** Mindestens so viele Nachrichten in den letzten 14 Tagen. */
    messages: number;
    /** Mit verknüpftem Rocket-League-Konto (Epic). */
    linked: boolean;
}

/** Extra-Lose für eine Rolle - Booster etwa doppelt: tickets 1. */
export interface IGiveawayBonus {
    roleId: string;
    tickets: number;
}

export interface IGiveawaySettings {
    /** Gewinner bekommen eine DM. */
    dm: boolean;
    /** So viele Stunden, um den Gewinn anzunehmen - sonst wird neu ausgelost. 0: ohne Frist. */
    claimHours: number;
    /** Beim Start anpingen: "everyone", "here", eine Rolle oder null. */
    ping: string | null;
    accent: string | null;
}

export interface IGiveawayWinner {
    userId: string;
    drawnAt: number;
    /** Bis wann er den Gewinn annehmen muss - null ohne Frist. */
    deadline: number | null;
    /** won: ohne Frist gewonnen, pending: muss sich noch melden, claimed: hat angenommen, expired/replaced: Frist verpasst bzw. neu ausgelost. */
    status: "won" | "pending" | "claimed" | "expired" | "replaced";
    claimedAt: number | null;
    /** Konnte die DM zugestellt werden? */
    dm: boolean | null;
}

export interface IGiveaway {
    id: number;
    guildId: string;
    number: number;
    channelId: string;
    messageId: string | null;
    prize: string;
    description: string | null;
    image: string | null;
    winners: number;
    hostId: string;
    status: "scheduled" | "running" | "ended" | "cancelled";
    startsAt: number;
    endsAt: number;
    endedAt: number | null;
    requirements: IGiveawayRequirements;
    bonus: IGiveawayBonus[];
    settings: IGiveawaySettings;
    results: { winners: IGiveawayWinner[] };
    createdAt: number;
}
