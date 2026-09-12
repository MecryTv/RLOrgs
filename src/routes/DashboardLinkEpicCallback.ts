import { timingSafeEqual } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import { LINK_COOLDOWN_DAYS } from "../constants/Database";
import Route from "../structures/Route";
import { ClearCookie, DASHBOARD_PATH, ParseCookies, SafeReturnPath } from "../constants/Dashboard";
import { EPIC_STATE_COOKIE } from "../constants/Epic";
import { PrimeError } from "../services/PrimeService";
import { CooldownOf } from "./DashboardApiAccount";
import { SessionOf } from "../utils/dashboard";
import { EpicAdopt, EpicConfigured, EpicExchange } from "../utils/epic";
import logger from "../utils/logger";

function Match(expected: string, received: string | undefined): boolean {
    if (!expected || !received) return false;

    const a = Buffer.from(expected);
    const b = Buffer.from(received);

    return a.length === b.length && timingSafeEqual(a, b);
}

export default class DashboardLinkEpicCallback extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/link/epic/callback`,
            description: "Nimmt den Code von Epic entgegen und verknüpft das Spielerkonto",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 20, timeWindow: "1 minute" },
        });
    }

    /**
     * Zurück, woher der Nutzer kam - mit einem Wort dazu, wie es ausging.
     *
     * Der Rücksprung von Epic ist eine ganze Seitennavigation, kein fetch: eine
     * JSON-Antwort würde hier als roher Text im Browser landen. Deshalb landet
     * das Ergebnis im Adresszeilen-Parameter und das Dashboard macht daraus
     * einen Hinweis.
     */
    private Back(reply: FastifyReply, to: string, status: string): FastifyReply {
        const clear = ClearCookie(EPIC_STATE_COOKIE, this.client.dashboardService.Secure);
        const glue = to.includes("?") ? "&" : "?";

        return reply.header("Set-Cookie", clear).redirect(`${to}${glue}epic=${status}`, 302) as FastifyReply;
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const session = SessionOf(this.client, request);

        if (!session) return reply.redirect(`${DASHBOARD_PATH}/login`, 302);

        const query = request.query as { code?: string; state?: string; error?: string };
        const cookie = ParseCookies(request.headers.cookie)[EPIC_STATE_COOKIE] ?? "";
        const separator = cookie.indexOf("|");
        const nonce = separator < 0 ? "" : cookie.slice(0, separator);
        const back = SafeReturnPath(separator < 0 ? undefined : cookie.slice(separator + 1));

        // Abgebrochen oder von Epic abgelehnt - kein Grund für einen Fehler.
        if (query.error) return this.Back(reply, back, "denied");
        if (!EpicConfigured(this.client)) return this.Back(reply, back, "unconfigured");
        if (!query.code || !Match(nonce, query.state)) return this.Back(reply, back, "state");

        if (!this.client.databaseService.Ready) return this.Back(reply, back, "nodb");
        if (!this.client.primeService.IsConfigured) return this.Back(reply, back, "noprime");

        const accountId = await EpicExchange(this.client, query.code).catch(() => null);

        if (!accountId) return this.Back(reply, back, "exchange");

        // Die Sperrfrist gilt dem Wechsel, nicht dem Bestätigen: wer sich mit
        // demselben Konto erneut anmeldet, frischt nur die Plattformen auf.
        const current = await this.client.accounts.On(session.userId, "epic");
        const same = current?.account_id === accountId;
        const windowMs = CooldownOf(this.client);
        const cooldown = await this.client.accounts.Cooldown(session.userId, "epic", windowMs);

        if (!cooldown.open && !same) return this.Back(reply, back, "cooldown");

        // Prime nimmt die 32-stellige Konto-ID genauso wie einen Namen. Damit
        // kommen Anzeigename, verknüpfte Plattformen, Ränge und Club in einem Zug.
        let profile;

        try {
            profile = await this.client.primeService.Profile(accountId);
        } catch (error) {
            const prime = error instanceof PrimeError ? error : null;

            logger.warn(`🎮 Prime: ${prime ? `${prime.type} ${prime.message}` : String(error)}`);

            return this.Back(reply, back, "primedown");
        }

        // Ein gültiges Epic-Konto, das Rocket League nie gestartet hat: der
        // Login stimmt, es gibt nur nichts zu tracken.
        if (!profile) return this.Back(reply, back, "norl");

        await EpicAdopt(this.client, session.userId, profile);

        if (!same) {
            await this.client.notifications.Push(
                session.userId,
                "account",
                current ? "Epic-Konto gewechselt" : "Epic-Konto verknüpft",
                `${profile.name} ist jetzt mit deinem Konto verbunden. Ein Wechsel ist erst in ${LINK_COOLDOWN_DAYS} Tagen wieder möglich.`,
                `${DASHBOARD_PATH}/user/${session.userId}/tracking`
            );
        }

        logger.user(
            `🎮 Epic verknüpft (Login): ${session.userId} → ${profile.name} (${profile.accountId})`
        );

        return this.Back(reply, back, same ? "refreshed" : "ok");
    }
}
