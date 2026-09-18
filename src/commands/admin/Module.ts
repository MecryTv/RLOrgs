import {
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import ComponentV2Builder from "../../builder/ComponentV2Builder";
import { IsModule, IsPermanent, MODULE_IDS } from "../../constants/Modules";

/**
 * Module an- und ausschalten, ohne das Dashboard. Dieselbe Liste, dieselbe
 * Spalte (guild_settings.modules) - nur ein anderer Weg dorthin.
 */
export default class Module extends Command {
    constructor(client: BotClient) {
        super(client, {
            name: "module",
            description: "Schaltet die Module dieses Servers an und aus",
            category: Category.Admin,
            cooldown: 3,
            developerOnly: false,
        });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addSubcommand((sub) =>
                sub
                    .setName("an")
                    .setDescription("Schaltet ein Modul ein")
                    .addStringOption((option) =>
                        option.setName("modul").setDescription("Welches Modul?").setRequired(true).setAutocomplete(true)
                    )
            )
            .addSubcommand((sub) =>
                sub
                    .setName("aus")
                    .setDescription("Schaltet ein Modul aus")
                    .addStringOption((option) =>
                        option.setName("modul").setDescription("Welches Modul?").setRequired(true).setAutocomplete(true)
                    )
            )
            .addSubcommand((sub) => sub.setName("liste").setDescription("Zeigt alle Module mit ihrem Stand"));
    }

    async AutoComplete(interaction: AutocompleteInteraction): Promise<void> {
        const typed = interaction.options.getFocused().toLowerCase();
        const on = interaction.guildId ? (await this.client.settings.Of(interaction.guildId)).modules : [];

        await interaction.respond(
            MODULE_IDS.filter((id) => id.includes(typed))
                .slice(0, 25)
                .map((id) => ({ name: `${on.includes(id) ? "✅" : "⬜"} ${id}`, value: id }))
        );
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const { guildId } = interaction;

        if (!guildId) {
            await this.Reply(interaction, "Red", "Nur auf einem Server", "Diesen Befehl gibt es nur auf einem Server.");

            return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await this.Reply(interaction, "Red", "Keine Berechtigung", "Dafür brauchst du „Server verwalten“.");

            return;
        }

        if (!this.client.databaseService.Ready) {
            await this.Reply(interaction, "Red", "Keine Datenbank", "Die Module stehen in der Datenbank – die erreiche ich gerade nicht.");

            return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "liste") return this.List(interaction, guildId);

        const moduleId = interaction.options.getString("modul", true);

        if (!IsModule(moduleId)) {
            await this.Reply(interaction, "Red", "Unbekanntes Modul", `\`${moduleId}\` gibt es nicht. \`/module liste\` zeigt alle.`);

            return;
        }

        const on = sub === "an";

        if (!on && IsPermanent(moduleId)) {
            await this.Reply(
                interaction,
                "Yellow",
                "Gehört fest dazu",
                `\`${moduleId}\` lässt sich nicht ausschalten – das Modul gehört fest zum Bot.`
            );

            return;
        }

        const modules = await this.client.settings.Toggle(guildId, moduleId, on);

        await this.Reply(
            interaction,
            on ? "Green" : "Grey",
            on ? "Modul eingeschaltet" : "Modul ausgeschaltet",
            `\`${moduleId}\` ist jetzt **${on ? "an" : "aus"}**.\n-# ${modules.length} Modul(e) laufen auf diesem Server.`
        );
    }

    private async List(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
        const on = new Set((await this.client.settings.Of(guildId)).modules);

        await interaction.reply({
            ...new ComponentV2Builder({ accentColor: "#ff1e2d" })
                .title("🧩 | Module", `${on.size} von ${MODULE_IDS.length} eingeschaltet`)
                .separator()
                .list(MODULE_IDS.map((id) => `${on.has(id) ? "✅" : "⬜"} \`${id}\`${IsPermanent(id) ? " 🔒" : ""}`))
                .subtext("🔒 gehört fest zum Bot. Ein- und ausschalten: `/module an` bzw. `/module aus`.")
                .toMessage(),
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    }

    private async Reply(
        interaction: ChatInputCommandInteraction,
        accent: string,
        title: string,
        text: string
    ): Promise<void> {
        await interaction.reply({
            ...new ComponentV2Builder({ accentColor: accent as "Red" }).title(title).separator().text(text).toMessage(),
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    }
}
