import { Events, Message } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

/** Jede Nachricht kann Punkte bringen - sofern die Sperre abgelaufen ist. */
export default class LevelMessages extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.MessageCreate,
            description: "Vergibt Punkte für Nachrichten (Level System)",
            once: false,
        });
    }

    async Execute(message: Message): Promise<void> {
        await this.client.levelService.Message(message).catch(() => undefined);
    }
}
