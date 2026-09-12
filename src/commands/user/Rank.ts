import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    MessageFlags,
    SlashCommandBuilder,
} from "discord.js";
import BotClient from "../../client/BotClient";
import Command from "../../structures/Command";
import Category from "../../enums/Category";
import { IPrimeProfile } from "../../interfaces/services/prime/IPrimeService";
import { RenderRankCard } from "../../builder/RankCard";
import { LINK_COOLDOWN, LINK_COOLDOWN_DAYS, LINK_COOLDOWN_DEV } from "../../constants/Database";
import { TrackerURL } from "../../constants/Prime";
import { PrimeError } from "../../services/PrimeService";
import { EpicAdopt } from "../../utils/epic";
import logger from "../../utils/logger";

const MAX_NAME = 64;

/** Im Entwicklungsmodus zehn Sekunden statt der vollen Frist - sonst nicht testbar. */
function cooldownOf(client: BotClient): number {
    return client.developerMode ? LINK_COOLDOWN_DEV : LINK_COOLDOWN;
}

/** "in 12 Tagen", "in 3 Stunden" - grob reicht, es geht um die Größenordnung. */
function waitLabel(ms: number): string {
    const days = Math.ceil(ms / 86_400_000);

    if (days > 1) return `${days} Tagen`;

    const hours = Math.ceil(ms / 3_600_000);

    if (hours > 1) return `${hours} Stunden`;

    return `${Math.max(1, Math.ceil(ms / 60_000))} Minuten`;
}

/**
 * Rang-Karte als Discord-Command.
 *
 *   /rank link <name>    verbindet das Epic-Konto mit dem Discord-Konto
 *   /rank unlink         trennt es wieder
 *   /rank me             die eigene Karte, über die Verknüpfung
 *   /rank search <name>  die Karte zu einem beliebigen Epic-Namen
 *
 * Nichts davon hängt an einer Guild: die Verknüpfung steht unter der Discord-ID
 * allein (player_accounts hat keine guild_id), und der Befehl ist global
 * registriert. Er funktioniert damit auf jedem Server, auf dem der Bot ist.
 *
 * Gerendert wird mit @napi-rs/canvas (siehe builder/RankCard.ts). Das dauert je
 * nach Bildern eine knappe Sekunde, deshalb wird jede Antwort vorher verzögert -
 * ohne das läuft die Interaktion in Discords Drei-Sekunden-Fenster.
 */
export default class Rank extends Command {
    constructor(client: BotClient) {
        super(client, {
            name: "rank",
            description: "Rocket-League-Ränge als Karte: eigene, fremde oder Konto verknüpfen",
            category: Category.User,
            cooldown: 10,
            developerOnly: false,
        });

        this.data = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .addSubcommand((sub) =>
                sub
                    .setName("link")
                    .setDescription("Verbindet dein Epic-Konto mit deinem Discord-Konto")
                    .addStringOption((option) =>
                        option
                            .setName("epicname")
                            .setDescription("Dein Epic Games Name - genau wie im Spiel geschrieben")
                            .setRequired(true)
                            .setMaxLength(MAX_NAME)
                    )
            )
            .addSubcommand((sub) =>
                sub
                    .setName("unlink")
                    .setDescription(`Trennt dein Epic-Konto wieder - frühestens ${LINK_COOLDOWN_DAYS} Tage nach dem Verbinden`)
            )
            .addSubcommand((sub) => sub.setName("me").setDescription("Zeigt deine eigenen Ränge"))
            .addSubcommand((sub) =>
                sub
                    .setName("search")
                    .setDescription("Zeigt die Ränge zu einem Epic-Namen")
                    .addStringOption((option) =>
                        option
                            .setName("epicname")
                            .setDescription("Der Epic Games Name - genau wie im Spiel geschrieben")
                            .setRequired(true)
                            .setMaxLength(MAX_NAME)
                    )
            );
    }

