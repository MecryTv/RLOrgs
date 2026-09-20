import { Events, GuildMember } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

/** Neues Mitglied: begrüßen und die Auto-Rollen vergeben. */
export default class WelcomeJoin extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.GuildMemberAdd,
            description: "Begrüßt neue Mitglieder und vergibt die Auto-Rollen",
            once: false,
        });
    }

    async Execute(member: GuildMember): Promise<void> {
        await this.client.welcomeService.Join(member).catch(() => undefined);
    }
}
