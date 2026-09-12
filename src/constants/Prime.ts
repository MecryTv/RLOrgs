/**
 * Prime (prime.rocketplanet.gg) - die Rocket-League-Daten hinter dem Tracking.
 *
 * Token gibt es unter https://prime.rocketplanet.gg/access, er gehört als
 * PRIME_API_TOKEN in die .env.
 */
export const PRIME_BASE_URL = "https://prime.rocketplanet.gg";

// Prime spricht die HTTP-Methode QUERY, und die geht ausschließlich über HTTP/2.
// Über HTTP/1.1 antwortet der Dienst mit 400 - siehe PrimeService.
export const PRIME_TIMEOUT = 10_000;

/**
 * Das oeffentliche Profil bei rocketleague.tracker.network.
 *
 * Steht als Knopf unter jeder Rang-Karte: die Karte zeigt den Stand, der Tracker
 * die Historie. Der Name gehoert kodiert in die Adresse - Epic-Namen duerfen
 * Leerzeichen und Sonderzeichen enthalten.
 */
export function TrackerURL(epicName: string): string {
    return `https://rocketleague.tracker.network/rocket-league/profile/epic/${encodeURIComponent(epicName)}/overview`;
}

// Ränge ändern sich nur nach Spielen. Zehn Minuten halten die Oberfläche flott
// und den fremden Dienst aus dem Dauerfeuer - derselbe Takt, in dem der
// gespeicherte Stand in player_ranks erneuert wird.
export const RANK_MAX_AGE = 10 * 60 * 1000;
export const PRIME_CACHE_TTL = RANK_MAX_AGE;

/**
 * Wie lange ein Eintrag ueberhaupt aufgehoben wird - deutlich laenger als seine
 * Frische.
 *
 * Nach PRIME_CACHE_TTL gilt er als alt und wird beim naechsten Aufruf neu
 * geholt. Erst wenn das nicht klappt, weil Prime gerade nicht antwortet, kommt
 * er noch einmal zum Einsatz: ein Stand von vorhin ist brauchbarer als eine
 * Fehlermeldung, solange dabeisteht, dass er von vorhin ist.
 */
export const PRIME_CACHE_KEEP = 24 * 60 * 60 * 1000;
export const PRIME_CACHE_MAX = 500;

/**
 * Die drei Ranked-Playlists, die das Dashboard zeigt. Die Zahlen sind die
 * Playlist-IDs von Rocket League und stehen so in der Antwort von Prime.
 */
export const TRACKED_PLAYLISTS = [
    { id: 10, key: "1v1", label: "1v1 Duell" },
    { id: 11, key: "2v2", label: "2v2 Doppel" },
    { id: 13, key: "3v3", label: "3v3 Standard" },
] as const;

export type PlaylistKey = (typeof TRACKED_PLAYLISTS)[number]["key"];

/** Playlist-Schlüssel zu ID, für die Datenbank. */
export const PLAYLIST_IDS: Record<string, number> = Object.fromEntries(
    TRACKED_PLAYLISTS.map((entry) => [entry.key, entry.id])
);

// So viele Platzierungsspiele braucht es, bis ein Rang steht. Vorher zeigt das
// Spiel selbst "Unranked" - das Dashboard hält sich daran.
export const PLACEMENT_MATCHES = 10;

/**
 * Die Season-Reward-Stufen. Stufe 0 heißt: noch nichts freigespielt. Je Stufe
 * braucht es zehn Siege, danach geht es eine weiter.
 */
export const REWARD_LEVELS = [
    "Kein Reward",
    "Bronze",
    "Silber",
    "Gold",
    "Platin",
    "Diamant",
    "Champion",
    "Grand Champion",
    "Supersonic Legend",
] as const;

export const REWARD_WINS_PER_LEVEL = 10;

export function RewardName(level: number): string {
    return REWARD_LEVELS[level] ?? REWARD_LEVELS[0];
}

// Rang 0 bis 22, in der Reihenfolge, in der Rocket League sie führt.
export const TIERS = [
    "Unranked",
    "Bronze I",
    "Bronze II",
    "Bronze III",
    "Silber I",
    "Silber II",
    "Silber III",
    "Gold I",
    "Gold II",
    "Gold III",
    "Platin I",
    "Platin II",
    "Platin III",
    "Diamant I",
    "Diamant II",
    "Diamant III",
    "Champion I",
    "Champion II",
    "Champion III",
    "Grand Champion I",
    "Grand Champion II",
    "Grand Champion III",
    "Supersonic Legend",
] as const;

// Division 0 bis 3 - im Spiel heißen sie I bis IV.
export const DIVISIONS = ["I", "II", "III", "IV"] as const;

/**
 * Prime liefert den internen Skill-Wert. Die Zahl, die im Spiel steht, ist
 *
 *     MMR * 20 + 100
 *
 * Beispiel: 62.4867 → 1350.
 */
export function ToMMR(value: number): number {
    return Math.round(value * 20 + 100);
}

export function TierName(tier: number): string {
    return TIERS[tier] ?? TIERS[0];
}

export function DivisionName(division: number): string | null {
    // Ohne Rang gibt es auch keine Division.
    return DIVISIONS[division] ?? null;
}

/**
 * Die sechs Karriere-Werte, für die es Symbole gibt. Der Schlüssel ist die
 * LeaderboardID von Prime, der Wert der Dateiname unter rlstatsicons.
 */
export const CAREER_STATS = [
    { id: "Wins", key: "wins", label: "Siege" },
    { id: "Goals", key: "goals", label: "Tore" },
    { id: "Assists", key: "assists", label: "Vorlagen" },
    { id: "Saves", key: "saves", label: "Paraden" },
    { id: "Shots", key: "shots", label: "Schüsse" },
    { id: "MVPs", key: "mvps", label: "MVP" },
] as const;

/**
 * PsyNet erwartet PlayerIDs als "Plattform|AccountID|0". Der Resolver liefert
 * die Plattform als Klartextnamen - das hier ist die Übersetzung.
 */
export const PLATFORM_PREFIX: Record<string, string> = {
    "Epic Games": "Epic",
    Nintendo: "Switch",
    PlayStation: "PS4",
    Steam: "Steam",
    Xbox: "XboxOne",
};

export function ToPlayerID(provider: string, accountId: string): string | null {
    const prefix = PLATFORM_PREFIX[provider];

    return prefix ? `${prefix}|${accountId}|0` : null;
}

/**
 * Rueckwaerts zu PLATFORM_PREFIX: der Klartextname, den Prime als
 * IdentityProvider liefert, auf die Kennung in der Datenbank.
 *
 * Prime nennt sie ausgeschrieben ("PlayStation"), die Tabelle player_accounts
 * fuehrt sie kurz ("psn") - dazwischen steht diese Zuordnung. Eine Plattform,
 * die hier fehlt, wird uebergangen statt geraten.
 */
export const PROVIDER_PLATFORM: Record<string, string> = {
    "Epic Games": "epic",
    Steam: "steam",
    Xbox: "xbox",
    PlayStation: "psn",
    Nintendo: "switch",
};

/** Und wieder zurueck - fuer Beschriftungen im Dashboard. */
export const PLATFORM_PROVIDER: Record<string, string> = Object.fromEntries(
    Object.entries(PROVIDER_PLATFORM).map(([provider, platform]) => [platform, provider])
);

export function ToPlatform(provider: string): string | null {
    return PROVIDER_PLATFORM[provider] ?? null;
}
