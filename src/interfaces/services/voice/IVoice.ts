/* ----------------------------------------------------------
   Temp Voice - siehe docs/Voice.md
   ---------------------------------------------------------- */

/** Was im Panel angeboten wird. Die Werte stehen so auch in den Custom-IDs. */
export type VoiceAction =
    | "name"
    | "userlimit"
    | "privacy"
    | "stealthmode"
    | "trustuser"
    | "untrustuser"
    | "inviteuser"
    | "kickuser"
    | "region"
    | "blockuser"
    | "unblockuser"
    | "transferownership"
    | "deletechannel";

/** Wie ein Kanal eingestellt ist - dasselbe steckt in einem Preset. */
export interface IVoiceSettings {
    /** Ohne Namen gilt die Vorlage des Hubs. */
    name: string | null;
    /** 0: unbegrenzt. */
    limit: number;
    /** private: nur wer vertraut ist oder eingeladen wurde, kommt rein. */
    privacy: "public" | "private";
    /** Der Kanal ist für andere nicht zu sehen. */
    stealth: boolean;
    /** Discord-Region ("rotterdam"), null: automatisch. */
    region: string | null;
    /** Darf rein, auch wenn der Kanal privat ist. */
    trusted: string[];
    /** Kommt nicht rein und sieht den Kanal nicht. */
    blocked: string[];
}

/** Was ein Hub für jeden neuen Kanal vorgibt - die Server-Vorlage. */
export interface IHubConfig {
    /** Vorlage für den Namen: {user}, {nummer}, {spiel}. */
    name: string;
    /** Kategorie für die neuen Kanäle. null: die des Hubs. */
    categoryId: string | null;
    /** Vorgaben, die jeder neue Kanal erbt. */
    defaults: IVoiceSettings;
    /** Welche Optionen das Panel zeigt. */
    actions: VoiceAction[];
    /** Dürfen Mitglieder eigene Presets anlegen und anwenden? */
    presets: boolean;
}

export interface IVoiceHub {
    id: number;
    guildId: string;
    channelId: string;
    config: IHubConfig;
    createdBy: string;
    createdAt: number;
}

export interface ITempVoice {
    channelId: string;
    guildId: string;
    hubId: number | null;
    ownerId: string;
    settings: IVoiceSettings;
    createdAt: number;
}

export interface IVoicePreset {
    id: number;
    userId: string;
    name: string;
    config: IVoiceSettings;
    isDefault: boolean;
    createdAt: number;
}

/** Einstellungen des Moduls je Server (module_settings, "voice-hub"). */
export interface IVoiceModuleSettings {
    /** Wohin das Steuer-Panel geht: in den Chat des eigenen Kanals oder in einen festen Kanal. */
    panel: "voice" | "channel";
    /** Nur bei "channel": wo das feste Panel steht. */
    panelChannelId: string | null;
    panelMessageId: string | null;
}
