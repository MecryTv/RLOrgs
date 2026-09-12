/**
 * WTSI — Weighted True Skill Index.
 *
 * Ein Modell, das die Spielstärke aus 2v2 und 3v3 zusammenführt, ohne dass
 * jemand eine Gewichtung festlegen muss: sie ergibt sich aus den Zahlen des
 * Spielers selbst.
 *
 *   Rel_2s = Peak_2s / (Peak_2s + Peak_3s)          Gewicht je Modus
 *   K_2s   = √(Current_2s / Peak_2s)                Konsistenz, gedämpft
 *   TS_2s  = Peak_2s * K_2s                         bereinigter Wert
 *   WTSI   = TS_2s * Rel_2s + TS_3s * Rel_3s
 *
 * Der Peak verankert das Ergebnis an der besten je erreichten Leistung: wer
 * kurz vor einem Turnier absichtlich Rang abgibt, drückt seinen Wert damit
 * nicht. Die Wurzel dämpft dabei eine normale Pechsträhne - 80 % vom Peak
 * kosten nicht 20 %, sondern nur 10,6 %.
 *
 * Die Team-MMR ist der schlichte Durchschnitt der WTSI-Werte: die Ausreißer
 * sind auf Spielerebene bereits herausgerechnet.
 */

/** Was die Rechnung je Spieler braucht. Alles in angezeigter MMR. */
export interface IWTSIInput {
    current2s: number;
    peak2s: number;
    current3s: number;
    peak3s: number;
}

/**
 * Ein Modus für sich: Peak mal gedämpfte Konsistenz.
 *
 * Ohne Peak gibt es nichts zu rechnen. Liegt die aktuelle MMR über dem Peak,
 * ist der Peak schlicht noch nicht nachgezogen - dann gilt sie als der Peak,
 * statt einen Faktor über 1 entstehen zu lassen.
 */
function TrueSkill(current: number, peak: number): number {
    if (peak <= 0) return 0;

    const ratio = Math.min(Math.max(current, 0) / peak, 1);

    return peak * Math.sqrt(ratio);
}

/**
 * Der WTSI-Wert eines Spielers.
 *
 * Fehlt eine der beiden Playlists ganz (Peak 0), fällt sie aus der Gewichtung
 * und die andere trägt allein - sonst käme durch die Division durch null ein
 * NaN heraus, das sich stillschweigend durch jede Durchschnittsrechnung zieht.
 */
export function WTSI(player: IWTSIInput): number {
    const peak2s = Math.max(player.peak2s, 0);
    const peak3s = Math.max(player.peak3s, 0);
    const total = peak2s + peak3s;

    if (total <= 0) return 0;

    const ts2s = TrueSkill(player.current2s, peak2s);
    const ts3s = TrueSkill(player.current3s, peak3s);

    return ts2s * (peak2s / total) + ts3s * (peak3s / total);
}

/**
 * Die Team- beziehungsweise Club-MMR: der Durchschnitt der WTSI-Werte.
 *
 * Spieler ohne verwertbare Daten (WTSI 0) zählen nicht mit - sie würden den
 * Schnitt sonst nach unten ziehen, obwohl über sie schlicht nichts bekannt ist.
 * Gibt null zurück, wenn niemand verwertbare Daten hat.
 */
export function TeamMMR(players: IWTSIInput[]): number | null {
    const values = players.map(WTSI).filter((value) => value > 0);

    if (values.length === 0) return null;

    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
