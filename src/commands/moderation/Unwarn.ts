import { AutocompleteInteraction, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { MAX_REASON } from "../../constants/Moderation";
import { RunAction } from "../../utils/modcommand";

/** Nimmt eine Verwarnung zurück: einen bestimmten Fall oder die neueste des Users. */
export default class Unwarn extends Command {
    constructor(client: BotClient) {
        super(client, { name: "unwarn", description: "Nimmt eine Verwarnung zurück", category: Category.Moderation, cooldown: 3, developerOnly: false });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .addUserOption((option) => option.setName("user").setDescription("Seine neueste Verwarnung – oder wähle unten den Fall"))
            .addIntegerOption((option) => option.setName("fall").setDescription("Welche Verwarnung genau?").setMinValue(1).setAutocomplete(true))
            .addStringOption((option) => option.setName("grund").setDescription("Warum?").setMaxLength(MAX_REASON));
    }

    /** Die aktiven Verwarnungen - die des gewählten Users, sonst die neuesten des Servers. */
    async AutoComplete(interaction: AutocompleteInteraction): Promise<void> {
        if (!interaction.guildId || !this.client.databaseService.Ready) return;

        const userId = interaction.options.get("user")?.value;
        const typed = String(interaction.options.getFocused()).replace("#", "");
        const warns = await this.client.modCases.List(
            interaction.guildId,
            { action: "warn", active: true, targetId: typeof userId === "string" ? userId : null },
            null,
            25
        );

        await interaction
            .respond(
                warns
                    .filter((warn) => !typed || String(warn.number).startsWith(typed))
                    .map((warn) => ({
                        name: `#${warn.number} · ${warn.targetName ?? warn.targetId} – ${warn.reason ?? "ohne Grund"}`.slice(0, 100),
                        value: warn.number,
                    }))
            )
            .catch(() => undefined);
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await RunAction(this.client, interaction, () => ({
            action: "unwarn",
            targetId: interaction.options.getUser("user")?.id ?? null,
            caseNumber: interaction.options.getInteger("fall"),
            reason: interaction.options.getString("grund"),
        }));
    }
}
