import { Events, Presence } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

// Kommt nur mit dem privilegierten Presence Intent (GUILD_PRESENCE_INTENT in der .env).
export default class LiveRole extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.PresenceUpdate,
            description: "Vergibt die Live-Rolle des Twitch Notifiers, solange jemand auf Twitch streamt",
            once: false,
        });
    }

    async Execute(_old: Presence | null, presence: Presence): Promise<void> {
        await this.client.streamService.Presence(presence).catch(() => undefined);
    }
}
