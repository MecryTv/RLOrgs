/** Die Übersicht eines Servers, wie /api/guild/:id/activity sie liefert. Spiegelt IDashboardActivity. */

export interface IActivityPerson {
    /** null: nicht mehr auf dem Server. */
    name: string | null;
    avatar: string | null;
    /** Nachrichten oder Minuten im Sprachkanal, je nach Liste. */
    value: number;
}

export interface IActivityChannel {
    /** null: Kanal gibt es nicht mehr. */
    name: string | null;
    messages: number;
}

export interface IActivityRanks {
    /** Mitglieder des Servers mit verknüpftem Epic-Konto. */
    linked: number;
    /** Index ist die Rangstufe, 0 Unranked bis 22 SSL - je Spieler der höchste. */
    tiers: number[];
}

export interface IActivity {
    /** Stunden seit 1970, UTC. In Ortszeit rechnet dieser Browser. */
    start: number;
    /** Die erste gezählte Stunde. Davor gibt es keine Daten - nicht null Aktivität. */
    since: number | null;
    messages: number[];
    voice: number[];
    joins: number[];
    leaves: number[];
    channels: IActivityChannel[];
    chatters: IActivityPerson[];
    talkers: IActivityPerson[];
    /** null: unvollständige Mitgliederliste, eine Verteilung wäre ein Zufallsausschnitt. */
    ranks: IActivityRanks | null;
}
