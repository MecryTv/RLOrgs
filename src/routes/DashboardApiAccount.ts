import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { LINK_COOLDOWN, LINK_COOLDOWN_DAYS, LINK_COOLDOWN_DEV } from "../constants/Database";
import { PrimeError } from "../services/PrimeService";
import { WantsJSON } from "../utils/admin";
import { EpicAdopt } from "../utils/epic";
import { SessionOf } from "../utils/dashboard";
import logger from "../utils/logger";

const MAX_NAME = 64;

/** Im Entwicklungsmodus zehn Sekunden statt der vollen Frist - sonst ist das nicht testbar. */
export function CooldownOf(client: BotClient): number {
    return client.developerMode ? LINK_COOLDOWN_DEV : LINK_COOLDOWN;
}

export default class DashboardApiAccount extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "POST",
            path: `${DASHBOARD_PATH}/api/account/epic`,
            description: "Verknüpft das Epic-Konto, nachdem die Rocket-League-API es bestätigt hat",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 10, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });
        if (!WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        if (!this.client.databaseService.Ready) {
            return reply.code(503).send({ error: "Keine Datenbank", hint: "Verknüpfungen stehen in der Datenbank." });
        }

        if (!this.client.primeService.IsConfigured) {
            return reply.code(503).send({
                error: "Rang-Tracking nicht eingerichtet",
                hint: "Ohne PRIME_API_TOKEN lässt sich der Name nicht prüfen.",
            });
        }

        const { name } = (request.body ?? {}) as { name?: unknown };
        const wanted = typeof name === "string" ? name.trim() : "";

        if (!wanted || wanted.length > MAX_NAME) return reply.code(400).send({ error: "Kein gültiger Epic-Name" });

        const windowMs = CooldownOf(this.client);
        const cooldown = await this.client.accounts.Cooldown(session.userId, "epic", windowMs);
        const current = await this.client.accounts.On(session.userId, "epic");

        // Derselbe Name noch einmal ist keine Änderung - das darf die Sperre nicht treffen.
        const same = current?.display_name?.toLowerCase() === wanted.toLowerCase();

        if (!cooldown.open && !same) {
            return reply.code(429).send({
                error: "Noch gesperrt",
                hint: `Das Epic-Konto lässt sich nur alle ${LINK_COOLDOWN_DAYS} Tage wechseln.`,
                cooldown,
            });
        }

        // Erst prüfen, dann verknüpfen: ein Name, den die API nicht kennt, wird
        // gar nicht erst gespeichert.
        let profile;

        try {
            profile = await this.client.primeService.Profile(wanted);
        } catch (error) {
            const prime = error instanceof PrimeError ? error : null;

            logger.warn(`🎮 Prime: ${prime ? `${prime.type} ${prime.message}` : String(error)}`);

            return reply.code(502).send({ error: "Rocket League antwortet gerade nicht" });
        }

        if (!profile) {
            return reply.code(404).send({
                error: "Diesen Epic-Namen gibt es nicht",
                hint: "Schreibweise prüfen - genau wie im Spiel.",
            });
        }

        // Derselbe Weg wie nach der echten Anmeldung - sonst haette der Notweg
        // keinen Club und keine Raenge.
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

        logger.user(`🎮 Epic verknüpft: ${session.userId} → ${profile.name} (${profile.accountId})`);

        return reply.send({
            ok: true,
            account: { platform: "epic", name: profile.name, accountId: profile.accountId, verified: true },
            cooldown: await this.client.accounts.Cooldown(session.userId, "epic", windowMs),
        });
    }
}
