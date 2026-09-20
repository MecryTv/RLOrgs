import path from "path";

export const MIGRATIONS_ROOT = path.join(process.cwd(), "src", "database", "migrations");

// Führt Buch darüber, welche Datei schon gelaufen ist. Legt der Migrationslauf
// selbst an, bevor er das erste Mal nachsieht.
export const MIGRATIONS_TABLE = "schema_migrations";

export const TABLES = {
    groups: "dashboard_groups",
    notifications: "notifications",
    ranks: "player_ranks",
    profiles: "player_profiles",
    clubs: "clubs",
    clubMembers: "club_members",
    settings: "guild_settings",
    teams: "teams",
    members: "team_members",
    accounts: "player_accounts",
    matches: "matches",
    activity: "guild_activity",
    channelActivity: "channel_activity",
    memberActivity: "member_activity",
    ticketSettings: "ticket_settings",
    tickets: "tickets",
    ticketBlacklist: "ticket_blacklist",
    ticketTranscripts: "ticket_transcripts",
    userCodes: "user_codes",
    modSettings: "mod_settings",
    modCases: "mod_cases",
    moduleSettings: "module_settings",
    streamNotifiers: "stream_notifiers",
    polls: "polls",
    pollVotes: "poll_votes",
    giveaways: "giveaways",
    giveawayEntries: "giveaway_entries",
    userConnections: "user_connections",
    voiceHubs: "voice_hubs",
    tempVoices: "temp_voices",
    voicePresets: "voice_presets",
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

// Der Cache ist eine Abkürzung, kein Speicher: er darf jederzeit leer sein, und
// nichts darf davon abhängen, dass ein Eintrag noch da ist.
export const CACHE_MAX = 5000;
export const CACHE_TTL = 60 * 1000;

// Wie lange ein Verbindungsversuch dauern darf, bevor der Bot ohne Datenbank
// weiterläuft. Ohne Grenze hinge der Start an einem falsch gesetzten Host.
export const CONNECT_TIMEOUT = 8000;

// Discord-IDs stehen als VARCHAR(20) in der Datenbank, nicht als BIGINT: sie
// werden nie gerechnet, aber ständig in JSON gereicht - und dort verliert eine
// 64-Bit-Zahl in JavaScript die letzten Stellen.
export const ID_LENGTH = 20;

// Spielmodi, die der Bot kennt. Passt zu den Playlists in Rocket League.
export const PLAYLISTS = ["1v1", "2v2", "3v3"] as const;

export type Playlist = (typeof PLAYLISTS)[number];

// Plattformen für verknüpfte Spielerkonten - dieselben, die das Dashboard unter
// "Konten verknüpfen" anbietet.
export const PLATFORMS = ["epic", "steam", "xbox", "psn", "switch"] as const;

export type Platform = (typeof PLATFORMS)[number];

/**
 * Wie lange eine Konto-Verknüpfung stehen bleiben muss, bevor sie gewechselt
 * werden darf.
 *
 * Die Zahl steht hier und nur hier - jeder Text, der sie nennt, holt sie sich
 * von hier. Sonst steht sie nach der nächsten Änderung an sechs Stellen
 * verschieden im Code.
 *
 * Im Entwicklungsmodus zehn Sekunden, damit sich das überhaupt testen lässt.
 */
export const LINK_COOLDOWN_DAYS = 3;
export const LINK_COOLDOWN = LINK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
export const LINK_COOLDOWN_DEV = 10 * 1000;

export const TEAM_ROLES = ["captain", "player", "substitute", "coach"] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

export const MATCH_STATES = ["scheduled", "live", "finished", "cancelled"] as const;

export type MatchState = (typeof MATCH_STATES)[number];

// Ein fehlender Wert soll nicht als leerer Text in der Datenbank landen.
export function OrNull(value: string | null | undefined): string | null {
    const text = value?.trim();

    return text ? text : null;
}

// MariaDB gibt JSON-Spalten je nach Version als Text oder schon ausgepackt
// zurück. Beides wird hier auf dieselbe Form gebracht.
export function Unpack<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined) return fallback;
    if (typeof value !== "string") return value as T;

    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}
