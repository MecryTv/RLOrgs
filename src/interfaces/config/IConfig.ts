// Steckt vollständig in der .env - siehe utils/config.ts und docs/Environment.md.
// Wer im Dashboard welche Gruppe hat, steht dagegen in der Datenbank: das vergibt
// das Admin-Dashboard unter /dashboard/admins, nicht diese Datei.
export interface IConfig {
    CLIENT_TOKEN: string;
    CLIENT_ID: string;
    CLIENT_SECRET: string;

    DEV_CLIENT_TOKEN: string;
    DEV_CLIENT_ID: string;
    DEV_CLIENT_SECRET: string;
    DEV_GUILD_ID: string;
    /** Entwickler-Befehle und der Einstieg ins Admin-Dashboard. */
    DEV_USER_IDs: string[];

    DATABASE_HOST: string;
    DATABASE_PORT: number;
    DATABASE_NAME: string;
    DATABASE_USER: string;
    DATABASE_PASSWORD: string;
    DATABASE_POOL_LIMIT: number;

    SERVER_PORT: number;
    /**
     * Die oeffentliche Adresse des Dashboards - im Betrieb
     * https://dashboard.nexus-emb.de, im "--dev" Modus ungenutzt. Aus ihr baut
     * der Bot die Redirect-URI fuer Discord und die Bild-URLs.
     */
    SERVER_PUBLIC_URL: string;
    /** Die Hauptseite (https://nexus-emb.de). Das Dashboard verlinkt zurueck. */
    SITE_PUBLIC_URL: string;
    SERVER_JWT_SECRET: string;
    SERVER_JWT_EXPIRES_IN: string;
    SERVER_RATE_LIMIT_MAX: number;
    SERVER_RATE_LIMIT_WINDOW: string;

    // Schaltet das privilegierte "Server Members Intent" ein. Nur einschalten,
    // wenn es im Developer Portal ebenfalls an ist - sonst weist Discord den
    // Login rundweg ab. Ohne das Intent kennt der Bot keine Mitgliederliste und
    // das Dashboard zeigt nur die Gesamtzahl statt Mitglieder und Bots getrennt.
    GUILD_MEMBER_INTENT: boolean;
    // Das privilegierte "Presence Intent" - nur für die Live-Rolle des Twitch
    // Notifiers. Wie oben: nur an, wenn es im Developer Portal ebenfalls an ist.
    GUILD_PRESENCE_INTENT: boolean;

    /** Token fuer prime.rocketplanet.gg - ohne ihn bleibt das Rang-Tracking aus. */
    PRIME_API_TOKEN: string;

    // Epic Account Services. Fehlt eines von beiden, bleibt der Epic-Login aus
    // und das Dashboard sagt das in den Einstellungen - alles andere laeuft weiter.
    EPIC_CLIENT_ID: string;
    EPIC_CLIENT_SECRET: string;

    // Twitch-App (dev.twitch.tv) für den Twitch Notifier. Ohne beide Werte
    // meldet er nichts, und das Dashboard sagt das.
    TWITCH_CLIENT_ID: string;
    TWITCH_CLIENT_SECRET: string;

    // Nur für YouTube-Livestreams. Videos und Shorts kommen ohne Schlüssel aus dem Kanal-Feed.
    YOUTUBE_API_KEY: string;
}
