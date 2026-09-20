import { IMessageDoc } from "../../builder/IMessageDoc";

/* ----------------------------------------------------------
   Custom Message - siehe docs/Messages.md
   ---------------------------------------------------------- */

/** Was ein Knopf unter der Nachricht tut. */
export type ButtonAction = "role" | "link" | "text";

export interface ICustomButton {
    /** Eindeutig je Nachricht - steht so in der Custom-ID. */
    id: string;
    label: string;
    emoji: string | null;
    tone: "primary" | "secondary" | "success" | "danger";
    action: ButtonAction;
    /** action "role": welche Rolle und was damit passiert. */
    roleId: string | null;
    mode: "toggle" | "add" | "remove";
    /** action "link": wohin. */
    url: string | null;
    /** action "text": was nur der Klickende zu sehen bekommt. */
    text: string | null;
}

export type ScheduleMode = "off" | "once" | "daily" | "weekly";

export interface ISchedule {
    mode: ScheduleMode;
    /** "once": der Zeitpunkt in Millisekunden. */
    at: number | null;
    /** "daily"/"weekly": Uhrzeit auf dem Server (Europe/Berlin). */
    hour: number;
    minute: number;
    /** "weekly": 0 ist Sonntag. */
    weekday: number;
    /** Wann es das nächste Mal rausgeht - der Lauf rechnet das aus. */
    next: number | null;
    /** Wiederkehrend: die alte Nachricht löschen, bevor die neue kommt. */
    replace: boolean;
}

export interface ICustomMessage {
    id: number;
    guildId: string;
    name: string;
    doc: IMessageDoc;
    buttons: ICustomButton[];
    channelId: string | null;
    messageId: string | null;
    schedule: ISchedule;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
}

/* ----------------------------------------------------------
   Autoresponder
   ---------------------------------------------------------- */
export type MatchMode = "contains" | "exact" | "starts" | "regex";

export interface IResponseSettings {
    /** Als Antwort auf die Nachricht statt als eigene. */
    reply: boolean;
    /** Die auslösende Nachricht löschen. */
    delete: boolean;
    /** Nur der Auslöser sieht die Antwort (nur bei "reply"). */
    quiet: boolean;
    /** Sekunden, bevor dasselbe Stichwort wieder zieht. */
    cooldown: number;
    /** Nur in diesen Kanälen (leer: überall). */
    channels: string[];
    /** Nur für diese Rollen (leer: alle). */
    roles: string[];
    /** Für diese Rollen nie. */
    ignoreRoles: string[];
}

export interface IAutoResponse {
    id: number;
    guildId: string;
    phrase: string;
    match: MatchMode;
    doc: IMessageDoc;
    settings: IResponseSettings;
    enabled: boolean;
    uses: number;
    createdBy: string;
    createdAt: number;
}
