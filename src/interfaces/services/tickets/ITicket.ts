import { IMessageDoc } from "../../builder/IMessageDoc";
import {
    PanelStyle,
    TicketAction,
    TicketContact,
    TicketMessageKey,
    TicketPriority,
    TicketStatus,
    TicketSurface,
} from "../../../constants/Tickets";

/** Eine Öffnungs-Option: ein Knopf bzw. ein Eintrag im Auswahlmenü des Panels. */
export interface ITicketOption {
    /** Stabil über Umbenennungen hinweg - steht in der customId und am Ticket. */
    id: string;
    name: string;
    description: string;
    /** Unicode-Emoji oder ein Server-Emoji als <:name:id>. */
    emoji: string | null;
    /** Oberfläche "channel": die Kategorie, in der der Kanal entsteht. */
    categoryId: string | null;
    /** Oberfläche "forum": der Tag der Option. Legt der Bot selbst an. */
    tagId: string | null;
    /** Eigene Support-Rolle statt der allgemeinen. */
    supportRoleId: string | null;
    /** Eigene Eröffnungs-Nachricht statt der allgemeinen. */
    opened: IMessageDoc | null;
}

/** Die Forum-Tags, die der Bot selbst verwaltet. */
export interface ITicketTags {
    low: string | null;
    normal: string | null;
    high: string | null;
    claimed: string | null;
    closed: string | null;
}

export interface ITicketConfig {
    contact: TicketContact;
    surface: TicketSurface;
    style: PanelStyle;
    supportRoleId: string | null;
    forumId: string | null;
    /** Offene Tickets je User, 0 = ohne Grenze. */
    limit: number;
    /** Stunden nach dem Schließen, bis der Kanal verschwindet. 0 = nie. */
    deleteAfter: number;
    /** Die zuschaltbaren Aktionen; die fünf festen stehen nie hier. */
    actions: TicketAction[];
    options: ITicketOption[];
    messages: Record<TicketMessageKey, IMessageDoc>;
    tags: ITicketTags;
    panel: { channelId: string | null; messageId: string | null };
}

export interface ITicketNote {
    by: string;
    at: number;
    text: string;
}

/** Eine Zeile aus tickets, ausgepackt. */
export interface ITicket {
    id: number;
    guildId: string;
    number: number;
    optionId: string;
    openerId: string;
    contact: TicketContact;
    channelId: string | null;
    messageId: string | null;
    claimedBy: string | null;
    status: TicketStatus;
    priority: TicketPriority | null;
    slowmode: number;
    members: string[];
    notes: ITicketNote[];
    /** Wer vom Team gerade unter dem Team-Alias schreibt. */
    anonymous: string[];
    messages: number;
    reminderAt: number | null;
    deleteAt: number | null;
    createdAt: Date;
    closedAt: Date | null;
}
