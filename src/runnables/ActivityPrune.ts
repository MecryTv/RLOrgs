import BotClient from "../client/BotClient";
import Runnable from "../structures/Runnable";
import TaskTypes from "../enums/TaskTypes";
import logger from "../utils/logger";

export default class ActivityPrune extends Runnable {
    constructor(client: BotClient) {
        super(client, {
            name: "ActivityPrune",
            description: "Löscht alte Aktivitätszahlen: 90 Tage je Server, 14 Tage je Mitglied",
            type: TaskTypes.DAILY,
            time: "04:30",
        });
    }

    async Execute(): Promise<void> {
        if (!this.client.databaseService.Ready) return;

        const removed = await this.client.activityService.Prune();

        logger.tasks(`📊 Aktivität aufgeräumt: ${removed} alte Zeilen gelöscht`);
    }
}
