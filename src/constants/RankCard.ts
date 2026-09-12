import path from "path";

/**
 * Maße, Farben und Dateien der Rang-Karte.
 *
 * Alles, was sich beim Feintuning des Layouts ändert, steht hier und nicht
 * verstreut im Zeichencode - eine Karte richtet man nach Augenmaß aus, und dabei
 * will man an einer Stelle drehen.
 */
export const CARD_ROOT = path.join(process.cwd(), "src", "images");
export const FONT_ROOT = path.join(process.cwd(), "src", "assets", "fonts");

export const RANK_ICON_ROOT = path.join(CARD_ROOT, "default", "rocketleague", "rlranks");
export const STAT_ICON_ROOT = path.join(CARD_ROOT, "default", "rocketleague", "rlstatsicons");
export const PLATFORM_ICON_ROOT = path.join(CARD_ROOT, "default", "rocketleague", "plattforms");

/**
 * 3:2 wie die Vorlage.
 *
 * Der Hintergrund ist gezeichnet und kein Bild mehr - er richtet sich also nach
 * diesen Maßen, statt umgekehrt beschnitten werden zu müssen.
 */
export const CARD_WIDTH = 1536;
export const CARD_HEIGHT = 1024;

export const COLORS = {
    base: "#050608",
    panel: "#080d12",
    red: "#ff1e2d",
    redBright: "#ff3344",
    blue: "#00afff",
    rankBlue: "#168cff",
    purple: "#8a4dff",
    text: "#f2f4f7",
    textDim: "#a8b0bc",
    win: "#35e07f",
    loss: "#ff4d5e",
} as const;

/** Ein Rahmen, an dem sich alle Blöcke ausrichten. */
export const PAD = 34;
export const GAP = 22;

/**
 * Die Dateinamen der Rang-Abzeichen, Index ist die Rangstufe von Prime.
 * Dieselbe Liste wie im Dashboard - die Bilder liegen nur woanders.
 */
export const RANK_ICONS = [
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
] as const;

/**
 * Solange die Platzierungsspiele laufen, zeigt Rocket League selbst kein
 * Abzeichen. Die Karte hält sich daran.
 */
export function RankIconFile(tier: number, placement = false): string {
    const name = placement ? RANK_ICONS[0] : (RANK_ICONS[tier] ?? RANK_ICONS[0]);

    return path.join(RANK_ICON_ROOT, `${name}.png`);
}

/**
 * Der Rang, den eine Season-Reward-Stufe darstellt.
 *
 * Je Stufe gehören drei Ränge zusammen, und gemeint ist die **höchste**: der
 * Reward "Diamant" ist Diamant III, nicht Diamant I. Level 8 (Supersonic
 * Legend) hat nur einen Rang - deshalb die Deckelung, sonst zeigte die Rechnung
 * über das Ende der Liste hinaus.
 */
export function RewardTier(level: number): number {
    return level > 0 ? Math.min(level * 3, RANK_ICONS.length - 1) : 0;
}

/** Das Abzeichen zur Season-Reward-Stufe. */
export function RewardIconFile(level: number): string {
    return RankIconFile(RewardTier(level));
}

/** Die Farbe einer Rangstufe - dieselbe Staffelung wie im Spiel. */
export function TierColor(tier: number): string {
    if (tier >= 22) return "#e8ecff";
    if (tier >= 19) return "#ff4d6a";
    if (tier >= 16) return COLORS.purple;
    if (tier >= 13) return "#5b8dff";
    if (tier >= 10) return "#6fd6e0";
    if (tier >= 7) return "#e8b64c";
    if (tier >= 4) return "#9fb0bd";
    if (tier >= 1) return "#c07a45";

    return COLORS.textDim;
}

/** Die Untertitel der drei Playlists, so wie sie in der Vorlage stehen. */
export const PLAYLIST_SUBTITLES: Record<string, string> = {
    "1v1": "DUELL",
    "2v2": "DOPPEL",
    "3v3": "TEAM",
};

/**
 * Die sechs Karriere-Werte in der Reihenfolge der Vorlage. key ist zugleich der
 * Dateiname des Symbols und der Schlüssel, unter dem Prime den Wert liefert.
 */
export const CAREER_ORDER = ["shots", "goals", "assists", "mvps", "saves", "wins"] as const;

/**
 * Eine Farbe je Karriere-Wert.
 *
 * Die Symbole liegen als schwarze PNGs vor und werden eingefärbt. Alle in Weiß
 * ist die einfachste Lösung und die schlechteste: sechs gleiche Formen in einer
 * Reihe verschwimmen zu einem Band. Mit eigener Farbe je Wert ist auf einen
 * Blick zu sehen, wo man hinschaut - und die Farben sind nicht beliebig, sie
 * folgen der Bedeutung: Torschüsse kühl, Tore heiß, Paraden grün wie im Spiel.
 */
export const CAREER_COLORS: Record<string, string> = {
    shots: "#38c8ff",
    goals: "#ff4a3d",
    assists: "#b06bff",
    mvps: "#ffc53d",
    saves: "#35e07f",
    wins: "#ff8a3d",
};

export const CAREER_LABELS: Record<string, string> = {
    shots: "SHOTS",
    goals: "GOALS",
    assists: "ASSISTS",
    mvps: "MVPS",
    saves: "SAVES",
    wins: "WINS",
};
