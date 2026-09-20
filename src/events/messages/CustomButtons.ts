import { Events, Interaction, MessageFlags } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import { InfoCard } from "../../builder/CommunityView";
import { MESSAGE_ACCENT, MESSAGE_PREFIX } from "../../constants/Messages";
import { MessageError } from "../../services/MessageService";

/** Die Knöpfe unter einer eigenen Nachricht: Rolle, Link oder versteckter Text. */
export default class CustomButtons extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.InteractionCreate,
            description: "Bedient die Knöpfe unter eigenen Nachrichten",
            once: false,
        });
    }

    async Execute(interaction: Interaction): Promise<void> {
        if (!interaction.isButton() || !interaction.customId.startsWith(`${MESSAGE_PREFIX}:btn:`)) return;
        if (!interaction.inCachedGuild()) return;

        const [, , id, buttonId] = interaction.customId.split(":");

        try {
            await this.client.messageService.Button(interaction, Number(id), buttonId ?? "");
        } catch (error) {
            const text = error instanceof MessageError ? error.message : "Das hat nicht geklappt.";

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ ...InfoCard(text, MESSAGE_ACCENT), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => undefined);
            }

            if (!(error instanceof MessageError)) {
                const normalized = error instanceof Error ? error : new Error(String(error));

                await this.client.guardian.ReportError(normalized, interaction, `Custom-Message-Knopf: ${interaction.customId}`);
            }
        }
    }
}
