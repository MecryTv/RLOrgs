import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    GuildMember,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder,
} from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import ComponentV2Builder from "../../builder/ComponentV2Builder";
import { InfoCard } from "../../builder/CommunityView";
import { RenderLevelCard } from "../../builder/LevelCard";
import { LEVELS_ACCENT, LevelProgress } from "../../constants/Levels";
import { LEVELS_MODULE } from "../../services/LevelService";

const PER_PAGE = 10;

/**
 * Der eigene Stand als Karte und die Rangliste des Servers. /rank ist schon
 * vergeben - das sind die Rocket-League-Ränge, hier geht es um die Punkte des
 * Servers. Siehe docs/Levels.md.
 */
export default class Level extends Command {
    constructor(client: BotClient) {
        super(client, { name: "level", description: "Dein Level auf diesem Server und die Rangliste", category: Category.User, cooldown: 5, developerOnly: false });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .setContexts(InteractionContextType.Guild)
            .addSubcommand((sub) =>
                sub
                    .setName("rang")
                    .setDescription("Zeigt deinen Stand als Karte")
                    .addUserOption((option) => option.setName("user").setDescription("Wessen Stand? Ohne Angabe deiner"))
            )
            .addSubcommand((sub) =>
                sub
                    .setName("rangliste")
                    .setDescription("Die Besten des Servers")
                    .addIntegerOption((option) => option.setName("seite").setDescription("Welche Seite?").setMinValue(1).setMaxValue(10))
            );
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inCachedGuild()) return;

        const say = (text: string) => interaction.reply({ ...InfoCard(text, LEVELS_ACCENT), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

        if (!(await this.client.settings.Of(interaction.guildId)).modules.includes(LEVELS_MODULE)) {
            await say("Das Level System ist auf diesem Server aus.");

            return;
        }

        if (!this.client.databaseService.Ready) {
            await say("Ohne Datenbank gibt es keine Punkte.");

            return;
        }

        if (interaction.options.getSubcommand() === "rangliste") return this.Board(interaction);

        return this.Rank(interaction);
    }

    /** Die Karte - sie zu zeichnen dauert, deshalb vorher aufschieben. */
    private async Rank(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
        const target = (interaction.options.getMember("user") as GuildMember | null) ?? interaction.member;

        await interaction.deferReply();

        if (target.user.bot) {
            await interaction.editReply({ ...InfoCard("Bots sammeln keine Punkte.", LEVELS_ACCENT), flags: MessageFlags.IsComponentsV2 });

            return;
        }

        const { entry, rank, total, settings } = await this.client.levelService.Card(target);
        const progress = LevelProgress(entry.xp, settings.base);
        const png = await RenderLevelCard({
            name: target.displayName,
            avatarURL: target.displayAvatarURL({ extension: "png", size: 256 }),
            level: progress.level,
            xp: entry.xp,
            into: progress.into,
            need: progress.need,
            rank,
            total,
            messages: entry.messages,
            voiceMinutes: entry.voiceMinutes,
        });
        const file = new AttachmentBuilder(png, { name: "level.png" });
        const card = new ComponentV2Builder({ accentColor: LEVELS_ACCENT }).gallery("attachment://level.png").build();

        await interaction.editReply({ components: [card], files: [file], flags: MessageFlags.IsComponentsV2 });
    }

    private async Board(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
        const page = interaction.options.getInteger("seite") ?? 1;

        await interaction.deferReply();

        const top = await this.client.levels.Top(interaction.guildId, PER_PAGE, (page - 1) * PER_PAGE);

        if (!top.length) {
            await interaction.editReply({ ...InfoCard(page > 1 ? "So weit reicht die Liste nicht." : "Noch hat niemand Punkte gesammelt.", LEVELS_ACCENT), flags: MessageFlags.IsComponentsV2 });

            return;
        }

        const medal = ["🥇", "🥈", "🥉"];
        const lines = top.map((entry) => `${medal[entry.rank - 1] ?? `**${entry.rank}.**`} <@${entry.userId}> — Level **${entry.level}** · ${entry.xp.toLocaleString("de-DE")} Punkte`);
        const total = await this.client.levels.Total(interaction.guildId);
        const card = new ComponentV2Builder({ accentColor: LEVELS_ACCENT })
            .text(`## 📈 Rangliste von ${interaction.guild.name}`)
            .text(lines.join("\n"))
            .subtext(`Seite ${page} · ${total} Mitglieder mit Punkten`)
            .build();

        await interaction.editReply({ components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    }
}
