/** Die Anzeigegruppen und die Rollen auf einem Server - Beschriftung, Symbol, Farbe. */

import { DashboardGroup } from "../interfaces/IUser.js";
import { DashboardRole } from "../interfaces/IGuild.js";

export const GROUPS: Record<DashboardGroup, { label: string; icon: string; color: string; grants: string }> = {
    administrator: {
        label: "Administrator",
        icon: "#i-shield",
        color: "var(--brand)",
        grants: "Sieht jeden Server, auf dem RL Nexus läuft.",
    },
    developer: {
        label: "Developer",
        icon: "#i-code",
        color: "var(--purple)",
        grants: "Sieht jeden Server, auf dem RL Nexus läuft, und darf Entwickler-Befehle ausführen.",
    },
    partner: {
        label: "Partner",
        icon: "#i-gem",
        color: "var(--blue)",
        grants: "Kennzeichnung für Partner-Organisationen.",
    },
    premium: {
        label: "Premium",
        icon: "#i-star",
        color: "#ffd166",
        grants: "Kennzeichnung für Premium-Zugang. Freigeschaltet ist daran heute noch nichts.",
    },
    testphase: {
        label: "Testphase",
        icon: "#i-flask",
        color: "var(--text-2)",
        grants: "Der Standard, solange RL Nexus in der Testphase läuft. Du siehst die Server, auf denen du selbst Owner oder Admin bist.",
    },
};

// Rangfolge wie in DashboardService.GroupOf() - die Übersicht in den
// Einstellungen zeigt sie genau so von oben nach unten.
export const GROUP_ORDER: DashboardGroup[] = ["administrator", "developer", "partner", "premium", "testphase"];

// Nur diese beiden sehen zusätzlich Server, die ihnen nicht gehören - dieselbe
// Grenze zieht DashboardService.IsStaff() auf der Serverseite.
export const STAFF_GROUPS: DashboardGroup[] = ["administrator", "developer"];

export const ROLE_ICONS: Record<DashboardRole, string> = {
    Owner: "#i-crown",
    Admin: "#i-shield",
    Staff: "#i-badge",
    Moderator: "#i-shield-check",
};

export const ROLE_LABELS: Record<DashboardRole, string> = {
    Owner: "Owner",
    Admin: "Admin",
    Staff: "Staff-Zugriff",
    Moderator: "Moderator",
};
