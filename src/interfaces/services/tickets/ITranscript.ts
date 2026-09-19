import { APIEmbed } from "discord.js";
import { TicketContact } from "../../../constants/Tickets";

/** Wer eine Nachricht geschrieben hat - so, wie es beim Schließen aussah. */
export interface ITranscriptUser {
    id: string;
    name: string;
    avatar: string | null;
    bot: boolean;
    /** Farbe der höchsten Rolle, null ohne Farbe. */
    color: string | null;
    /** Team (true) oder User (false) - fehlt in älteren Transcripts und bei Webhooks. */
    team?: boolean;
}

export interface ITranscriptFile {
    name: string;
    size: number;
    type: string | null;
    /** Die Discord-Adresse. Gesichert ist der Anhang, wenn media ihn kennt. */
    url: string;
    width: number | null;
    height: number | null;
    spoiler: boolean;
    description: string | null;
}

export interface ITranscriptMessage {
    id: string;
    /** MessageType von Discord - 0 ist eine normale Nachricht, 19 eine Antwort. */
    type: number;
    author: ITranscriptUser;
    at: number;
    edited: number | null;
    content: string;
    /** Die Nachricht, auf die geantwortet wird. */
    reply: string | null;
    embeds: APIEmbed[];
    /** Die Komponenten als JSON, wie Discord sie schickt - klassische Reihen oder Components V2. */
    components: unknown[];
    files: ITranscriptFile[];
    stickers: { name: string; url: string }[];
    reactions: { emoji: string; count: number }[];
}

/** Was die Liste im Dashboard und der Kopf des Transcripts zeigen. */
export interface ITranscriptMeta {
    optionId: string;
    option: string;
    contact: TicketContact;
    /** Die feste User-ID des Erstellers (ohne "U-") - fehlt in älteren Transcripts. */
    openerCode?: string | null;
    opener: ITranscriptUser;
    claimer: ITranscriptUser | null;
    closer: ITranscriptUser | null;
    reason: string | null;
    /** Hinzugefügte User - sie dürfen das Transcript wie der Ersteller öffnen. */
    members: string[];
    openedAt: number;
    closedAt: number;
    messages: number;
    files: number;
    /** Alle, die geschrieben haben (ohne Bots), höchstens 20. */
    participants: ITranscriptUser[];
}

export interface ITranscript {
    version: 1;
    ticketId: number;
    number: number;
    /** Das Kürzel des Tickets (SUP) - fehlt in älteren Transcripts. */
    code?: string | null;
    guild: { id: string; name: string; icon: string | null };
    channel: { id: string; name: string };
    meta: ITranscriptMeta;
    messages: ITranscriptMessage[];
    /** Namen zu Erwähnungen in Texten: <@id>, <@&id>, <#id>. */
    mentions: {
        users: Record<string, string>;
        roles: Record<string, { name: string; color: string | null }>;
        channels: Record<string, string>;
    };
    /** Gesicherte Anhänge: Pfad der Discord-Adresse -> Dateiname unter transcripts/. */
    media: Record<string, string>;
    /** Mehr Nachrichten als MAX_TRANSCRIPT_MESSAGES - die ältesten fehlen. */
    truncated: boolean;
}
