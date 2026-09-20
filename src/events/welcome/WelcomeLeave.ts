import { Events, GuildMember, PartialGuildMember } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

/** Jemand ist weg: den Abschied schicken, sofern er an ist. */
export default class WelcomeLeave extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.GuildMemberRemove,
            description: "Schickt den Abschied, wenn jemand den Server verlässt",
            once: false,
        });
    }

    async Execute(member: GuildMember | PartialGuildMember): Promise<void> {
        if (member.partial) return;

        await this.client.welcomeService.Leave(member as GuildMember).catch(() => undefined);
    }
}
