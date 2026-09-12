import BotClient from "../client/BotClient";
import Runnable from "../structures/Runnable";
import TaskTypes from "../enums/TaskTypes";
import logger from "../utils/logger";

export default class Heartbeat extends Runnable {
    constructor(client: BotClient) {
        super(client, {
            name: "Heartbeat",
            description: "Loggt regelmäßig Gateway-Ping und Uptime",
            type: TaskTypes.INTERVAL,
            expression: "15m",
        });
    }

    async Execute(): Promise<void> {
        const uptime = Math.floor((this.client.uptime ?? 0) / 1000 / 60);
        logger.tasks(`💓 Heartbeat: ${this.client.ws.ping}ms Ping | ${uptime} Minuten Uptime`);
    }
}
