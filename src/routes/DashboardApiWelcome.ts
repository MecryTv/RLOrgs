import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { DefaultCard, DefaultDoc, MAX_ROLES, MAX_TITLE_SIZE, MIN_TITLE_SIZE, WELCOME_PLACEHOLDER_KEYS } from "../constants/Welcome";
import { KIND_LABELS } from "../constants/Messages";
import { IWelcomeMessage } from "../interfaces/services/welcome/IWelcome";
import { WelcomeError, WELCOME_MODULE } from "../services/WelcomeService";
import { WantsJSON } from "../utils/admin";
import logger from "../utils/logger";
import { GuildResources, IManageAccess, ManageGate } from "../utils/managegate";

interface IBody {
    action?: unknown;
    config?: unknown;
    which?: unknown;
    message?: unknown;
}

/**
 * Welcome System im Dashboard: Begrüßung, Abschied, Auto-Rollen - dazu die
 * Vorschau der gezeichneten Karte. Siehe docs/Welcome.md.
 */
export default class DashboardApiWelcome extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/welcome`,
            description: "Begrüßung, Abschied und Auto-Rollen eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const access = await ManageGate(this.client, request, reply, WELCOME_MODULE);

        if (!access) return reply;

        reply.header("Cache-Control", "no-store");

        try {
            if (!writing) return reply.send(await this.Read(access));

            return reply.send(await this.Write(access, (request.body ?? {}) as IBody));
        } catch (error) {
            if (error instanceof WelcomeError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }

    private async Read(access: IManageAccess) {
        const { guild } = access;

        return {
            config: await this.client.welcomeService.Settings(guild.id),
            defaults: { join: { doc: DefaultDoc("join"), card: DefaultCard("join") }, leave: { doc: DefaultDoc("leave"), card: DefaultCard("leave") } },
            placeholders: WELCOME_PLACEHOLDER_KEYS,
            kinds: { card: "Welcome Card (Bild)", ...KIND_LABELS },
            limits: { roles: MAX_ROLES, titleMin: MIN_TITLE_SIZE, titleMax: MAX_TITLE_SIZE },
            // Ohne das Members-Intent sieht der Bot niemanden kommen.
            ready: { members: this.client.config.GUILD_MEMBER_INTENT },
            guild: { name: guild.name, icon: guild.iconURL({ extension: "png", size: 128 }), ...GuildResources(guild) },
        };
    }

    private async Write(access: IManageAccess, body: IBody): Promise<unknown> {
        const { guild, member } = access;
        const service = this.client.welcomeService;
        const which = body.which === "leave" ? "leave" : "join";

        switch (body.action) {
            case "save": {
                const config = await service.Save(guild, body.config);

                logger.user(`👋 Welcome-Einstellungen auf ${guild.id} gespeichert (von ${member.id})`);

                return { ok: true, config };
            }

            case "test":
                await service.Test(guild, member, which);

                return { ok: true };

            case "preview": {
                // Die Karte aus dem Entwurf - gezeichnet mit den Daten dessen, der zuschaut.
                const current = await service.Settings(guild.id);
                const message: IWelcomeMessage = service.CleanMessage(guild, body.message, current[which], which);
                const png = await service.Card(member, message, which);

                return { ok: true, image: `data:image/png;base64,${png.toString("base64")}` };
            }

            case "background-remove":
                await service.RemoveBackground(guild, which);

                return { ok: true, config: await service.Settings(guild.id) };

            default:
                throw new WelcomeError("Unbekannte Aktion.");
        }
    }
}
