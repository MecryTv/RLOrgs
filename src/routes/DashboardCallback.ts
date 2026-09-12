import { timingSafeEqual } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import {
    ClearCookie,
    DASHBOARD_PATH,
    ParseCookies,
    SafeReturnPath,
    SerializeCookie,
    SESSION_COOKIE,
    SESSION_LIFETIME,
    STATE_COOKIE,
} from "../constants/Dashboard";
import { MfaRequired } from "../services/DashboardService";
import { SendPage, Unconfigured } from "../utils/dashboard";

function Match(expected: string, received: string | undefined): boolean {
    if (!expected || !received) return false;

    const a = Buffer.from(expected);
    const b = Buffer.from(received);

    return a.length === b.length && timingSafeEqual(a, b);
}

export default class DashboardCallback extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/callback`,
            description: "Nimmt den OAuth2-Code von Discord entgegen und legt die Sitzung an",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 20, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;

        if (!service.IsConfigured) return Unconfigured(reply);

        const query = request.query as { code?: string; state?: string; error?: string };
        const cookie = ParseCookies(request.headers.cookie)[STATE_COOKIE] ?? "";
        const separator = cookie.indexOf("|");
        const clear = ClearCookie(STATE_COOKIE, service.Secure);

        // Abgebrochen oder von Discord abgelehnt - kein Grund für einen 500er.
        if (query.error) {
            reply.header("Set-Cookie", clear).code(403);

            return SendPage(this.client, reply, "denied.html");
        }

        const nonce = separator < 0 ? "" : cookie.slice(0, separator);
        const back = SafeReturnPath(separator < 0 ? undefined : cookie.slice(separator + 1));

        if (!query.code || !Match(nonce, query.state)) {
            reply.header("Set-Cookie", clear).code(400);

            return SendPage(this.client, reply, "denied.html");
        }

        let session;

        try {
            session = await service.Exchange(query.code);
        } catch (error) {
            // Kein Zwei-Faktor am Discord-Konto. Das ist kein Ausfall, sondern
            // eine Absage mit einem Weg daraus - also eine Anleitung statt eines
            // 500ers. Alles andere fliegt weiter nach oben.
            if (!(error instanceof MfaRequired)) throw error;

            reply.header("Set-Cookie", clear).code(403);

            return SendPage(this.client, reply, "mfa.html");
        }

        const cookies = [clear, SerializeCookie(SESSION_COOKIE, service.Sign(session), SESSION_LIFETIME, service.Secure)];

        return reply.header("Set-Cookie", cookies).redirect(back, 302);
    }
}
