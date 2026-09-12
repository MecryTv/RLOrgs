import { ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { NewPanelState, PanelStates, RenderPanel } from "../../builder/GalleryPanel";

export default class Gallery extends Command {
    constructor(client: BotClient) {
        super(client, {
            name: "gallery",
            description: "Öffnet die Bild-Verwaltung: ansehen, hochladen, verschieben, löschen",
            category: Category.Admin,
            cooldown: 5,
            developerOnly: false,
        });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guildId) return;

        const state = NewPanelState(interaction.guildId);
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
