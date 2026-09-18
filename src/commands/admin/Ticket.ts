import { ChannelType, ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import ComponentV2Builder from "../../builder/ComponentV2Builder";
import { NewSetupState, SetupStates, SetupView } from "../../builder/TicketSetupPanel";
import { TicketError } from "../../services/TicketService";
import { PANEL_STATES } from "../../constants/Tickets";

/**
 * Das Ticket-System ohne Dashboard einrichten: Assistent, Panel senden und eine
 * Sperre wieder aufheben. Geschrieben wird über denselben TicketService.
 */
export default class Ticket extends Command {
    constructor(client: BotClient) {
        super(client, {
            name: "ticket",
            description: "Richtet das Ticket-System ein",
            category: Category.Admin,
            cooldown: 5,
            developerOnly: false,
        });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addSubcommand((sub) => sub.setName("setup").setDescription("Öffnet den Einrichtungs-Assistenten"))
            .addSubcommand((sub) =>
                sub
                    .setName("panel")
                    .setDescription("Schickt das Ticket-Panel in einen Kanal")
                    .addChannelOption((option) =>
                        option
                            .setName("kanal")
                            .setDescription("Wohin? Ohne Angabe in diesen Kanal")
                            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    )
            )
            .addSubcommand((sub) =>
                sub
                    .setName("entsperren")
                    .setDescription("Hebt die Ticket-Sperre eines Users auf")
                    .addUserOption((option) => option.setName("user").setDescription("Wer darf wieder?").setRequired(true))
            );
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const guild = interaction.guild;

        if (!guild) return this.Say(interaction, "Red", "Nur auf einem Server", "Diesen Befehl gibt es nur auf einem Server.");

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return this.Say(interaction, "Red", "Keine Berechtigung", "Dafür brauchst du „Server verwalten“.");
        }

        if (!this.client.databaseService.Ready) {
            return this.Say(interaction, "Red", "Keine Datenbank", "Die Einstellungen stehen in der Datenbank – die erreiche ich gerade nicht.");
        }

        const sub = interaction.options.getSubcommand();

        try {
            if (sub === "setup") return await this.Setup(interaction);
            if (sub === "panel") return await this.Panel(interaction);
            if (sub === "entsperren") return await this.Unblock(interaction);
        } catch (error) {
            if (!(error instanceof TicketError)) throw error;

            await this.Say(interaction, "Red", "Das ging nicht", error.message);
        }
    }

    private async Setup(interaction: ChatInputCommandInteraction): Promise<void> {
        const guild = interaction.guild!;
        const state = NewSetupState(guild.id);

        if (!(await this.client.settings.Of(guild.id)).modules.includes("tickets")) {
            state.notice = "⚠️ Das Modul ist aus – einschalten mit `/module an modul:tickets`.";
        }

        const view = await SetupView(this.client, guild, state);
        const response = await interaction.reply({
            ...view,
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            withResponse: true,
        });

        const message = response.resource?.message;

        if (message) SetupStates.set(message.id, state);
    }

    private async Panel(interaction: ChatInputCommandInteraction): Promise<void> {
        const channel = interaction.options.getChannel("kanal") ?? interaction.channel;

        if (!channel) return this.Say(interaction, "Red", "Kein Kanal", "Sag mir, in welchen Kanal das Panel soll.");

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const { url, state } = await this.client.ticketService.SendPanel(interaction.guild!, channel.id);
        const told = PANEL_STATES[state];

        await interaction.editReply({
            ...new ComponentV2Builder({ accentColor: "#35e07f" })
                .title(`📮 | ${told.title}`)
                .separator()
                .text(`${told.text.replace("{channel}", `<#${channel.id}>`)}\n[Zur Nachricht](${url})`)
                .toMessage(),
            flags: MessageFlags.IsComponentsV2,
        });
    }

    private async Unblock(interaction: ChatInputCommandInteraction): Promise<void> {
        const user = interaction.options.getUser("user", true);
        const removed = await this.client.ticketBlacklist.Remove(interaction.guildId!, user.id);

        await this.Say(
            interaction,
            removed ? "Green" : "Yellow",
            removed ? "Sperre aufgehoben" : "Keine Sperre",
            removed ? `${user} kann wieder Tickets öffnen.` : `${user} war gar nicht gesperrt.`
        );
    }

    private async Say(
        interaction: ChatInputCommandInteraction,
        accent: string,
        title: string,
        text: string
    ): Promise<void> {
        const view = {
            ...new ComponentV2Builder({ accentColor: accent as "Red" }).title(title).separator().text(text).toMessage(),
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        };

        if (interaction.replied || interaction.deferred) await interaction.followUp(view);
        else await interaction.reply(view);
    }
}
