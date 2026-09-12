import { randomBytes } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH, SafeReturnPath, SerializeCookie } from "../constants/Dashboard";
import { EPIC_STATE_COOKIE, EPIC_STATE_LIFETIME } from "../constants/Epic";
import { EpicAuthorizeURL, EpicConfigured } from "../utils/epic";
import { SessionOf } from "../utils/dashboard";

export default class DashboardLinkEpic extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/link/epic`,
            description: "Schickt den Browser zur Epic-Anmeldung, um das Spielerkonto zu verknüpfen",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 20, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        // Anders als beim Discord-Login ist hier schon jemand angemeldet: das
        // Epic-Konto wird an diese Sitzung gehängt, nicht an eine neue.
        const session = SessionOf(this.client, request);

        if (!session) return reply.redirect(`${DASHBOARD_PATH}/login`, 302);

        if (!EpicConfigured(this.client)) {
            return reply.code(503).send({
                error: "Epic-Login nicht eingerichtet",
                hint: "EPIC_CLIENT_ID und EPIC_CLIENT_SECRET in der .env setzen - siehe docs/Environment.md.",
            });
        }

        const query = request.query as { return?: string };

        // Derselbe Nonce im Cookie und im state-Parameter. Nur wenn beim
        // Rücksprung beide zusammenpassen, stammt der Code aus diesem Browser.
        const nonce = randomBytes(24).toString("base64url");
        const back = SafeReturnPath(query.return);

        return reply
            .header(
                "Set-Cookie",
                SerializeCookie(
                    EPIC_STATE_COOKIE,
                    `${nonce}|${back}`,
                    EPIC_STATE_LIFETIME,
                    this.client.dashboardService.Secure
                )
            )
            .redirect(EpicAuthorizeURL(this.client, nonce), 302);
    }
}
