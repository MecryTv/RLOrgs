// Anzeigegruppen des Dashboards, von oben nach unten - die erste Liste, in der
// eine ID steht, gewinnt. "administrator" und "developer" sehen zusätzlich jeden
// Server, auf dem der Bot sitzt (siehe DashboardService.IsStaff).
// "guardian" wird wie "developer" und "testphase" nicht gespeichert: wer keine
// andere Gruppe hat, aber irgendwo Moderator ist, ist Guardian (DashboardService.Payload).
export const DASHBOARD_GROUPS = ["administrator", "developer", "partner", "premium", "guardian", "testphase"] as const;

export type DashboardGroup = (typeof DASHBOARD_GROUPS)[number];

export default interface IDashboardUser {
    id: string;
    name: string;
    // Der @-Name und die Adresse. Beide leer, solange die Sitzung aus der Zeit
    // vor dem "email"-Scope stammt - das Dashboard sagt das dann auch so.
    handle: string;
    email: string | null;
    avatar: string | null;
    group: DashboardGroup;
}
