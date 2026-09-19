import {
    AutocompleteInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    GuildMember,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { InfoCard } from "../../builder/CommunityView";
import { FormatDuration, ParseDuration } from "../../constants/Moderation";
import { MAX_QUESTION } from "../../constants/Polls";
import { PollError, POLLS_MODULE } from "../../services/PollService";
import logger from "../../utils/logger";

const PRESETS: [string, number][] = [
    ["1 Stunde", 3_600],
    ["6 Stunden", 21_600],
    ["1 Tag", 86_400],
    ["3 Tage", 259_200],
    ["1 Woche", 604_800],
    ["2 Wochen", 1_209_600],
];

/** Eine Umfrage aus Discord heraus - schnell, ohne Dashboard. Mehr Einstellungen gibt es dort. */
export default class Poll extends Command {
    constructor(client: BotClient) {
        super(client, { name: "umfrage", description: "Startet oder beendet eine Umfrage", category: Category.Admin, cooldown: 5, developerOnly: false });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addSubcommand((sub) =>
                sub
                    .setName("erstellen")
                    .setDescription("Startet eine Umfrage")
                    .addStringOption((option) => option.setName("frage").setDescription("Die Frage").setRequired(true).setMaxLength(MAX_QUESTION))
                    .addStringOption((option) =>
                        option.setName("antworten").setDescription("Zwei bis zehn Antworten, getrennt mit | – etwa: Ja | Nein | Vielleicht").setRequired(true).setMaxLength(1000)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("art")
                            .setDescription("Eigene Umfrage mit Knöpfen oder Discords Umfrage")
                            .addChoices({ name: "Eigene mit Knöpfen (Balken, anonym möglich)", value: "buttons" }, { name: "Discord-Umfrage", value: "native" })
                    )
                    .addStringOption((option) => option.setName("dauer").setDescription("Wie lange? Etwa 1h, 3d – leer: ohne Ende (Discord: 1 Tag)").setAutocomplete(true))
                    .addBooleanOption((option) => option.setName("mehrfach").setDescription("Mehrere Antworten erlaubt"))
                    .addBooleanOption((option) => option.setName("anonym").setDescription("Niemand sieht, wer was gewählt hat (nur eigene)"))
                    .addChannelOption((option) =>
                        option
                            .setName("kanal")
                            .setDescription("Wohin? Ohne Angabe hierher")
                            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread)
                    )
            )
            .addSubcommand((sub) =>
                sub
                    .setName("beenden")
                    .setDescription("Beendet eine laufende Umfrage")
                    .addIntegerOption((option) => option.setName("nummer").setDescription("Welche Umfrage (#)?").setRequired(true).setMinValue(1))
            );
    }

    async AutoComplete(interaction: AutocompleteInteraction): Promise<void> {
        const typed = interaction.options.getFocused().trim().toLowerCase();
        const parsed = typed ? ParseDuration(typed) : null;
        const choices = [
            ...(parsed ? [{ name: FormatDuration(parsed), value: `${parsed}s` }] : []),
            ...PRESETS.filter(([name]) => !typed || name.toLowerCase().includes(typed)).map(([name, seconds]) => ({ name, value: `${seconds}s` })),
        ];

        await interaction.respond(choices.slice(0, 25)).catch(() => undefined);
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const guild = interaction.guild;
        const say = (text: string, accent?: string) =>
            interaction.deferred || interaction.replied
                ? interaction.editReply({ ...InfoCard(text, accent), flags: MessageFlags.IsComponentsV2 })
                : interaction.reply({ ...InfoCard(text, accent), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

        if (!guild) return void (await say("Nur auf einem Server."));
        if (!this.client.databaseService.Ready) return void (await say("Die Datenbank ist gerade nicht erreichbar.", "#ff4d5e"));
        if (!(await this.client.settings.Of(guild.id)).modules.includes(POLLS_MODULE)) {
            return void (await say("Das Modul Umfragen ist aus – einschalten im Dashboard oder mit `/module an modul:polls`.", "#ffc53d"));
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (interaction.options.getSubcommand() === "beenden") {
                const poll = await this.client.polls.ByNumber(guild.id, interaction.options.getInteger("nummer", true));

                if (!poll) throw new PollError("Diese Umfrage gibt es hier nicht.");
                if (poll.status === "ended") throw new PollError(`Umfrage #${poll.number} ist schon beendet.`);

                await this.client.pollService.End(poll);
                await say(`✅ Umfrage #${poll.number} ist beendet – das Ergebnis steht in der Nachricht.`);

                return;
            }

            const text = interaction.options.getString("dauer");
            const seconds = text ? ParseDuration(text) : null;

            if (text && seconds === null) throw new PollError(`„${text}“ verstehe ich nicht als Dauer – etwa 1h, 3d oder 1w.`);

            const kind = interaction.options.getString("art") === "native" ? "native" : "buttons";
            const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(interaction.user.id);
            const poll = await this.client.pollService.Create(guild, member, {
                kind,
                channelId: interaction.options.getChannel("kanal")?.id ?? interaction.channelId,
                question: interaction.options.getString("frage", true),
                options: interaction.options
                    .getString("antworten", true)
                    .split(/[|;\n]/)
                    .map((label) => label.trim())
                    .filter(Boolean),
                settings: { multi: interaction.options.getBoolean("mehrfach") ?? false, anonymous: interaction.options.getBoolean("anonym") ?? false },
                duration: seconds ?? (kind === "native" ? 86_400 : null),
            });

            await say(`📊 Umfrage #${poll.number} läuft in <#${poll.channelId}>.`);
        } catch (error) {
            if (!(error instanceof PollError)) logger.error("📊 /umfrage fehlgeschlagen", error);

            await say(error instanceof PollError ? `❌ ${error.message}` : "❌ Da ging etwas schief.", "#ff4d5e");
        }
    }
}
