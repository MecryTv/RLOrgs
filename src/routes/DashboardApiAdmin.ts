import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { AvatarURL, ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { TABLES } from "../constants/Database";
import { IDashboardGroupRow } from "../models/DashboardGroups";
import { StaffOnly } from "../utils/admin";

interface IEntry {
    userId: string;
    group: string;
    name: string | null;
    avatar: string | null;
    grantedBy: string | null;
    grantedByName: string | null;
    grantedAt: string;
    note: string | null;
}

export default class DashboardApiAdmin extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/admin`,
            description: "Übersicht und vergebene Gruppen für das Admin-Dashboard",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    // Namen kommen aus dem Cache des Bots. Ist einer nicht da, wird er einmal
    // geholt - fehlt er weiter, steht später nur die ID da. Erfunden wird nichts.
    private async NameOf(userId: string): Promise<string | null> {
        const cached = this.client.users.cache.get(userId);

        if (cached) return cached.globalName ?? cached.username;

        try {
            const user = await this.client.users.fetch(userId);

            return user.globalName ?? user.username;
        } catch {
            return null;
        }
    }

    private async AvatarOf(userId: string): Promise<string | null> {
        const user = this.client.users.cache.get(userId);

        return user ? AvatarURL(userId, user.avatar) : null;
    }

    private async Entries(rows: IDashboardGroupRow[]): Promise<IEntry[]> {
        const entries: IEntry[] = [];

        for (const row of rows) {
            entries.push({
                userId: row.user_id,
                group: row.group_name,
                name: await this.NameOf(row.user_id),
                avatar: await this.AvatarOf(row.user_id),
                grantedBy: row.granted_by,
                grantedByName: row.granted_by ? await this.NameOf(row.granted_by) : null,
                grantedAt: new Date(row.granted_at).toISOString(),
                note: row.note,
            });
        }

        return entries;
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;

        try {
            const session = await StaffOnly(this.client, request, reply);

            if (!session) return reply;

            const database = this.client.databaseService;

            // Die Entwickler stehen in der .env und nicht in der Tabelle - sie
            // gehören trotzdem in die Liste, sonst sieht es aus, als gäbe es sie nicht.
            const developers: IEntry[] = [];

            for (const id of this.client.config.DEV_USER_IDs) {
                developers.push({
                    userId: id,
                    group: "developer",
                    name: await this.NameOf(id),
                    avatar: await this.AvatarOf(id),
                    grantedBy: null,
                    grantedByName: null,
                    grantedAt: "",
                    note: "Steht in DEV_USER_IDs (.env)",
                });
            }

            const stored = database.Ready ? await this.client.groups.All() : [];

            const counts = database.Ready
                ? await this.client.groups.Counts()
                : { administrator: 0, partner: 0, premium: 0 };

            const totals = database.Ready
                ? {
                      teams: await this.client.teams.Count({ active: 1 }),
                      matches: await this.client.matches.Count(),
                      accounts: await this.client.accounts.Count(),
                      settings: await this.client.settings.Count(),
                  }
                : null;

            return reply.header("Cache-Control", "no-store").send({
                me: { id: session.userId, group: await service.GroupOf(session.userId) },
                database: {
                    ready: database.Ready,
                    configured: database.IsConfigured,
                    name: this.client.config.DATABASE_NAME,
                    host: this.client.config.DATABASE_HOST,
                    cache: database.Stats(),
                    tables: Object.values(TABLES),
                },
                bot: {
                    tag: this.client.user?.tag ?? null,
                    guilds: this.client.guilds.cache.size,
                    developerMode: this.client.developerMode,
                    uptime: Math.round((this.client.uptime ?? 0) / 1000),
                },
                totals,
                counts: { ...counts, developer: developers.length },
                entries: [...developers, ...(await this.Entries(stored))],
            });
        } catch (error) {
            if (!(error instanceof SessionExpired)) throw error;

            return reply
                .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
                .code(401)
                .send({ error: "Unauthorized" });
        }
    }
}
