import { Events, Interaction, MessageFlags } from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import { GIVEAWAY_PREFIX } from "../../constants/Giveaways";
import { POLL_PREFIX } from "../../constants/Polls";
import logger from "../../utils/logger";

/**
 * Die Knöpfe von Umfragen und Giveaways: abstimmen, zurückziehen, mitmachen,
 * austragen und - in der DM - den Gewinn annehmen.
 */
export default class CommunityButtons extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.InteractionCreate,
            description: "Bedient die Knöpfe von Umfragen und Giveaways",
            once: false,
        });
    }

    async Execute(interaction: Interaction): Promise<void> {
        if (!interaction.isButton()) return;

        const [prefix, action, id, option] = interaction.customId.split(":");

        if (prefix !== POLL_PREFIX && prefix !== GIVEAWAY_PREFIX) return;

        try {
            if (!this.client.databaseService.Ready) {
                await interaction.reply({ content: "Der Bot erreicht gerade seine Datenbank nicht - versuch es gleich nochmal.", flags: MessageFlags.Ephemeral });

                return;
            }

            if (prefix === POLL_PREFIX && action === "vote") return await this.client.pollService.Vote(interaction, Number(id), option ?? null);
            if (prefix === POLL_PREFIX && action === "clear") return await this.client.pollService.Vote(interaction, Number(id), null);
            if (prefix === GIVEAWAY_PREFIX && action === "join") return await this.client.giveawayService.Join(interaction, Number(id));
            if (prefix === GIVEAWAY_PREFIX && action === "leave") return await this.client.giveawayService.Leave(interaction, Number(id));
            if (prefix === GIVEAWAY_PREFIX && action === "claim") return await this.client.giveawayService.Claim(interaction, Number(id));
        } catch (error) {
            logger.warn(`🎛️ ${interaction.customId} fehlgeschlagen - ${String(error)}`);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: "Da ging etwas schief - versuch es gleich nochmal.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
            }
        }
    }
}
