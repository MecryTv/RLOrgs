import BotClient from "../client/BotClient";
import Runnable from "../structures/Runnable";
import TaskTypes from "../enums/TaskTypes";

/** Hebt befristete Banns auf und trägt abgelaufene Timeouts aus - wie TicketReminders jede Minute. */
export default class ModerationExpiry extends Runnable {
    constructor(client: BotClient) {
        super(client, {
            name: "ModerationExpiry",
            description: "Hebt abgelaufene Banns auf und schließt abgelaufene Timeouts",
            type: TaskTypes.INTERVAL,
            expression: "1m",
        });
    }

    async Execute(): Promise<void> {
        await this.client.moderationService.RunDue();
    }
}
