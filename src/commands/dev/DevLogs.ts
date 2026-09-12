import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { NewPanelState, PanelStates, RenderPanel } from "../../builder/DevLogsPanel";

export default class DevLogs extends Command {
    constructor(client: BotClient) {
        super(client, {
            name: "devlogs",
            description: "Zeigt und durchsucht die Session-Logs des Bots direkt in Discord",
            category: Category.Developer,
            cooldown: 5,
            developerOnly: true,
        });

        this.data = new SlashCommandBuilder().setName(this.name).setDescription(this.description);
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const state = NewPanelState();
        const view = await RenderPanel(this.client, state);

        const response = await interaction.reply({
            ...view,
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            withResponse: true,
        });

        const message = response.resource?.message;
        if (message) PanelStates.set(message.id, state);
    }
}
