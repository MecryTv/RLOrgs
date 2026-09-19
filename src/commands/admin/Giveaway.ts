import {
    AutocompleteInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    GuildMember,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    SlashCommandSubcommandBuilder,
} from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { InfoCard } from "../../builder/CommunityView";
import { GIVEAWAY_ACCENT, MAX_PRIZE, MAX_WINNERS } from "../../constants/Giveaways";
import { FormatDuration, ParseDuration } from "../../constants/Moderation";
import { GiveawayError, GIVEAWAYS_MODULE } from "../../services/GiveawayService";
import logger from "../../utils/logger";

const PRESETS: [string, number][] = [
    ["30 Minuten", 1_800],
    ["1 Stunde", 3_600],
    ["12 Stunden", 43_200],
    ["1 Tag", 86_400],
    ["3 Tage", 259_200],
    ["1 Woche", 604_800],
    ["2 Wochen", 1_209_600],
];

/**
 * Giveaways aus Discord: starten, vorzeitig auslosen, neu auslosen, abbrechen.
 * Bedingungen, Bonus-Lose, Gewinner-Frist und geplante Starts gibt es im Dashboard.
 */
export default class Giveaway extends Command {
    constructor(client: BotClient) {
        super(client, { name: "giveaway", description: "Startet und verwaltet Giveaways", category: Category.Admin, cooldown: 5, developerOnly: false });

        const number = (sub: SlashCommandSubcommandBuilder) =>
            sub.addIntegerOption((option) => option.setName("nummer").setDescription("Welches Giveaway (#)?").setRequired(true).setMinValue(1));

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addSubcommand((sub) =>
                sub
                    .setName("start")
                    .setDescription("Startet ein Giveaway")
                    .addStringOption((option) => option.setName("preis").setDescription("Was gibt es zu gewinnen?").setRequired(true).setMaxLength(MAX_PRIZE))
                    .addStringOption((option) => option.setName("dauer").setDescription("Wie lange? Etwa 1h, 3d, 1w").setRequired(true).setAutocomplete(true))
                    .addIntegerOption((option) => option.setName("gewinner").setDescription("Wie viele Gewinner? Standard: 1").setMinValue(1).setMaxValue(MAX_WINNERS))
                    .addChannelOption((option) =>
                        option.setName("kanal").setDescription("Wohin? Ohne Angabe hierher").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    )
                    .addStringOption((option) => option.setName("beschreibung").setDescription("Ein paar Worte dazu").setMaxLength(1000))
                    .addRoleOption((option) => option.setName("rolle").setDescription("Nur mit dieser Rolle darf man mitmachen"))
                    .addRoleOption((option) => option.setName("ping").setDescription("Diese Rolle beim Start anpingen"))
            )
            .addSubcommand((sub) => number(sub.setName("beenden").setDescription("Lost jetzt aus, statt zu warten")))
            .addSubcommand((sub) =>
                number(sub.setName("neu").setDescription("Lost einen Gewinner neu aus")).addUserOption((option) =>
                    option.setName("user").setDescription("Wen ersetzen? Ohne Angabe: alle, die noch nicht angenommen haben")
                )
            )
            .addSubcommand((sub) => number(sub.setName("abbrechen").setDescription("Bricht ein Giveaway ohne Gewinner ab")));
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
        const say = (text: string, accent: string = GIVEAWAY_ACCENT) =>
            interaction.deferred || interaction.replied
                ? interaction.editReply({ ...InfoCard(text, accent), flags: MessageFlags.IsComponentsV2 })
                : interaction.reply({ ...InfoCard(text, accent), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

        if (!guild) return void (await say("Nur auf einem Server."));
        if (!this.client.databaseService.Ready) return void (await say("Die Datenbank ist gerade nicht erreichbar.", "#ff4d5e"));
        if (!(await this.client.settings.Of(guild.id)).modules.includes(GIVEAWAYS_MODULE)) {
            return void (await say("Das Modul Giveaways ist aus – einschalten im Dashboard oder mit `/module an modul:giveaways`."));
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const service = this.client.giveawayService;
        const sub = interaction.options.getSubcommand();

        try {
            if (sub === "start") {
                const text = interaction.options.getString("dauer", true);
                const seconds = ParseDuration(text);

                if (seconds === null) throw new GiveawayError(`„${text}“ verstehe ich nicht als Dauer – etwa 1h, 3d oder 1w.`);

                const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(interaction.user.id);
                const role = interaction.options.getRole("rolle");
                const ping = interaction.options.getRole("ping");
                const giveaway = await service.Create(guild, member, {
                    prize: interaction.options.getString("preis", true),
                    description: interaction.options.getString("beschreibung"),
                    channelId: interaction.options.getChannel("kanal")?.id ?? interaction.channelId,
                    winners: interaction.options.getInteger("gewinner") ?? 1,
                    duration: seconds,
                    requirements: role ? { roles: [role.id] } : {},
                    settings: { ping: ping?.id ?? null },
                });

                await say(`🎉 Giveaway #${giveaway.number} läuft in <#${giveaway.channelId}> – ausgelost wird <t:${Math.floor(giveaway.endsAt / 1000)}:R>.`);

                return;
            }

            const giveaway = await this.client.giveaways.ByNumber(guild.id, interaction.options.getInteger("nummer", true));

            if (!giveaway) throw new GiveawayError("Dieses Giveaway gibt es hier nicht.");

            if (sub === "beenden") {
                const done = await service.End(giveaway);
                const winners = done.results.winners.map((winner) => `<@${winner.userId}>`).join(", ");

                await say(winners ? `🎉 Ausgelost: ${winners}` : "Ausgelost – aber niemand erfüllt die Bedingungen.");
            } else if (sub === "neu") {
                const user = interaction.options.getUser("user");
                const done = await service.Reroll(giveaway, user?.id ?? "all");
                const fresh = done.results.winners.slice(giveaway.results.winners.length).map((winner) => `<@${winner.userId}>`);

                await say(fresh.length ? `🔄 Neu ausgelost: ${fresh.join(", ")}` : "Niemand mehr übrig, der die Bedingungen erfüllt.");
            } else {
                await service.Cancel(giveaway);
                await say(`Giveaway #${giveaway.number} ist abgebrochen.`, "#6b7683");
            }
        } catch (error) {
            if (!(error instanceof GiveawayError)) logger.error(`🎉 /giveaway ${sub} fehlgeschlagen`, error);

            await say(error instanceof GiveawayError ? `❌ ${error.message}` : "❌ Da ging etwas schief.", "#ff4d5e");
        }
    }
}
