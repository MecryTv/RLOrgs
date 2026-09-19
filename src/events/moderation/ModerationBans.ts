import { Events, GuildBan } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

// Kommt nur mit dem Intent GuildModeration (nicht privilegiert).
export default class ModerationBans extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.GuildBanRemove,
            description: "Schließt offene Bann-Fälle, wenn jemand in Discord selbst entbannt",
            once: false,
        });
    }

    async Execute(ban: GuildBan): Promise<void> {
        await this.client.moderationService.BanRemoved(ban.guild, ban.user.id).catch(() => undefined);
    }
}
