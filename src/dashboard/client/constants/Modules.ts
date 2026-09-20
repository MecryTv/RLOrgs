/**
 * Die Module der Server-Einstellungen: Name, Beschreibung, Symbol. In dieser
 * Reihenfolge stehen sie unter "Module" und in der Seitenleiste.
 *
 * Kategorien gibt es nicht. Was zusammengehört, hängt am Modul selbst: "parts"
 * sind Teile eines Moduls, die mit ihm kommen. Sie haben keinen eigenen
 * Schalter und stehen erst in der Leiste, wenn ihr Modul eingeschaltet ist -
 * Live Tickets und Transcriptions gehören zum Ticket System, nicht daneben.
 *
 * Programmiert ist noch keins. Bis dahin zeigt jedes nur, dass es kommt.
 */

export interface IModulePart {
    /**
     * Abschnitt in der Adresse (/guild/<id>/tickets) und ID der Karte. Beginnt
     * mit einem Buchstaben: die Karte wird per querySelector gesucht, und
     * "#6mans" wäre kein gültiger Selektor.
     */
    id: string;
    name: string;
    /** Ein Satz, worum es geht. Steht unter dem Namen, auf der Kachel und auf der Karte. */
    description: string;
    /** Symbol aus dem Sprite in guild.html. */
    icon: string;
}

/**
 * Die Ueberschriften der Leiste, in dieser Reihenfolge. Jedes Modul traegt die
 * id einer davon in seinem Feld `category`. Eine Ueberschrift steht erst in der
 * Leiste, wenn mindestens ein Modul darunter eingeschaltet ist.
 *
 * In der Modul-Uebersicht gibt es sie nicht: dort bleiben die Kacheln flach.
 */
export interface IModuleCategory {
    id: string;
    name: string;
}

export const CATEGORIES: IModuleCategory[] = [
    { id: "rocket-league", name: "Rocket League" },
    { id: "community", name: "Community" },
    { id: "support", name: "Support" },
    { id: "moderation", name: "Moderation" },
    { id: "content", name: "Inhalte & Meldungen" },
];

export interface IModule extends IModulePart {
    /** Unter welcher Ueberschrift das Modul in der Leiste steht. */
    category: string;

    /**
     * Ein festes Modul: immer an, der Schalter steht sichtbar, aber gesperrt.
     * Der Bot fuehrt dieselbe Menge in constants/Modules.ts (PERMANENT_MODULES)
     * und weist ein Ausschalten ab.
     */
    always?: true;

    /**
     * Teile, die mit dem Modul kommen: eigene Karte und eigener Eintrag in der
     * Leiste, aber kein eigener Schalter. In guild_settings.modules steht nur
     * das Modul selbst - die IDs der Teile nie.
     */
    parts?: IModulePart[];
}

/**
 * Nur die IDs der Module stehen in guild_settings.modules, und nur sie nimmt der
 * Bot an: dieselbe Liste führt src/constants/Modules.ts, npm run check:dashboard
 * prüft beide gegeneinander. Gibt es das Modul auf der Webseite schon (RL Nexus
 * Website, src/data/modules.data.ts), ist es dieselbe ID wie dort.
 */
