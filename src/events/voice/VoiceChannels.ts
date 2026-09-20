import { Events, VoiceState } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

/** Hub betreten heißt eigener Kanal, letzter raus heißt Kanal weg. */
export default class VoiceChannels extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.VoiceStateUpdate,
            description: "Legt Temp-Voice-Kanäle an und räumt sie wieder weg",
            once: false,
        });
    }

    async Execute(before: VoiceState, after: VoiceState): Promise<void> {
        await this.client.voiceService.Voice(before, after).catch(() => undefined);
    }
}
