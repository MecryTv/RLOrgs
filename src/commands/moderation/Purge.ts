import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { MAX_PURGE, MAX_REASON } from "../../constants/Moderation";
import { RunAction } from "../../utils/modcommand";

/** Löscht die letzten Nachrichten in diesem Kanal - auf Wunsch nur die eines Users. */
export default class Purge extends Command {
    constructor(client: BotClient) {
        super(client, { name: "purge", description: "Löscht Nachrichten in diesem Kanal", category: Category.Moderation, cooldown: 5, developerOnly: false });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .addIntegerOption((option) =>
                option.setName("anzahl").setDescription(`Wie viele? 1 bis ${MAX_PURGE}`).setRequired(true).setMinValue(1).setMaxValue(MAX_PURGE)
            )
            .addUserOption((option) => option.setName("user").setDescription("Nur Nachrichten von diesem User"))
            .addStringOption((option) => option.setName("grund").setDescription("Warum?").setMaxLength(MAX_REASON));
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await RunAction(this.client, interaction, () => ({
            action: "purge",
            count: interaction.options.getInteger("anzahl", true),
            channelId: interaction.channelId,
            targetId: interaction.options.getUser("user")?.id ?? null,
            reason: interaction.options.getString("grund"),
        }));
    }
}
