import path from "path";
import { IConfig } from "../interfaces/config/IConfig";

const ENV_FILE = ".env";

// Erst beim Aufruf auflösen, nicht beim Import - sonst friert das Arbeitsverzeichnis
// beim Laden des Moduls ein und Aufrufer, die es später wechseln, lesen die falsche Datei.
function Resolve(file: string): string {
    return path.join(process.cwd(), file);
}

// Echte Umgebungsvariablen gewinnen gegen die .env - loadEnvFile überschreibt nichts,
// was schon gesetzt ist. Damit funktioniert derselbe Code lokal wie in Docker oder systemd.
function LoadEnvFile(): void {
    try {
        process.loadEnvFile(Resolve(ENV_FILE));
    } catch {
        // Ohne .env ist der Start weiterhin möglich, solange die Variablen anders gesetzt sind.
    }
}

function Raw(name: string): string {
    return process.env[name]?.trim() ?? "";
}

/** Pflichtfeld: fehlt es, startet der Bot nicht und nennt den Namen. */
function Need(name: string): string {
    const value = Raw(name);

    if (!value) throw new Error(`${name} fehlt in der .env - siehe .env.example.`);

    return value;
}

/** Darf fehlen. Was dann nicht geht, meldet die jeweilige Stelle selbst. */
function Text(name: string, fallback = ""): string {
    return Raw(name) || fallback;
}

function Num(name: string, fallback: number): number {
    const value = Number(Raw(name));

    return Number.isFinite(value) && Raw(name) !== "" ? value : fallback;
}

// "true" und "1" sind an, alles andere ist aus. Ein Tippfehler schaltet damit ab
// und nicht versehentlich ein - wichtig bei GUILD_MEMBER_INTENT, wo ein falsch
// angefordertes Intent den Login scheitern lässt.
function Bool(name: string, fallback: boolean): boolean {
    const value = Raw(name).toLowerCase();

    if (!value) return fallback;

    return value === "true" || value === "1";
}

// Mehrere IDs stehen kommagetrennt in einer Zeile: DEV_USER_IDs="123,456".
function Ids(name: string): string[] {
    return Raw(name)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
}

/**
 * Die gesamte Konfiguration steckt in der .env - es gibt keine config.json mehr.
 * Wer im Dashboard welche Gruppe hat, steht in der Datenbank und nicht hier:
 * siehe docs/Database.md und das Admin-Dashboard unter /dashboard/admins.
 */
export default function LoadConfig(): IConfig {
    LoadEnvFile();

    return {
        CLIENT_TOKEN: Need("CLIENT_TOKEN"),
        CLIENT_ID: Need("CLIENT_ID"),
        CLIENT_SECRET: Text("CLIENT_SECRET"),

        DEV_CLIENT_TOKEN: Need("DEV_CLIENT_TOKEN"),
        DEV_CLIENT_ID: Need("DEV_CLIENT_ID"),
        DEV_CLIENT_SECRET: Text("DEV_CLIENT_SECRET"),
        DEV_GUILD_ID: Need("DEV_GUILD_ID"),

        // Die einzige Liste, die noch in der Konfiguration steht: sie schaltet die
        // Entwickler-Befehle frei und ist der Einstieg ins Admin-Dashboard, über
        // das alle weiteren Gruppen vergeben werden. Käme auch sie aus der
        // Datenbank, könnte sich niemand die erste Berechtigung geben.
        DEV_USER_IDs: Ids("DEV_USER_IDs"),

        // Ohne Host, Name oder Nutzer läuft der Bot ohne Datenbank weiter.
        DATABASE_HOST: Text("DATABASE_HOST"),
        DATABASE_PORT: Num("DATABASE_PORT", 3306),
        DATABASE_NAME: Text("DATABASE_NAME"),
        DATABASE_USER: Text("DATABASE_USER"),
        DATABASE_PASSWORD: Text("DATABASE_PASSWORD"),
        DATABASE_POOL_LIMIT: Num("DATABASE_POOL_LIMIT", 5),

        SERVER_PORT: Num("SERVER_PORT", 3000),
        // Die eigene Domain des Dashboards. Im "--dev" Modus haengt es unter
        // http://localhost:<Port>/dashboard, im Betrieb an der Wurzel dieser
        // Adresse - siehe constants/Dashboard.ts und docs/Dashboard.md.
        SERVER_PUBLIC_URL: Text("SERVER_PUBLIC_URL", "http://localhost:3000"),
        // Die Hauptseite. Das Dashboard verlinkt in der Fusszeile dorthin.
        SITE_PUBLIC_URL: Text("SITE_PUBLIC_URL", "https://nexus-emb.de"),
        SERVER_JWT_SECRET: Need("SERVER_JWT_SECRET"),
        SERVER_JWT_EXPIRES_IN: Text("SERVER_JWT_EXPIRES_IN", "30d"),
        SERVER_RATE_LIMIT_MAX: Num("SERVER_RATE_LIMIT_MAX", 100),
        SERVER_RATE_LIMIT_WINDOW: Text("SERVER_RATE_LIMIT_WINDOW", "1 minute"),

        // Privilegiert: nur einschalten, wenn es im Developer Portal ebenfalls an
        // ist - sonst weist Discord den Login rundweg ab.
        GUILD_MEMBER_INTENT: Bool("GUILD_MEMBER_INTENT", false),
        // Ebenfalls privilegiert - nur für die Live-Rolle des Twitch Notifiers.
        GUILD_PRESENCE_INTENT: Bool("GUILD_PRESENCE_INTENT", false),

        // Rang-Tracking ueber prime.rocketplanet.gg. Fehlt der Token, bleibt das
        // Tracking im Dashboard aus - alles andere laeuft weiter.
        PRIME_API_TOKEN: Text("PRIME_API_TOKEN"),

        // Epic-Login fuer die Konto-Verknuepfung. Ohne die beiden Werte bleibt
        // der Knopf in den Einstellungen aus - siehe docs/Environment.md.
        EPIC_CLIENT_ID: Text("EPIC_CLIENT_ID"),
        EPIC_CLIENT_SECRET: Text("EPIC_CLIENT_SECRET"),

        // Twitch Notifier und YouTube-Livestreams - siehe docs/Notifiers.md.
        TWITCH_CLIENT_ID: Text("TWITCH_CLIENT_ID"),
        TWITCH_CLIENT_SECRET: Text("TWITCH_CLIENT_SECRET"),
        YOUTUBE_API_KEY: Text("YOUTUBE_API_KEY"),
    };
}
