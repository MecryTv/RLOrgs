/** Rang-Abzeichen und die Farben der Stufen. */

import { BASE } from "../core/Base.js";

// Dateinamen der Rang-Abzeichen unter /assets/images/rocketleague/rlranks.
// Der Index ist die Rangstufe, die Prime liefert.
export const RANK_IMAGES = [
    "Unranked",
    "Bronze 1",
    "Bronze 2",
    "Bronze 3",
    "Silver 1",
    "Silver 2",
    "Silver 3",
    "Gold 1",
    "Gold 2",
    "Gold 3",
    "Platin 1",
    "Platin 2",
    "Platin 3",
    "Diamond 1",
    "Diamond 2",
    "Diamond 3",
    "Champion 1",
    "Champion 2",
    "Champion 3",
    "Grand Champion 1",
    "Grand Champion 2",
    "Grand Champion 3",
    "Super Sonic Legend",
];

/**
 * Das Abzeichen zu einem Rang.
 *
 * Solange die zehn Platzierungsspiele nicht durch sind, zeigt Rocket League
 * selbst kein Abzeichen - das Dashboard hält sich daran und nimmt Unranked,
 * auch wenn im Hintergrund längst eine Stufe berechnet ist.
 */
export function rankImage(tier: number, placement = false): string {
    const file = placement ? RANK_IMAGES[0] : (RANK_IMAGES[tier] ?? RANK_IMAGES[0]);

    return `${BASE}/assets/images/rocketleague/rlranks/${encodeURIComponent(file)}.png`;
}

/**
 * Dasselbe Abzeichen, nur klein: 160 statt 1381 Pixel. Für Listen und die
 * Rang-Verteilung, wo es 30 Pixel breit steht - dort zählt, dass neun Bilder
 * sofort da sind, nicht dass eines auch auf Postergröße scharf bliebe. Die
 * Originale wiegen bis zu 220 KB und entpacken sich auf über sieben Megabyte.
 *
 * Erzeugt npm run icons:ranks (src/scripts/MakeRankIcons.ts).
 */
export function rankIcon(tier: number, placement = false): string {
    const file = placement ? RANK_IMAGES[0] : (RANK_IMAGES[tier] ?? RANK_IMAGES[0]);

    return `${BASE}/assets/images/rocketleague/rlranks/small/${encodeURIComponent(file)}.png`;
}

// Farbe je Rangstufe - dieselbe Staffelung wie im Spiel.
export function tierColor(tier: number): string {
    if (tier >= 22) return "#e8ecff";
    if (tier >= 19) return "#ff4d6a";
    if (tier >= 16) return "#a35bff";
    if (tier >= 13) return "#5b8dff";
    if (tier >= 10) return "#6fd6e0";
    if (tier >= 7) return "#e8b64c";
    if (tier >= 4) return "#9fb0bd";
    if (tier >= 1) return "#c07a45";

    return "var(--text-3)";
}

/**
 * Die Farbe je Karriere-Wert. Dieselben wie CAREER_COLORS im Bot
 * (src/constants/RankCard.ts) und auf der Webseite: sechs gleiche Symbole in
 * einer Reihe verschwimmen zu einem Band, mit eigener Farbe sieht man sofort,
 * wo man hinschaut.
 */
export const STAT_COLORS: Record<string, string> = {
    shots: "#38c8ff",
    goals: "#ff4a3d",
    assists: "#b06bff",
    mvps: "#ffc53d",
    saves: "#35e07f",
    wins: "#ff8a3d",
};
