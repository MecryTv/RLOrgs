import { Events, Message } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

export default class ActivityMessage extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.MessageCreate,
            description: "Zählt Nachrichten für die Server-Übersicht",
            once: false,
        });
    }

    async Execute(message: Message): Promise<void> {
        this.client.activityService.Message(message);
    }
}
