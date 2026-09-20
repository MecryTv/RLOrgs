import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { LevelProgress } from "../constants/Levels";
import { LEVELS_MODULE } from "../services/LevelService";

/**
 * Die Rangliste eines Servers ohne Anmeldung.
 *
 * Sie antwortet nur, wenn der Server das Level System anhat **und** die
 * Rangliste ausdrücklich öffentlich gestellt hat. Sonst 404 - auch dann, wenn
 * es den Server gibt: ein Unterschied in der Antwort würde verraten, wo der
 * Bot überall läuft. Herausgegeben werden Platz, Name, Bild, Level und Punkte,
 * sonst nichts. Siehe docs/Levels.md.
 */
export default class DashboardApiLeaderboard extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/public/levels/:id`,
            description: "Öffentliche Rangliste eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const { id } = request.params as { id?: string };
        const missing = (): unknown => reply.code(404).send({ error: "Diese Rangliste gibt es nicht." });

        if (!id || !SNOWFLAKE.test(id) || !this.client.databaseService.Ready) return missing();

        const guild = this.client.guilds.cache.get(id);

        if (!guild) return missing();
        if (!(await this.client.settings.Of(guild.id)).modules.includes(LEVELS_MODULE)) return missing();

        const settings = await this.client.levelService.Settings(guild.id);

        if (!settings.public) return missing();

        const top = await this.client.levels.Top(guild.id, 100);

        reply.header("Cache-Control", "public, max-age=60");

        return reply.send({
            guild: { name: guild.name, icon: guild.iconURL({ extension: "png", size: 128 }), members: guild.memberCount },
            total: await this.client.levels.Total(guild.id),
            top: top.map((entry) => {
                const member = guild.members.cache.get(entry.userId);
                const progress = LevelProgress(entry.xp, settings.base);

                return {
                    rank: entry.rank,
                    name: member?.displayName ?? "Ehemaliges Mitglied",
                    avatar: member?.displayAvatarURL({ extension: "webp", size: 64 }) ?? null,
                    level: progress.level,
                    xp: entry.xp,
                    into: progress.into,
                    need: progress.need,
                    messages: entry.messages,
                    voiceMinutes: entry.voiceMinutes,
                };
            }),
        });
    }
}
