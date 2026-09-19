import { AutocompleteInteraction, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { MAX_REASON } from "../../constants/Moderation";
import { RunAction } from "../../utils/modcommand";

/** Hebt einen Bann auf. Gebannte sind keine Mitglieder mehr - daher Text mit Vorschlägen aus der Bannliste. */
export default class Unban extends Command {
    constructor(client: BotClient) {
        super(client, { name: "unban", description: "Hebt einen Bann auf", category: Category.Moderation, cooldown: 3, developerOnly: false });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .addStringOption((option) => option.setName("user").setDescription("Name oder ID aus der Bannliste").setRequired(true).setAutocomplete(true))
            .addStringOption((option) => option.setName("grund").setDescription("Warum?").setMaxLength(MAX_REASON));
    }

    async AutoComplete(interaction: AutocompleteInteraction): Promise<void> {
        const guild = interaction.guild;
        const typed = interaction.options.getFocused().trim().toLowerCase();

        if (!guild) return;

        // Einmal holen, danach hält discord.js die Liste über die Ban-Events aktuell.
        if (guild.bans.cache.size === 0) await guild.bans.fetch({ limit: 1000 }).catch(() => null);

        const found = [...guild.bans.cache.values()]
            .filter((ban) => !typed || ban.user.id.startsWith(typed) || ban.user.username.toLowerCase().includes(typed))
            .slice(0, 25)
            .map((ban) => ({ name: `${ban.user.username} (${ban.user.id})`.slice(0, 100), value: ban.user.id }));

        await interaction.respond(found).catch(() => undefined);
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await RunAction(this.client, interaction, () => ({
            action: "unban",
            // Vorschlag gewählt: die ID. Selbst getippt: eine ID aus einer Erwähnung oder direkt.
            targetId: /\d{17,20}/.exec(interaction.options.getString("user", true))?.[0] ?? null,
            reason: interaction.options.getString("grund"),
        }));
    }
}
