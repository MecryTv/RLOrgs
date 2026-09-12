import BotClient from "../client/BotClient";
import Route from "../structures/Route";

export default class Health extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: "/health",
            description: "Statusabfrage für Monitoring und Uptime-Checks",
        });
    }

    async Handle(): Promise<unknown> {
        return { status: "ok", uptime: Math.round(process.uptime()) };
    }
}
