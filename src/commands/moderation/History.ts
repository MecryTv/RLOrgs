import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { HistoryView } from "../../builder/ModerationView";
import { DASHBOARD_PATH } from "../../constants/Dashboard";
import { ModerationError } from "../../services/ModerationService";
import { Fail, MemberOf, ModSay } from "../../utils/modcommand";

/** Die letzten Fälle eines Users - der ganze Verlauf steht im Dashboard. */
export default class History extends Command {
    constructor(client: BotClient) {
        super(client, { name: "verlauf", description: "Zeigt die Moderations-Fälle eines Users", category: Category.Moderation, cooldown: 3, developerOnly: false });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .addUserOption((option) => option.setName("user").setDescription("Wessen Verlauf?").setRequired(true));
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const member = await MemberOf(interaction);

            if (!this.client.databaseService.Ready) throw new ModerationError("Die Datenbank ist gerade nicht erreichbar.");
            if (!(await this.client.moderationService.CanView(member))) throw new ModerationError("Den Verlauf sieht nur das Moderations-Team.");

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const user = interaction.options.getUser("user", true);
            const guildId = member.guild.id;
            const [cases, counts] = await Promise.all([
                this.client.modCases.List(guildId, { targetId: user.id }, null, 10),
                this.client.modCases.CountsOf(guildId, user.id),
            ]);
            const link = `${this.client.server.BaseURL}${DASHBOARD_PATH}/guild/${guildId}/moderation?user=${user.id}`;

            await ModSay(interaction, HistoryView(user.username, cases, counts, link));
        } catch (error) {
            await Fail(interaction, error, "verlauf");
        }
    }
}
