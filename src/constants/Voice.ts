import { IHubConfig, IVoiceSettings, VoiceAction } from "../interfaces/services/voice/IVoice";

/**
 * Temp Voice: die Optionen des Panels, Grenzen und Vorgaben. Was hier steht,
 * sieht der Nutzer genau so im Auswahlmenü. Siehe docs/Voice.md.
 */
export const VOICE_PREFIX = "voice";
export const VOICE_ACCENT = "#5865f2";

export const MAX_HUBS = 10;
export const MAX_PRESETS = 5;
export const MAX_VOICE_NAME = 90;
export const MAX_TRUSTED = 25;
export const MAX_LIMIT = 99;

/** Die Auswahl im Panel - Reihenfolge, Text und Symbol wie hier. */
export const VOICE_ACTIONS: { name: string; value: VoiceAction; description: string; emoji: string }[] = [
    { name: "Name", value: "name", description: "Ändere den Namen des temporären Sprachkanals", emoji: "📝" },
    { name: "User Limit", value: "userlimit", description: "Ändere die Benutzerbegrenzung des Sprachkanals", emoji: "🔢" },
    { name: "Privacy", value: "privacy", description: "Ändere die Privatsphäre (öffentlich/privat)", emoji: "🔒" },
    { name: "Stealth Mode", value: "stealthmode", description: "Schalte den Stealth-Modus ein/aus (Kanal unsichtbar)", emoji: "👻" },
    { name: "Trust User", value: "trustuser", description: "Erlaube einem User den Beitritt im privaten Modus", emoji: "✅" },
    { name: "Untrust User", value: "untrustuser", description: "Entziehe einem User das Beitrittsrecht", emoji: "❌" },
    { name: "Invite User", value: "inviteuser", description: "Lade einen User in deinen Sprachkanal ein", emoji: "🔗" },
    { name: "Kick User", value: "kickuser", description: "Entferne einen Benutzer aus dem Sprachkanal", emoji: "🚪" },
    { name: "Region", value: "region", description: "Ändere die Region des temporären Sprachkanals", emoji: "🌐" },
    { name: "Block User", value: "blockuser", description: "Blockiere einen User für diesen Sprachkanal", emoji: "🚫" },
    { name: "Unblock User", value: "unblockuser", description: "Hebe die Blockierung eines Users wieder auf", emoji: "🔓" },
    { name: "Transfer Ownership", value: "transferownership", description: "Übertrage den Besitz des Kanals an einen User", emoji: "🔄" },
    { name: "Delete Channel", value: "deletechannel", description: "Lösche den temporären Sprachkanal", emoji: "🗑️" },
];

export const VOICE_ACTION_VALUES = VOICE_ACTIONS.map((entry) => entry.value);

/** Welche Aktion wen braucht - danach richtet sich, was nach der Auswahl kommt. */
export const NEEDS_USER: VoiceAction[] = ["trustuser", "untrustuser", "inviteuser", "kickuser", "blockuser", "unblockuser", "transferownership"];

/** Discords Sprachregionen. Automatisch heißt: Discord sucht sie selbst aus. */
export const VOICE_REGIONS: [string, string][] = [
    ["", "Automatisch"],
    ["rotterdam", "Rotterdam"],
    ["frankfurt", "Frankfurt"],
    ["milan", "Mailand"],
    ["london", "London"],
    ["madrid", "Madrid"],
    ["stockholm", "Stockholm"],
    ["warsaw", "Warschau"],
    ["us-east", "USA Ost"],
    ["us-central", "USA Mitte"],
    ["us-west", "USA West"],
    ["brazil", "Brasilien"],
    ["singapore", "Singapur"],
    ["sydney", "Sydney"],
    ["japan", "Japan"],
    ["india", "Indien"],
    ["south-africa", "Südafrika"],
];

export const REGION_LABELS = new Map(VOICE_REGIONS);

export function DefaultVoiceSettings(): IVoiceSettings {
    return { name: null, limit: 0, privacy: "public", stealth: false, region: null, trusted: [], blocked: [] };
}

export function DefaultHubConfig(): IHubConfig {
    return {
        name: "{user}s Kanal",
        categoryId: null,
        defaults: DefaultVoiceSettings(),
        actions: [...VOICE_ACTION_VALUES],
        presets: true,
    };
}

/** "{user}s Kanal" wird zu "Laras Kanal". {nummer} zählt die offenen Kanäle des Hubs. */
export function FormatVoiceName(template: string, values: { user: string; number: number; game: string | null }): string {
    return (
        template
            .replaceAll("{user}", values.user)
            .replaceAll("{nummer}", String(values.number))
            .replaceAll("{spiel}", values.game ?? "Voice")
            .trim()
            .slice(0, MAX_VOICE_NAME) || values.user
    );
}
