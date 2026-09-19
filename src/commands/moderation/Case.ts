import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { DetailView } from "../../builder/ModerationView";
import { CaseRef, MAX_NOTE } from "../../constants/Moderation";
import { ModerationError } from "../../services/ModerationService";
import { ActorOf, Fail, MemberOf, ModSay } from "../../utils/modcommand";

/** Ein Fall: ansehen, Notiz dazu, Beweis dazu - auch Tage später. */
export default class Case extends Command {
    constructor(client: BotClient) {
        super(client, { name: "fall", description: "Zeigt einen Moderations-Fall oder ergänzt ihn", category: Category.Moderation, cooldown: 3, developerOnly: false });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .addSubcommand((sub) =>
                sub
                    .setName("zeigen")
                    .setDescription("Zeigt einen Fall mit Notizen und Beweisen")
                    .addIntegerOption((option) => option.setName("nummer").setDescription("Welcher Fall?").setRequired(true).setMinValue(1))
            )
            .addSubcommand((sub) =>
                sub
                    .setName("notiz")
                    .setDescription("Schreibt eine Notiz an einen Fall – nur das Team sieht sie")
                    .addIntegerOption((option) => option.setName("nummer").setDescription("Welcher Fall?").setRequired(true).setMinValue(1))
                    .addStringOption((option) => option.setName("text").setDescription("Die Notiz").setRequired(true).setMaxLength(MAX_NOTE))
            )
            .addSubcommand((sub) =>
                sub
                    .setName("beweis")
                    .setDescription("Hängt ein Bild oder einen Link als Beweis an einen Fall")
                    .addIntegerOption((option) => option.setName("nummer").setDescription("Welcher Fall?").setRequired(true).setMinValue(1))
                    .addAttachmentOption((option) => option.setName("bild").setDescription("Ein Screenshot – PNG, JPG, GIF oder WebP"))
                    .addStringOption((option) => option.setName("link").setDescription("Oder ein https-Link").setMaxLength(500))
            );
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const service = this.client.moderationService;
        const sub = interaction.options.getSubcommand();

        try {
            const member = await MemberOf(interaction);

            if (!this.client.databaseService.Ready) throw new ModerationError("Die Datenbank ist gerade nicht erreichbar.");
            if (!(await service.CanView(member))) throw new ModerationError("Die Fälle sieht nur das Moderations-Team.");

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const number = interaction.options.getInteger("nummer", true);
            let entry = await service.CaseOf(member.guild.id, number);

            if (sub === "notiz") {
                entry = await service.AddNote(member.guild.id, ActorOf(member), number, interaction.options.getString("text", true));
            }

            if (sub === "beweis") {
                const image = interaction.options.getAttachment("bild");
                const link = interaction.options.getString("link");

                if (!image && !link) throw new ModerationError(`Hänge ein Bild an oder gib einen Link an – dann landet er an Fall ${CaseRef(number)}.`);

                if (image) entry = await service.AddAttachment(member.guild.id, ActorOf(member), number, image);
                if (link) entry = await service.AddLink(member.guild.id, ActorOf(member), number, link);
            }

            await ModSay(interaction, DetailView(entry, service.Link(entry)));
        } catch (error) {
            await Fail(interaction, error, sub);
        }
    }
}
