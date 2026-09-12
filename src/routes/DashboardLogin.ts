import { randomBytes } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH, SafeReturnPath, SerializeCookie, STATE_COOKIE, STATE_LIFETIME } from "../constants/Dashboard";
import { Unconfigured } from "../utils/dashboard";

/**
 * Die Anmeldung läuft ausschließlich über Discord.
 *
 * Ein eigenes Passwort stand hier einmal daneben, samt Zwei-Faktor-Anmeldung.
 * Beides ist wieder weg: das Konto hängt ohnehin an Discord, und wer dort einen
 * zweiten Faktor gesetzt hat, hat ihn damit auch hier. Ein eigenes Passwort war
 * also eine zweite Tür in denselben Raum - mit eigener Sperre, eigenem
 * Vergessen-Ablauf und eigenem Risiko, aber ohne zusätzlichen Nutzen.
 */
export default class DashboardLogin extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/login`,
            description: "Schickt den Browser zur Discord-Anmeldung",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 20, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;

        if (!service.IsConfigured) return Unconfigured(reply);

        const query = request.query as { return?: string };

        // Der Nonce liegt gleichzeitig im Cookie und im state-Parameter. Nur wenn
        // beim Rücksprung beide zusammenpassen, stammt der Code aus diesem Browser.
        const nonce = randomBytes(24).toString("base64url");
        const back = SafeReturnPath(query.return);

        return reply
            .header("Set-Cookie", SerializeCookie(STATE_COOKIE, `${nonce}|${back}`, STATE_LIFETIME, service.Secure))
            .redirect(service.AuthorizeURL(nonce), 302);
    }
}
