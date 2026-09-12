import { Events, GuildMember, PartialGuildMember } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

// Kommt nur mit GUILD_MEMBER_INTENT - ohne bleiben die Abgänge bei null.
export default class ActivityLeave extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.GuildMemberRemove,
            description: "Zählt Abgänge für die Server-Übersicht",
            once: false,
        });
    }

    async Execute(member: GuildMember | PartialGuildMember): Promise<void> {
        this.client.activityService.Leave(member);
    }
}