export const MODULES: IModule[] = [
    {
        id: "rl-6mans",
        name: "RL 6Mans",
        description: "Warteschlange für 3v3-Pickup-Games: sechs Spieler, ausgeglichene Teams, Ergebnisse mit Rangliste.",
        icon: "#i-gamepad",
        category: "rocket-league",
    },
    {
        id: "lft",
        name: "Looking for",
        description: "Spieler suchen Teams, Teams suchen Spieler – mit Rang, Plattform und Zeiten.",
        icon: "#i-user-search",
        category: "rocket-league",
    },
    {
        id: "teams",
        name: "RL Team-Übersicht",
        description: "Kader mit Stamm, Ersatz, Captain und Coach – jedes Team mit eigener Rolle und eigenem Kanal.",
        icon: "#i-shield-users",
        category: "rocket-league",
    },
    {
        id: "clips",
        name: "Clips der Woche",
        description: "Mitglieder reichen ihre besten Szenen ein, jede Woche wird der beste Clip gekürt.",
        icon: "#i-play",
        category: "rocket-league",
    },
    {
        id: "matchups",
        name: "Matchups",
        description: "Kündigt anstehende Partien an: Team gegen Team, Zeit und Modus, mit Erinnerung vor dem Anpfiff.",
        icon: "#i-swords",
        category: "rocket-league",
    },
    {
        id: "moderation",
        name: "Moderation",
        description: "Verwarnen, stummschalten, kicken und bannen – mit Begründung und Verlauf je Mitglied.",
        icon: "#i-gavel",
        category: "moderation",
    },
    {
        id: "automod",
        name: "Auto Mod",
        description: "Filtert Spam, Einladungslinks und Wortlisten, bevor ein Moderator online ist.",
        icon: "#i-shield-check",
        category: "moderation",
    },
    {
        id: "logging",
        name: "Logging System",
        description: "Protokolliert Nachrichten, Rollen, Beitritte und Moderation in eigenen Kanälen.",
        icon: "#i-scroll",
        category: "moderation",
    },
    {
        id: "welcome",
        name: "Welcome System",
        description: "Begrüßt neue Mitglieder mit Grafik, Startrolle und dem Weg zu den wichtigen Kanälen.",
        icon: "#i-wave",
        category: "community",
    },
    {
        id: "apply",
        name: "Apply System",
        description: "Bewerbungen per Formular, jede in einem eigenen Kanal fürs Team – mit Zu- und Absage.",
        icon: "#i-clipboard",
        category: "community",
    },
    {
        id: "reaction-roles",
        name: "Self Roles",
        description: "Mitglieder holen sich Rollen selbst, per Schaltfläche oder Auswahlmenü.",
        icon: "#i-sparkle",
        category: "community",
    },
    {
        id: "levels",
        name: "Level System",
        description: "Punkte für Nachrichten und Zeit im Sprachkanal, mit Rangliste und Belohnungsrollen.",
        icon: "#i-chart-up",
        category: "community",
        parts: [
            {
                id: "leaderboard",
                name: "Rangliste",
                description: "Wer wie viele Punkte hat – auf Wunsch auch öffentlich ohne Anmeldung.",
                icon: "#i-crown",
            },
        ],
    },
    {
        id: "giveaways",
        name: "Giveaways",
        description: "Verlosungen mit Laufzeit, mehreren Gewinnern und Teilnahmebedingungen.",
        icon: "#i-gift",
        category: "community",
    },
    {
        id: "polls",
        name: "Umfragen",
        description: "Abstimmungen direkt im Kanal, mit Laufzeit und Ergebnis auf einen Blick.",
        icon: "#i-list-checks",
        category: "community",
    },
    {
        id: "voice-hub",
        name: "Temp Voice",
        description: "Ein eigener Sprachkanal auf Zuruf, der wieder verschwindet, sobald er leer ist.",
        icon: "#i-mic",
        category: "community",
    },
    {
        id: "tickets",
        name: "Ticket System",
        description: "Support per Schaltfläche: jedes Ticket bekommt einen Kanal nur für Ersteller und Team.",
        icon: "#i-ticket",
        category: "support",
        parts: [
            {
                id: "live-tickets",
                name: "Live Tickets",
                description: "Ticket-Chats live mitlesen und direkt mitschreiben.",
                icon: "#i-message",
            },
            {
                id: "transcriptions",
                name: "Transcriptions",
                description: "Speichert den Verlauf geschlossener Tickets als Protokoll zum Nachlesen.",
                icon: "#i-archive",
            },
        ],
    },
    {
        id: "twitch-notifier",
        name: "Twitch Notifier",
        description: "Meldet, wenn jemand aus deiner Organisation auf Twitch live geht.",
        icon: "#i-twitch",
        category: "content",
    },
    {
        id: "youtube-notifier",
        name: "YouTube Notifier",
        description: "Meldet neue Videos und Livestreams der YouTube-Kanäle deiner Organisation.",
        icon: "#i-youtube",
        category: "content",
    },
    {
        id: "custom-message",
        name: "Custom Message",
        description: "Eigene Nachrichten mit Embeds und Components V2 gestalten und senden.",
        icon: "#i-layout",
        category: "content",
    },
    {
        id: "gallery",
        name: "Gallery System",
        description: "Logos, Grafiken und Vorlagen in Alben sortieren, durchblättern und finden.",
        icon: "#i-image",
        category: "content",
        always: true,
    },
];

/**
 * Die schaltbaren IDs auf einen Blick. Teile eines Moduls stehen nicht darin -
 * sie gehen mit ihrem Modul an. Was hier fehlt, zählt als aus, auch wenn es noch
 * in guild_settings.modules steht: ein entferntes oder umbenanntes Modul.
 */
export const KNOWN_MODULES = new Set(MODULES.map((entry) => entry.id));
