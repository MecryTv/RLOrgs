import BotClient from "../client/BotClient";
import Runnable from "../structures/Runnable";
import TaskTypes from "../enums/TaskTypes";
import logger from "../utils/logger";

/**
 * Jede Minute: Twitch fragen (YouTube alle fünf Minuten), abgelaufene
 * Umfragen beenden, Giveaways starten, auslosen und verpasste Fristen neu
 * vergeben. Die drei laufen unabhängig - hängt einer, laufen die anderen weiter.
 */
export default class CommunityTimers extends Runnable {
    constructor(client: BotClient) {
        super(client, {
            name: "CommunityTimers",
            description: "Twitch- und YouTube-Meldungen, Ende der Umfragen, Giveaways",
            type: TaskTypes.INTERVAL,
            expression: "1m",
        });
    }

    async Execute(): Promise<void> {
        const jobs: [string, () => Promise<void>][] = [
            ["Notifier", () => this.client.streamService.RunDue()],
            ["Umfragen", () => this.client.pollService.RunDue()],
            ["Giveaways", () => this.client.giveawayService.RunDue()],
        ];

        await Promise.all(jobs.map(([name, job]) => job().catch((error) => logger.warn(`⏱️ ${name}: ${String(error)}`))));
    }
}
