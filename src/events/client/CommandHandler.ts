import { Collection, Events, Interaction } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import Command from "../../structures/Command";
import ComponentV2Builder from "../../builder/ComponentV2Builder";
import logger from "../../utils/logger";

export default class CommandHandler extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.InteractionCreate,
            description: "CommandHandler Event",
            once: false,
        });
    }

    async Execute(interaction: Interaction): Promise<void> {
        if (interaction.isAutocomplete()) {
            const target = this.client.commands.get(interaction.commandName);

            await target?.AutoComplete(interaction).catch((error) =>
                logger.warn(`[CommandHandler] AutoComplete /${interaction.commandName} fehlgeschlagen: ${error}`)
            );

            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const command: Command | undefined = this.client.commands.get(interaction.commandName);

        if (!command) {
            await interaction.reply(
                new ComponentV2Builder({ accentColor: "Red" })
                    .title("❌ | Unknown Command")
                    .separator()
                    .text("This command does not exist.")
                    .toMessage({ ephemeral: true })
            );

            return;
        }

        if (command.developerOnly && !this.client.config.DEV_USER_IDs.includes(interaction.user.id)) {
            await interaction.reply(
                new ComponentV2Builder({ accentColor: "Red" })
                    .title("⚠️ | Developer Command")
                    .separator()
                    .text("This command is only available to the bot developers.")
                    .toMessage({ ephemeral: true })
            );

            return;
        }

        const { cooldowns } = this.client;
        if (!cooldowns.has(command.name)) cooldowns.set(command.name, new Collection());

        const now = Date.now();
        const timestamps = cooldowns.get(command.name)!;
        const cooldownAmount = (command.cooldown || 3) * 1000;
        const expiresAt = (timestamps.get(interaction.user.id) || 0) + cooldownAmount;

        if (timestamps.has(interaction.user.id) && now < expiresAt) {
            const remaining = ((expiresAt - now) / 1000).toFixed(1);

            await interaction.reply(
                new ComponentV2Builder({ accentColor: "Yellow" })
                    .title("⚠️ | Command Cooldown")
                    .separator()
                    .text(`Please wait another \`${remaining}\` seconds before run this command again.`)
                    .toMessage({ ephemeral: true })
            );

            return;
        }

        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

        try {
            await command.Execute(interaction);
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            await this.client.guardian.ReportError(normalized, interaction, `Command Error: /${command.name}`);
        }
    }
}
