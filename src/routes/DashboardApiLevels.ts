import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { DefaultLevelMessage, LEVEL_PLACEHOLDER_KEYS, LevelProgress, MAX_BONUS, MAX_EXCLUDED, MAX_REWARDS } from "../constants/Levels";
import { ILevelRank } from "../interfaces/services/levels/ILevels";
import { LevelError, LEVELS_MODULE } from "../services/LevelService";
import { WantsJSON } from "../utils/admin";
import { PersonOf, SearchMembers } from "../utils/dashboard";
import logger from "../utils/logger";
import { GuildResources, IManageAccess, ManageGate } from "../utils/managegate";

interface IBody {
    action?: unknown;
    settings?: unknown;
    userId?: unknown;
    amount?: unknown;
    mode?: unknown;
    query?: unknown;
}

/**
 * Level System im Dashboard: Einstellungen, Rangliste und die Punkte einzelner
 * Mitglieder. Siehe docs/Levels.md.
 */
export default class DashboardApiLevels extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/levels`,
            description: "Level System eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const access = await ManageGate(this.client, request, reply, LEVELS_MODULE);

        if (!access) return reply;

        reply.header("Cache-Control", "no-store");

        try {
            if (!writing) return reply.send(await this.Read(access, request.query as { page?: string }));

            return reply.send(await this.Write(access, (request.body ?? {}) as IBody));
        } catch (error) {
            if (error instanceof LevelError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }

    /** Ein Platz der Rangliste mit Namen und Bild. */
    private Out(entry: ILevelRank, access: IManageAccess, base: number) {
        const member = access.guild.members.cache.get(entry.userId);
        const progress = LevelProgress(entry.xp, base);

        return {
            id: entry.userId,
            name: member?.displayName ?? entry.userId,
            avatar: member?.displayAvatarURL({ extension: "webp", size: 64 }) ?? null,
            gone: !member,
            rank: entry.rank,
            level: progress.level,
            xp: entry.xp,
            into: progress.into,
            need: progress.need,
            messages: entry.messages,
            voiceMinutes: entry.voiceMinutes,
        };
    }

    private async Read(access: IManageAccess, query: { page?: string }) {
        const { guild } = access;
        const settings = await this.client.levelService.Settings(guild.id);
        const page = Math.max(1, Math.min(50, Number(query.page) || 1));
        const top = await this.client.levels.Top(guild.id, 25, (page - 1) * 25);

        return {
            settings,
            defaultMessage: DefaultLevelMessage(),
            placeholders: LEVEL_PLACEHOLDER_KEYS,
            limits: { rewards: MAX_REWARDS, bonus: MAX_BONUS, excluded: MAX_EXCLUDED },
            page,
            total: await this.client.levels.Total(guild.id),
            top: top.map((entry) => this.Out(entry, access, settings.base)),
            guild: { name: guild.name, ...GuildResources(guild) },
        };
    }

    private async Write(access: IManageAccess, body: IBody): Promise<unknown> {
        const { guild, member } = access;
        const service = this.client.levelService;
        const userId = typeof body.userId === "string" ? body.userId : "";

        switch (body.action) {
            case "save": {
                const settings = await service.Save(guild, body.settings);

                logger.user(`📈 Level-Einstellungen auf ${guild.id} gespeichert (von ${member.id})`);

                return { ok: true, settings };
            }

            case "members": {
                const query = typeof body.query === "string" ? body.query.trim().slice(0, 100) : "";

                return { members: (await SearchMembers(guild, query)).map(PersonOf) };
            }

            case "adjust": {
                if (!/^\d{17,20}$/.test(userId)) throw new LevelError("Wähle zuerst ein Mitglied.");

                const mode = body.mode === "add" || body.mode === "reset" ? body.mode : "set";
                const amount = Math.round(Number(body.amount));

                if (mode !== "reset" && !Number.isFinite(amount)) throw new LevelError("Gib eine Zahl an.");

                const entry = await service.Adjust(guild, userId, mode, amount);

                logger.user(`📈 Punkte von ${userId} auf ${guild.id} geändert (${mode}, von ${member.id})`);

                return { ok: true, entry };
            }

            case "sync":
                return { ok: true, touched: await service.Sync(guild) };

            case "reset":
                await service.Reset(guild);

                return { ok: true };

            default:
                throw new LevelError("Unbekannte Aktion.");
        }
    }
}
