import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { MAX_REASON } from "../../constants/Moderation";
import { RunAction } from "../../utils/modcommand";

/** Verwarnt einen User. Erreicht er eine Stufe (Einstellungen im Dashboard), folgt die Strafe von selbst. */
export default class Warn extends Command {
    constructor(client: BotClient) {
        super(client, { name: "warn", description: "Verwarnt einen User", category: Category.Moderation, cooldown: 3, developerOnly: false });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .addUserOption((option) => option.setName("user").setDescription("Wen?").setRequired(true))
            .addStringOption((option) =>
                option.setName("grund").setDescription("Warum? Steht im Log und in der DM").setRequired(true).setMaxLength(MAX_REASON)
            );
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await RunAction(this.client, interaction, () => ({
            action: "warn",
            targetId: interaction.options.getUser("user", true).id,
            reason: interaction.options.getString("grund", true),
        }));
    }
}
