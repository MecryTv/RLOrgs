import BotClient from "../../../client/BotClient";
import { PlaylistKey } from "../../../constants/Prime";

/** Ein verknüpftes Konto auf einer anderen Plattform. */
export interface IPrimeLinkedAccount {
    platform: string;
    name: string;
    accountId: string;
}

/** Ein Rang in einer Playlist, fertig zum Anzeigen. */
export interface IPrimeRank {
    key: PlaylistKey;
    label: string;
    /** Die Zahl, die im Spiel steht: interner Wert * 20 + 100. */
    mmr: number;
    tier: number;
    tierName: string;
    division: number;
    /** null, solange es keinen Rang gibt. */
    divisionName: string | null;
    matches: number;
    /** Positiv sind Siege in Folge, negativ Niederlagen. */
    streak: number;
    /** true, solange die Platzierungsspiele noch laufen. */
    placement: boolean;
    /** Wie viele der zehn Platzierungsspiele gespielt sind. */
    placementMatches: number;
}

/** Ein Mitglied des Ingame-Clubs. */
export interface IPrimeClubMember {
    /** "Plattform|AccountID|0" - so fuehrt PsyNet einen Spieler. */
    playerId: string;
    name: string;
    /** Der Epic-Name, falls ueber eine andere Plattform gespielt wird. */
    epicName: string | null;
    owner: boolean;
    /** Die MMR nach WTSI. null, solange dazu nichts vorliegt. */
    mmr: number | null;
}

/**
 * Der Club aus dem Spiel - nicht zu verwechseln mit der Tabelle clubs, die der
 * Bot selbst fuehrt. Dieser hier kommt aus Rocket League und wird nur gelesen.
 */
export interface IPrimeClub {
    id: number;
    name: string;
    tag: string;
    ownerPlayerId: string;
    members: IPrimeClubMember[];
    /** Von Psyonix bestaetigt - das haben nur sehr wenige Clubs. */
    verified: boolean;
    /** Wann der Club gegruendet wurde - ISO-8601. */
    createdAt: string | null;
    /** Durchschnitt der WTSI-Werte aller Mitglieder. null, wenn nichts vorliegt. */
    averageMMR: number | null;
}

/** Ein Karriere-Wert, etwa Tore oder Paraden. */
export interface IPrimeStat {
    key: string;
    label: string;
    value: number;
}

export interface IPrimeProfile {
    name: string;
    platform: string;
    accountId: string;
    playerId: string;
    linked: IPrimeLinkedAccount[];
    seasonLevel: number;
    /** Siege auf dem aktuellen Reward-Level. Zehn braucht es je Stufe. */
    seasonWins: number;
    ranks: IPrimeRank[];
    stats: IPrimeStat[];
    /** Der Ingame-Club. null heisst: der Spieler ist in keinem. */
    club: IPrimeClub | null;
    /** Wann die Daten geholt wurden - ISO-8601. */
    fetchedAt: string;
    /**
     * true, wenn Prime beim letzten Versuch nicht antwortete und stattdessen der
     * gespeicherte Stand zurueckkam. Die Werte sind dann echt, aber alt - wer
     * sie anzeigt, soll das dazuschreiben.
     */
    stale?: boolean;
}

export default interface IPrimeService {
    client: BotClient;

    /** Ohne PRIME_API_TOKEN wird gar nicht erst angefragt. */
    readonly IsConfigured: boolean;

    /**
     * Ränge und Konto zu einem Epic-Namen - oder zur 32-stelligen Epic-Konto-ID,
     * die der Login zurueckgibt. Prime nimmt beides. null heißt: den Spieler
     * gibt es nicht.
     */
    Profile(name: string): Promise<IPrimeProfile | null>;

    /** Wirft die zwischengespeicherten Antworten weg. */
    Forget(name?: string): void;

    /** Schließt offene HTTP/2-Verbindungen. */
    Close(): void;
}
