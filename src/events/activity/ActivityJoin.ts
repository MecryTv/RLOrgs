import { Events, GuildMember } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

// Kommt nur mit GUILD_MEMBER_INTENT - ohne bleiben die Beitritte bei null.
export default class ActivityJoin extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.GuildMemberAdd,
            description: "Zählt Beitritte für die Server-Übersicht",
            once: false,
        });
    }

    async Execute(member: GuildMember): Promise<void> {
        this.client.activityService.Join(member);
    }
}
