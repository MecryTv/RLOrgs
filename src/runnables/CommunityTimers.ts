import BotClient from "../client/BotClient";
import Runnable from "../structures/Runnable";
import TaskTypes from "../enums/TaskTypes";
import logger from "../utils/logger";

/**
 * Jede Minute: Twitch fragen (YouTube alle fünf Minuten), abgelaufene
 * Umfragen beenden, Giveaways starten und auslosen, verpasste Fristen neu
 * vergeben und Punkte für die Zeit im Sprachkanal verteilen. Die Aufgaben
 * laufen unabhängig - hängt eine, laufen die anderen weiter.
 */
export default class CommunityTimers extends Runnable {
    constructor(client: BotClient) {
        super(client, {
            name: "CommunityTimers",
            description: "Twitch- und YouTube-Meldungen, Ende der Umfragen, Giveaways, Voice-Punkte",
            type: TaskTypes.INTERVAL,
            expression: "1m",
        });
    }

    async Execute(): Promise<void> {
        const jobs: [string, () => Promise<void>][] = [
            ["Notifier", () => this.client.streamService.RunDue()],
            ["Umfragen", () => this.client.pollService.RunDue()],
            ["Giveaways", () => this.client.giveawayService.RunDue()],
            ["Level", () => this.client.levelService.Voice()],
            ["Nachrichten", () => this.client.messageService.RunDue()],
        ];

        await Promise.all(jobs.map(([name, job]) => job().catch((error) => logger.warn(`⏱️ ${name}: ${String(error)}`))));
    }
}
