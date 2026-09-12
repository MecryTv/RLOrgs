import { Events } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import logger from "../../utils/logger";

export default class Ready extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.ClientReady,
            description: "Ready event",
            once: true,
        });
    }

    async Execute(): Promise<void> {
        logger.info(`✅ Logged in as ${this.client.user?.username}`);

        // Holt die Mitgliederlisten, sofern das Members-Intent an ist. Ohne den
        // Aufruf stünde beim ersten Blick aufs Dashboard noch keine Bot-Zahl.
        this.client.dashboardService.Warm();

        // Wer beim Start schon im Sprachkanal sitzt, zählt ab jetzt mit.
        this.client.activityService.Warm();
    }
}
