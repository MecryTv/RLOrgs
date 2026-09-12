import { Events, VoiceState } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";

export default class ActivityVoice extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.VoiceStateUpdate,
            description: "Zählt die Zeit im Sprachkanal für die Server-Übersicht",
            once: false,
        });
    }

    async Execute(before: VoiceState, after: VoiceState): Promise<void> {
        this.client.activityService.Voice(before, after);
    }
}
