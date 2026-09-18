import BotClient from "../client/BotClient";
import Runnable from "../structures/Runnable";
import TaskTypes from "../enums/TaskTypes";

/**
 * Meldet vereinbarte Termine und räumt geschlossene Tickets weg, deren Löschfrist
 * abgelaufen ist. Beides hängt an Zeitpunkten in der Datenbank - der Lauf selbst
 * merkt sich nichts.
 */
export default class TicketReminders extends Runnable {
    constructor(client: BotClient) {
        super(client, {
            name: "TicketReminders",
            description: "Erinnert an Ticket-Termine und löscht abgelaufene Ticket-Kanäle",
            type: TaskTypes.INTERVAL,
            expression: "1m",
        });
    }

    async Execute(): Promise<void> {
        await this.client.ticketService.RunDue();
    }
}