    async Execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.client.primeService.IsConfigured) {
            await interaction.reply({
                content: "Das Rang-Tracking ist auf diesem Server nicht eingerichtet.",
                flags: MessageFlags.Ephemeral,
            });

            return;
        }

        switch (interaction.options.getSubcommand()) {
            case "link":
                return this.Link(interaction);
            case "unlink":
                return this.Unlink(interaction);
            case "me":
                return this.Me(interaction);
            default:
                return this.Search(interaction);
        }
    }

    /**
     * Holt ein Profil und übersetzt jeden Ausfall in einen Satz, den der Nutzer
     * versteht. null heißt: es wurde bereits geantwortet.
     */
    private async Fetch(interaction: ChatInputCommandInteraction, name: string): Promise<IPrimeProfile | null> {
        let profile: IPrimeProfile | null;

        try {
            profile = await this.client.primeService.Profile(name);
        } catch (error) {
            const prime = error instanceof PrimeError ? error : null;

            logger.warn(`🎮 Prime: ${prime ? `${prime.type} ${prime.message}` : String(error)}`);

            await interaction.editReply({ content: "Rocket League antwortet gerade nicht. Versuch es später noch einmal." });

            return null;
        }

        if (!profile) {
            await interaction.editReply({
                content: `Den Epic-Namen **${name}** gibt es nicht. Prüf die Schreibweise - genau wie im Spiel.`,
            });

            return null;
        }

        return profile;
    }

    /**
     * Der Knopf zum oeffentlichen Profil beim Tracker.
     *
     * Ein Link-Knopf, kein Klick-Ereignis: Discord oeffnet die Adresse selbst,
     * der Bot bekommt davon nichts mit und muss auch nichts mitschreiben. Er
     * bleibt deshalb gueltig, solange die Nachricht steht - auch nach einem
     * Neustart.
     */
    private TrackerRow(epicName: string): ActionRowBuilder<ButtonBuilder> {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Beim Tracker ansehen")
                .setEmoji("🔗")
                .setURL(TrackerURL(epicName))
        );
    }

    /** Zeichnet die Karte und hängt sie an die Antwort. */
    private async Send(
        interaction: ChatInputCommandInteraction,
        profile: IPrimeProfile,
        discordName: string | null,
        avatarURL: string | null
    ): Promise<void> {
        const started = Date.now();
        const png = await RenderRankCard({ profile, discordName, avatarURL });

        logger.info(`🖼️  Rang-Karte für ${profile.name} in ${Date.now() - started} ms`);

        const file = new AttachmentBuilder(png, { name: `rank-${profile.accountId}.png` });

        await interaction.editReply({ files: [file], components: [this.TrackerRow(profile.name)] });
    }

    /* ------------------------------------------------------------------
       /rank link
       ------------------------------------------------------------------ */
    private async Link(interaction: ChatInputCommandInteraction): Promise<void> {
        const name = (interaction.options.getString("epicname", true) ?? "").trim();

        if (!name) {
            await interaction.reply({ content: "Kein gültiger Epic-Name.", flags: MessageFlags.Ephemeral });

            return;
        }

        if (!this.client.databaseService.Ready) {
            await interaction.reply({
                content: "Ohne Datenbank lässt sich nichts verknüpfen - die Verknüpfung steht dort.",
                flags: MessageFlags.Ephemeral,
            });

            return;
        }

        // Nur der Nutzer selbst soll sehen, welches Konto er verbindet.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const userId = interaction.user.id;
        const windowMs = cooldownOf(this.client);
        const current = await this.client.accounts.On(userId, "epic");
        const cooldown = await this.client.accounts.Cooldown(userId, "epic", windowMs);

        // Derselbe Name noch einmal ist keine Änderung - das darf die Sperre nicht treffen.
        const same = current?.display_name?.toLowerCase() === name.toLowerCase();

        if (!cooldown.open && !same) {
            await interaction.editReply({
                content:
                    `Dein Epic-Konto lässt sich nur alle ${LINK_COOLDOWN_DAYS} Tage wechseln. ` +
                    `Wieder möglich in **${waitLabel(cooldown.waitMs)}**.`,
            });

            return;
        }

        // Erst prüfen, dann verknüpfen: einen Namen, den es nicht gibt, speichert
        // der Bot gar nicht erst.
        const profile = await this.Fetch(interaction, name);

        if (!profile) return;

        await EpicAdopt(this.client, userId, profile);

        logger.user(`🎮 Epic verknüpft: ${userId} → ${profile.name} (${profile.accountId})`);

        // Was geprueft wurde, gehoert in die Antwort. Der Name geht gegen Rocket
        // League, bevor irgendetwas gespeichert wird - aber wenn davon nichts zu
        // sehen ist, bleibt fuer den Nutzer offen, ob er sich vertippt und
        // trotzdem etwas verbunden hat.
        const found = profile.ranks
            .filter((rank) => !rank.placement && rank.mmr > 0)
            .map((rank) => `${rank.key} ${rank.tierName} (${rank.mmr})`);

        await interaction.editReply({
            content:
                `**${profile.name}** ist jetzt mit deinem Discord-Konto verbunden.\n` +
                `Bei Rocket League gefunden: ${found.length > 0 ? found.join(" · ") : "noch keine gewerteten Ränge"}\n` +
                `Mit \`/rank me\` siehst du deine Karte.` +
                (same ? "" : `\nEin Wechsel ist erst in ${LINK_COOLDOWN_DAYS} Tagen wieder möglich.`),
            components: [this.TrackerRow(profile.name)],
        });
    }

    /* ------------------------------------------------------------------
       /rank unlink
       ------------------------------------------------------------------ */
    /**
     * Trennt die Verknüpfung wieder.
     *
     * Dieselbe Frist wie beim Wechseln, und das ist kein Zufall: Cooldown()
     * rechnet gegen changed_at in der Zeile, und Unlink() löscht genau diese
     * Zeile. Ohne die Sperre hier wäre trennen und neu verbinden ein Weg, die
     * Wartezeit einfach zu überspringen.
     */
    private async Unlink(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.client.databaseService.Ready) {
            await interaction.reply({
                content: "Ohne Datenbank gibt es nichts zu trennen - die Verknüpfung steht dort.",
                flags: MessageFlags.Ephemeral,
            });

            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const userId = interaction.user.id;
        const current = await this.client.accounts.On(userId, "epic");

        if (!current) {
            await interaction.editReply({ content: "Du hast gar kein Epic-Konto verbunden." });

            return;
        }

        const cooldown = await this.client.accounts.Cooldown(userId, "epic", cooldownOf(this.client));

        if (!cooldown.open) {
            await interaction.editReply({
                content:
                    `**${current.display_name ?? current.account_id}** ist noch gesperrt. ` +
                    `Trennen geht wieder in **${waitLabel(cooldown.waitMs)}**.
` +
                    `Die Frist gilt auch fürs Trennen — sonst wäre sie mit einem Zwischenschritt umgangen.`,
            });

            return;
        }

        await this.client.accounts.Unlink(userId, "epic");

        logger.user(`🎮 Epic getrennt: ${userId} (war ${current.display_name ?? current.account_id})`);

        await interaction.editReply({
            content:
                `**${current.display_name ?? current.account_id}** ist nicht mehr mit deinem Discord-Konto verbunden. ` +
                `Mit \`/rank link <EpicName>\` verbindest du ein anderes.`,
        });
    }

    /* ------------------------------------------------------------------
       /rank me
       ------------------------------------------------------------------ */
    private async Me(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.client.databaseService.Ready) {
            await interaction.reply({
                content: "Ohne Datenbank kenne ich keine Verknüpfungen. Nimm solange `/rank search`.",
                flags: MessageFlags.Ephemeral,
            });

            return;
        }

        const account = await this.client.accounts.On(interaction.user.id, "epic");

        if (!account) {
            await interaction.reply({
                content: "Du hast noch kein Epic-Konto verbunden. Mach das einmal mit `/rank link <EpicName>`.",
                flags: MessageFlags.Ephemeral,
            });

            return;
        }

        await interaction.deferReply();

        // Über die Konto-ID statt über den Namen: ein Spieler kann sich im Spiel
        // umbenennen, die ID bleibt.
        const profile = await this.Fetch(interaction, account.account_id);

        if (!profile) return;

        await this.Send(
            interaction,
            profile,
            interaction.user.username,
            interaction.user.displayAvatarURL({ extension: "png", size: 256 })
        );
    }

    /* ------------------------------------------------------------------
       /rank search
       ------------------------------------------------------------------ */
    private async Search(interaction: ChatInputCommandInteraction): Promise<void> {
        const name = (interaction.options.getString("epicname", true) ?? "").trim();

        if (!name) {
            await interaction.reply({ content: "Kein gültiger Epic-Name.", flags: MessageFlags.Ephemeral });

            return;
        }

        await interaction.deferReply();

        const profile = await this.Fetch(interaction, name);

        if (!profile) return;

        // Steht hinter dem Epic-Konto ein Discord-Nutzer, der es hier verknüpft
        // hat, wird sein Name mitgezeigt - sonst bleibt die Karte anonym.
        const owner = this.client.databaseService.Ready
            ? await this.client.accounts.Owner("epic", profile.accountId)
            : null;

        const member = owner ? await this.client.users.fetch(owner).catch(() => null) : null;

        await this.Send(
            interaction,
            profile,
            member?.username ?? null,
            member?.displayAvatarURL({ extension: "png", size: 256 }) ?? null
        );
    }
}
