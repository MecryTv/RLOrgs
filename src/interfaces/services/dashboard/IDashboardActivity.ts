// Die Übersicht eines Servers, wie /api/guild/:id/activity sie liefert. Ohne
// Discord-IDs: der Browser bekommt nur, was er zeigt. Siehe docs/Activity.md.

/** Ein Mitglied in der Liste der aktivsten. */
export interface IActivityPerson {
    // null: nicht mehr auf dem Server.
    name: string | null;
    avatar: string | null;
    // Nachrichten oder Minuten im Sprachkanal, je nach Liste.
    value: number;
}

export interface IActivityChannel {
    // null: Kanal gibt es nicht mehr.
    name: string | null;
    messages: number;
}

export interface IActivityRanks {
    // Mitglieder des Servers mit verknüpftem Epic-Konto.
    linked: number;
    // Index ist die Rangstufe, 0 Unranked bis 22 SSL - je Spieler der höchste
    // über 1v1, 2v2 und 3v3. Wer noch keinen Stand hat, fehlt hier.
    tiers: number[];
}

export default interface IDashboardActivity {
    // Stunden seit 1970, UTC. Der Browser rechnet in seine Ortszeit um.
    start: number;
    // Die erste gezählte Stunde. Davor gibt es keine Daten - das ist etwas
    // anderes als null Aktivität.
    since: number | null;
    // Je Stunde ab "start", lückenlos mit Nullen aufgefüllt.
    messages: number[];
    voice: number[];
    joins: number[];
    leaves: number[];
    channels: IActivityChannel[];
    chatters: IActivityPerson[];
    talkers: IActivityPerson[];
    // null: die Mitgliederliste ist unvollständig, eine Verteilung wäre ein Zufallsausschnitt.
    ranks: IActivityRanks | null;
}
