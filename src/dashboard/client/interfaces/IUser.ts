/** Der angemeldete Nutzer und die Antwort von /api/me. */

import { IGuild } from "./IGuild.js";

// Spiegelt IDashboardUser aus dem Backend.
export type DashboardGroup = "administrator" | "developer" | "partner" | "premium" | "guardian" | "testphase";

export interface IUser {
    id: string;
    name: string;
    handle: string;
    email: string | null;
    avatar: string | null;
    group: DashboardGroup;
}

export interface IPayload {
    user: IUser;
    guilds: IGuild[];
    inviteURL: string;
}
