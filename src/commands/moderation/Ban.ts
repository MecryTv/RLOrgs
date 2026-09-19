import { AutocompleteInteraction, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { DELETE_CHOICES, MAX_BAN, MAX_REASON } from "../../constants/Moderation";
import { ReadDuration, RunAction, SuggestDuration } from "../../utils/modcommand";

/**
 * Bannt einen User - auch jemanden, der gar nicht (mehr) auf dem Server ist.
 * Mit Dauer ein befristeter Bann, den der Bot selbst wieder aufhebt.
 *
 * Wie alle Moderations-Befehle ohne Standard-Rechte in Discord: sonst sähen ihn
 * Moderatoren von der Liste nicht, die das Discord-Recht selbst nicht haben.
 * Geprüft wird beim Ausführen (ModerationService.Allowed).
 */
export default class Ban extends Command {
    constructor(client: BotClient) {
        super(client, { name: "ban", description: "Bannt einen User vom Server", category: Category.Moderation, cooldown: 3, developerOnly: false });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .addUserOption((option) => option.setName("user").setDescription("Wen?").setRequired(true))
            .addStringOption((option) => option.setName("grund").setDescription("Warum? Steht im Log und in der DM").setMaxLength(MAX_REASON))
            .addStringOption((option) =>
                option.setName("dauer").setDescription("Befristet, etwa 3d oder 1w – leer bleibt er dauerhaft").setAutocomplete(true)
            )
            .addIntegerOption((option) =>
                option
                    .setName("loeschen")
                    .setDescription("Seine Nachrichten der letzten … mitlöschen")
                    .addChoices(...DELETE_CHOICES.map(([value, name]) => ({ name, value })))
            );
    }

    async AutoComplete(interaction: AutocompleteInteraction): Promise<void> {
        await SuggestDuration(interaction, true, MAX_BAN);
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await RunAction(this.client, interaction, () => ({
            action: "ban",
            targetId: interaction.options.getUser("user", true).id,
            reason: interaction.options.getString("grund"),
            duration: ReadDuration(interaction.options.getString("dauer"), true),
            deleteSeconds: interaction.options.getInteger("loeschen") ?? 0,
        }));
    }
}
