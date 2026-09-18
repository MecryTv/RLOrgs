import { Events, Message, MessageFlags } from "discord.js";
import { LRUCache } from "lru-cache";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import ComponentV2Builder from "../../builder/ComponentV2Builder";
import { OptionPickerView } from "../../builder/TicketPanel";
import { TicketError } from "../../services/TicketService";
import { TICKET_PREFIX } from "../../constants/Tickets";

/**
 * Nachrichten, die das Ticket-System angehen: die DM eines Users bei ModMail,
 * die Antwort des Teams auf der anderen Seite und der anonyme Modus im Ticket.
 */
export default class TicketMessages extends Event {
    // Wer schon gehört hat, dass hier kein ModMail läuft - nicht bei jeder Zeile neu.
    private told = new LRUCache<string, boolean>({ max: 500, ttl: 10 * 60_000 });

    constructor(client: BotClient) {
        super(client, {
            name: Events.MessageCreate,
            description: "ModMail-Relay, anonymer Modus und die Nachrichtenzahl eines Tickets",
            once: false,
        });
    }

    async Execute(message: Message): Promise<void> {
        if (message.author.bot || message.system) return;
        if (!this.client.databaseService.Ready) return;

        try {
            if (!message.inGuild()) {
                await this.Direct(message);

                return;
            }

            if (await this.client.ticketService.Knows(message.channelId)) {
                await this.client.ticketService.OnTicketMessage(message);
            }
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));

            await this.client.guardian.ReportError(normalized, null, "Ticket Message");
        }
    }

    /** Eine DM an den Bot: entweder läuft schon ein Ticket, oder wir bieten eins an. */
    private async Direct(message: Message): Promise<void> {
        const service = this.client.ticketService;

        if (await service.OnDirectMessage(message)) return;

        const guilds = await service.ModMailGuildsFor(message.author);

        if (guilds.length === 0) {
            if (this.told.get(message.author.id)) return;

            this.told.set(message.author.id, true);

            await message
                .reply("Hier läuft kein ModMail. Öffne dein Ticket auf dem Server über das Ticket-Panel.")
                .catch(() => undefined);

            return;
        }

        if (guilds.length === 1) {
            const config = await this.client.ticketSettings.Of(guilds[0].id);

            if (config.options.length === 1) {
                try {
                    const ticket = await service.Open(guilds[0], message.author, config.options[0].id);

                    await service.FlushPending(message.author, ticket);
                } catch (error) {
                    if (!(error instanceof TicketError)) throw error;

                    await message.reply(error.message).catch(() => undefined);
                }

                return;
            }

            await message
                .reply({ ...OptionPickerView(guilds[0], config), flags: MessageFlags.IsComponentsV2 })
                .catch(() => undefined);

            return;
        }

        await message
            .reply({
                components: [
                    new ComponentV2Builder({ accentColor: "#ff1e2d" })
                        .title("🎫 | Für welchen Server?", "Ich bin auf mehreren Servern, auf denen du schreiben kannst.")
                        .select({
                            customId: `${TICKET_PREFIX}:dmguild`,
                            placeholder: "Server wählen …",
                            options: guilds.map((guild) => ({ label: guild.name.slice(0, 100), value: guild.id })),
                        })
                        .build(),
                ],
                flags: MessageFlags.IsComponentsV2,
            })
            .catch(() => undefined);
    }
}
