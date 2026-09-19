/** Was ein Fall festhält - siehe docs/Moderation.md. */
export type ModAction = "ban" | "unban" | "kick" | "timeout" | "untimeout" | "warn" | "unwarn" | "purge";

/** Woher ein Fall kommt: ein Befehl in Discord, das Dashboard oder der Bot selbst (Stufen, Ablauf). */
export type ModSource = "discord" | "dashboard" | "auto";

/** Ab so vielen aktiven Verwarnungen passiert das hier - automatisch. */
export interface IModStage {
    warns: number;
    action: "timeout" | "kick" | "ban";
    /** Sekunden: Länge des Timeouts oder eines befristeten Banns. null beim Kick und beim dauerhaften Bann. */
    duration: number | null;
}

export interface IModConfig {
    /** Hierhin meldet der Bot jeden Fall - ein Textkanal oder ein Forum-Beitrag. null: nirgends. */
    logChannelId: string | null;
    /** Der Betroffene bekommt eine DM mit Grund und Dauer. */
    dm: boolean;
    /** So viele Tage zählt eine Verwarnung für die Stufen - 0: für immer. */
    warnDays: number;
    stages: IModStage[];
}

export interface IModEvidence {
    id: number;
    kind: "image" | "link";
    /** image: der gespeicherte Dateiname (3.png), link: die https-Adresse. */
    value: string;
    /** Der ursprüngliche Dateiname oder ein Titel für den Link. */
    name: string | null;
    by: string;
    byName: string;
    at: number;
}

export interface IModNote {
    id: number;
    by: string;
    byName: string;
    at: number;
    text: string;
}

/** Wie ein Fall endete: aufgehoben, durch einen neueren ersetzt, abgelaufen oder in Discord selbst beendet. */
export interface IModEnded {
    how: "lifted" | "replaced" | "expired" | "discord";
    at: number;
    by: string | null;
    byName: string | null;
    reason: string | null;
    /** Der Fall, der ihn aufgehoben oder ersetzt hat. */
    case: number | null;
}

export interface IModDetails {
    /** ban: so viele Sekunden Nachrichten wurden mitgelöscht. */
    deleteSeconds?: number;
    /** purge */
    channelId?: string;
    channelName?: string;
    deleted?: number;
    requested?: number;
    /** Ist die DM angekommen? Fehlt, wenn keine geschickt wurde. */
    dm?: boolean;
    /** warn: aktive Verwarnungen mit dieser. */
    warns?: number;
    /** warn: die Stufe, die sie ausgelöst hat - mit ihrem Fall oder dem Grund, warum es nicht ging. */
    stage?: IModStage & { case: number | null; error?: string };
    ended?: IModEnded;
}

export interface IModCase {
    id: number;
    guildId: string;
    /** Fortlaufend je Server: Fall #12. */
    number: number;
    action: ModAction;
    /** purge ohne User-Filter: null. */
    targetId: string | null;
    targetName: string | null;
    moderatorId: string;
    moderatorName: string;
    reason: string | null;
    /** Sekunden - Timeout und befristeter Bann. */
    duration: number | null;
    /** ms - wann Timeout oder Bann enden. */
    expiresAt: number | null;
    /** Ban, Timeout, Warn: gilt noch. Alles andere ist nie aktiv. */
    active: boolean;
    source: ModSource;
    /** Der Fall, auf den sich dieser bezieht - etwa der Warn, der eine Stufe ausgelöst hat. */
    related: number | null;
    details: IModDetails;
    evidence: IModEvidence[];
    notes: IModNote[];
    logChannel: string | null;
    logMessage: string | null;
    createdAt: number;
}

/** Filter der Liste im Dashboard. */
export interface IModFilter {
    action?: ModAction | null;
    /** Nur Fälle, die noch gelten. */
    active?: boolean;
    targetId?: string | null;
    /** Fallnummer (#12), Discord-ID oder Name. */
    query?: string;
}
