// Moderator: weder Owner noch Admin, aber auf der Moderatoren-Liste des Servers
// (selbst oder per Rolle) oder mit einer Support-Rolle - sieht nur Live Tickets,
// Transcriptions und, von der Liste, die Moderation (docs/Tickets.md, docs/Moderation.md).
export type DashboardRole = "Owner" | "Admin" | "Staff" | "Moderator";

// Eine Karte im Dashboard. "teams" ist ein Platzhalter, solange der Bot keine
// Teams führt. "modules" sind die eingeschalteten Module aus
// guild_settings.modules - siehe docs/Dashboard.md.
export default interface IDashboardGuild {
    id: string;
    name: string;
    tag: string;
    icon: string | null;
    // Gesamtzahl inklusive Bots. "bots" ist null, solange der Bot die
    // Mitgliederliste nicht kennt (Members-Intent aus) - dann zeigt das
    // Dashboard nur die Gesamtzahl, statt eine Aufteilung zu erfinden.
    members: number;
    bots: number | null;
    active: boolean;
    role: DashboardRole;
    canManage: boolean;
    // Darf Live Tickets und Transcriptions nutzen: wer verwaltet, Moderatoren und die Support-Rollen.
    canSupport: boolean;
    // Darf die Moderation nutzen: wer verwaltet und wer auf der Moderatoren-Liste steht (Modul an).
    canModerate: boolean;
    created: string;
    // Seit wann RL Nexus auf dem Server ist (ISO) - null, wenn der Bot fehlt.
    joined: string | null;
    teams: number;
    modules: string[];
    c1: string;
    c2: string;
}
