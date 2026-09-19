import { Events, Message, MessageFlags } from "discord.js";
import { LRUCache } from "lru-cache";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import { GuildPickerView, InfoView } from "../../builder/TicketPanel";

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

    /**
     * Eine DM an den Bot: entweder läuft schon ein Ticket, oder der Bot fragt erst
     * nach dem Server, dann nach dem Thema - auch wenn es nur eins davon gibt.
     * Was der User bis dahin schreibt, landet danach im Ticket.
     */
    private async Direct(message: Message): Promise<void> {
        const service = this.client.ticketService;

        if (await service.OnDirectMessage(message)) return;

        const guilds = await service.ModMailGuildsFor(message.author);

        if (guilds.length === 0) {
            if (this.told.get(message.author.id)) return;

            this.told.set(message.author.id, true);

            await message
                .reply({
                    ...InfoView("Hier läuft kein ModMail. Öffne dein Ticket auf dem Server über das Ticket-Panel."),
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { repliedUser: false },
                })
                .catch(() => undefined);

            return;
        }

        // Die Auswahl steht schon weiter oben - die Nachricht ist gemerkt.
        if (!service.AskServer(message.author.id)) {
            await message.react("📝").catch(() => undefined);

            return;
        }

        await message
            .reply({ ...GuildPickerView(guilds), flags: MessageFlags.IsComponentsV2, allowedMentions: { repliedUser: false } })
            .catch(() => undefined);
    }
}
