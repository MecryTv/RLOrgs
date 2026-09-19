import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { CLAIM_CHOICES, MAX_BONUS_ROLES, MAX_BONUS_TICKETS, MAX_WINNERS } from "../constants/Giveaways";
import { IGiveaway } from "../interfaces/services/community/ICommunity";
import { BOOSTER, GiveawayError, GIVEAWAYS_MODULE } from "../services/GiveawayService";
import { WantsJSON } from "../utils/admin";
import { CreateLogThread, LogTargetError, LogTargets } from "../utils/logtarget";
import { GuildResources, IManageAccess, ManageGate } from "../utils/managegate";

interface IBody {
    action?: unknown;
    giveaway?: unknown;
    number?: unknown;
    user?: unknown;
    forumId?: unknown;
}

/**
 * Giveaways im Dashboard. GET: die Liste mit Teilnehmerzahl, mit
 * ?giveaway=5 eines samt Teilnehmern und Gewinnern. POST: create, end,
 * reroll, cancel, delete, logthread.
 */
export default class DashboardApiGiveaways extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/giveaways`,
            description: "Giveaways eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const access = await ManageGate(this.client, request, reply, GIVEAWAYS_MODULE);

        if (!access) return reply;

        reply.header("Cache-Control", "no-store");

        try {
            if (!writing) return reply.send(await this.Read(access, request.query as { giveaway?: string }));

            return reply.send(await this.Write(access, (request.body ?? {}) as IBody));
        } catch (error) {
            if (error instanceof GiveawayError || error instanceof LogTargetError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }

    private Person(access: IManageAccess, userId: string): { id: string; name: string; avatar: string | null } {
        const member = access.guild.members.cache.get(userId);
        const user = member?.user ?? this.client.users.cache.get(userId);

        return { id: userId, name: member?.displayName ?? user?.username ?? userId, avatar: user?.displayAvatarURL({ extension: "webp", size: 64 }) ?? null };
    }

    private Out(access: IManageAccess, giveaway: IGiveaway, entries: number) {
        return {
            id: giveaway.id,
            number: giveaway.number,
            channelId: giveaway.channelId,
            url: giveaway.messageId ? `https://discord.com/channels/${giveaway.guildId}/${giveaway.channelId}/${giveaway.messageId}` : null,
            prize: giveaway.prize,
            description: giveaway.description,
            image: giveaway.image,
            winners: giveaway.winners,
            host: this.Person(access, giveaway.hostId),
            status: giveaway.status,
            startsAt: giveaway.startsAt,
            endsAt: giveaway.endsAt,
            endedAt: giveaway.endedAt,
            requirements: giveaway.requirements,
            bonus: giveaway.bonus,
            settings: giveaway.settings,
            rules: this.client.giveawayService.Rules(access.guild, giveaway).map((rule) => rule.replace(/<@&(\d+)>/g, (_, id: string) => `@${access.guild.roles.cache.get(id)?.name ?? "Rolle"}`)),
            results: giveaway.results.winners.map((winner) => ({ ...winner, ...this.Person(access, winner.userId) })),
            entries,
        };
    }

    private async Read(access: IManageAccess, query: { giveaway?: string }) {
        const { guild } = access;

        if (query.giveaway) {
            const giveaway = await this.client.giveaways.ByNumber(guild.id, Number(query.giveaway));

            if (!giveaway) throw new GiveawayError("Dieses Giveaway gibt es hier nicht.");

            const entries = await this.client.giveaways.Entries(giveaway.id);

            return {
                giveaway: this.Out(access, giveaway, entries.length),
                entrants: entries.slice(0, 500).map((entry) => ({ ...this.Person(access, entry.user_id), tickets: entry.tickets, at: entry.created_at })),
            };
        }

        const giveaways = await this.client.giveaways.OfGuild(guild.id);
        const counts = await this.client.giveaways.Counts(giveaways.map((giveaway) => giveaway.id));

        return {
            giveaways: giveaways.map((giveaway) => this.Out(access, giveaway, counts.get(giveaway.id) ?? 0)),
            limits: { winners: MAX_WINNERS, bonusRoles: MAX_BONUS_ROLES, bonusTickets: MAX_BONUS_TICKETS, claim: CLAIM_CHOICES },
            booster: BOOSTER,
            guild: { name: guild.name, boostRole: guild.roles.premiumSubscriberRole?.name ?? null, ...GuildResources(guild) },
            targets: await LogTargets(guild, []),
        };
    }

    private async Write(access: IManageAccess, body: IBody): Promise<unknown> {
        const { guild, member } = access;
        const service = this.client.giveawayService;

        if (body.action === "create") {
            const giveaway = await service.Create(guild, member, body.giveaway);

            return { ok: true, giveaway: this.Out(access, giveaway, 0) };
        }

        if (body.action === "logthread") return { ok: true, thread: await CreateLogThread(guild, body.forumId, "Giveaways", "🎉 Hier laufen die Giveaways von RL Nexus.") };

        const giveaway = await this.client.giveaways.ByNumber(guild.id, Number(body.number));

        if (!giveaway) throw new GiveawayError("Dieses Giveaway gibt es hier nicht.");

        switch (body.action) {
            case "end": {
                const done = await service.End(giveaway);

                return { ok: true, giveaway: this.Out(access, done, await this.client.giveaways.EntryCount(done.id)) };
            }

            case "reroll": {
                const done = await service.Reroll(giveaway, typeof body.user === "string" && /^\d{17,20}$/.test(body.user) ? body.user : "all");

                return { ok: true, giveaway: this.Out(access, done, await this.client.giveaways.EntryCount(done.id)) };
            }

            case "cancel": {
                const done = await service.Cancel(giveaway);

                return { ok: true, giveaway: this.Out(access, done, await this.client.giveaways.EntryCount(done.id)) };
            }

            case "delete":
                await service.Delete(giveaway);

                return { ok: true };

            default:
                throw new GiveawayError("Unbekannte Aktion.");
        }
    }
}
