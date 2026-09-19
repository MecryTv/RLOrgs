import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { MAX_OPTION_NATIVE, MAX_OPTION_OWN, MAX_POLL_OPTIONS, NATIVE_MAX_HOURS } from "../constants/Polls";
import { IPoll } from "../interfaces/services/community/ICommunity";
import { PollError, POLLS_MODULE } from "../services/PollService";
import { WantsJSON } from "../utils/admin";
import { CreateLogThread, LogTargetError, LogTargets } from "../utils/logtarget";
import { GuildResources, IManageAccess, ManageGate } from "../utils/managegate";

interface IBody {
    action?: unknown;
    poll?: unknown;
    number?: unknown;
    forumId?: unknown;
}

/**
 * Umfragen im Dashboard. GET: die Liste mit Ergebnissen (und was das Formular
 * braucht), mit ?poll=3 eine Umfrage samt Stimmen je Person (nicht bei
 * anonymen). POST: create, end, delete, logthread.
 */
export default class DashboardApiPolls extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/polls`,
            description: "Umfragen eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const access = await ManageGate(this.client, request, reply, POLLS_MODULE);

        if (!access) return reply;

        reply.header("Cache-Control", "no-store");

        try {
            if (!writing) return reply.send(await this.Read(access, request.query as { poll?: string }));

            return reply.send(await this.Write(access, (request.body ?? {}) as IBody));
        } catch (error) {
            if (error instanceof PollError || error instanceof LogTargetError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }

    private async Out(poll: IPoll) {
        const tally = await this.client.pollService.Results(poll);

        return {
            id: poll.id,
            number: poll.number,
            kind: poll.kind,
            channelId: poll.channelId,
            url: poll.messageId ? `https://discord.com/channels/${poll.guildId}/${poll.channelId}/${poll.messageId}` : null,
            question: poll.question,
            description: poll.description,
            options: poll.options,
            settings: poll.settings,
            status: poll.status,
            createdAt: poll.createdAt,
            endsAt: poll.endsAt,
            endedAt: poll.endedAt,
            counts: tally.counts,
            voters: tally.voters,
        };
    }

    private async Read(access: IManageAccess, query: { poll?: string }) {
        const { guild } = access;

        if (query.poll) {
            const poll = await this.client.polls.ByNumber(guild.id, Number(query.poll));

            if (!poll) throw new PollError("Diese Umfrage gibt es hier nicht.");

            // Wer was gewählt hat - nur bei eigenen, nicht anonymen Umfragen.
            const votes = poll.kind === "buttons" && !poll.settings.anonymous ? await this.client.polls.Voters(poll.id) : [];
            const names = new Map<string, { name: string; avatar: string | null }>();

            for (const vote of votes) {
                if (names.has(vote.user_id)) continue;

                const user = guild.members.cache.get(vote.user_id)?.user ?? this.client.users.cache.get(vote.user_id);

                names.set(vote.user_id, { name: guild.members.cache.get(vote.user_id)?.displayName ?? user?.username ?? vote.user_id, avatar: user?.displayAvatarURL({ extension: "webp", size: 64 }) ?? null });
            }

            return {
                poll: await this.Out(poll),
                voters: votes.map((vote) => ({ option: vote.option_id, id: vote.user_id, ...names.get(vote.user_id)! })),
            };
        }

        const polls = await this.client.polls.OfGuild(guild.id);

        return {
            polls: await Promise.all(polls.map((poll) => this.Out(poll))),
            limits: { options: MAX_POLL_OPTIONS, own: MAX_OPTION_OWN, native: MAX_OPTION_NATIVE, nativeHours: NATIVE_MAX_HOURS },
            guild: { name: guild.name, ...GuildResources(guild) },
            targets: await LogTargets(guild, []),
        };
    }

    private async Write(access: IManageAccess, body: IBody): Promise<unknown> {
        const { guild, member } = access;
        const service = this.client.pollService;

        if (body.action === "create") return { ok: true, poll: await this.Out(await service.Create(guild, member, body.poll)) };

        if (body.action === "logthread") return { ok: true, thread: await CreateLogThread(guild, body.forumId, "Umfragen", "📊 Hier laufen die Umfragen von RL Nexus.") };

        const poll = await this.client.polls.ByNumber(guild.id, Number(body.number));

        if (!poll) throw new PollError("Diese Umfrage gibt es hier nicht.");

        if (body.action === "end") return { ok: true, poll: await this.Out(await service.End(poll)) };

        if (body.action === "delete") {
            await service.Delete(guild, poll);

            return { ok: true };
        }

        throw new PollError("Unbekannte Aktion.");
    }
}
