import { ICustomEmbed } from "../messages/IMessages";
import { IMessageDoc } from "../../builder/IMessageDoc";

/* ----------------------------------------------------------
   Welcome System - siehe docs/Welcome.md
   ---------------------------------------------------------- */

/** Was der Bot schickt: eine gezeichnete Karte, eine Karte im Components-V2-Stil, ein Embed oder reiner Text. */
export type WelcomeKind = "card" | "v2" | "embed" | "text";

/** Die gezeichnete Begrüßungskarte - jedes Stück einzeln einstellbar. */
export interface IWelcomeCard {
    /** Dateiname des hochgeladenen Hintergrunds, null: nur Farbverlauf. */
    background: string | null;
    /** Farbe für Balken, Rahmen und Linien. */
    accent: string;
    /** Wie stark das Hintergrundbild abgedunkelt wird (0-90). */
    dim: number;
    /** Die drei Zeilen - mit Platzhaltern. */
    title: string;
    subtitle: string;
    footer: string;
    /** Linksbündig oder mittig. */
    align: "left" | "center";
    /** Schriftgröße der Überschrift in Pixeln. */
    titleSize: number;
    /** Bausteine, die sich abschalten lassen. */
    avatar: boolean;
    avatarRing: boolean;
    /** Rund oder mit abgeschrägten Ecken wie im Dashboard. */
    avatarShape: "circle" | "bevel";
    count: boolean;
    icon: boolean;
    date: boolean;
}

/** Eine Nachricht des Moduls - Begrüßung oder Abschied. */
export interface IWelcomeMessage {
    on: boolean;
    channelId: string | null;
    kind: WelcomeKind;
    /** Text über der Karte bzw. dem Embed - bei "text" die ganze Nachricht. */
    content: string;
    embed: ICustomEmbed | null;
    doc: IMessageDoc;
    card: IWelcomeCard;
}

export interface IWelcomeConfig {
    join: IWelcomeMessage;
    leave: IWelcomeMessage;
    /** Rollen für neue Mitglieder. */
    roles: string[];
    /** Rollen für Bots, die jemand einlädt. */
    botRoles: string[];
}
