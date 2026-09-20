import { ContainerBuilder, MessageMentionOptions } from "discord.js";
import ComponentV2Builder from "./ComponentV2Builder";
import { REGION_LABELS, VOICE_ACCENT, VOICE_ACTIONS, VOICE_PREFIX, VOICE_REGIONS } from "../constants/Voice";
import { IHubConfig, ITempVoice, IVoicePreset } from "../interfaces/services/voice/IVoice";

/**
 * Wie das Temp-Voice-Panel und seine Antworten aussehen. Die Logik steckt im
 * VoiceService; hier wird nur gezeichnet.
 */

export interface IVoiceView {
    components: ContainerBuilder[];
    allowedMentions: MessageMentionOptions;
}

function view(builder: ComponentV2Builder): IVoiceView {
    return { components: [builder.build()], allowedMentions: { parse: [] } };
}

/** Das Panel: ein Auswahlmenü mit den Optionen, die der Hub erlaubt. */
export function VoicePanel(config: IHubConfig, inChannel: boolean): IVoiceView {
    const options = VOICE_ACTIONS.filter((entry) => config.actions.includes(entry.value));
    const builder = new ComponentV2Builder({ accentColor: VOICE_ACCENT });

    builder
        .text("## 🔊 Dein Sprachkanal")
        .text(
            inChannel
                ? "Alles hier steuerst du selbst – solange der Kanal dir gehört."
                : "Wähle eine Option, während du in deinem eigenen Kanal sitzt."
        );

    if (options.length) {
        builder.select({
            customId: `${VOICE_PREFIX}:menu`,
            placeholder: "Was möchtest du ändern?",
            options: options.map((entry) => ({ label: entry.name, value: entry.value, description: entry.description, emoji: entry.emoji })),
        });
    }

    if (config.presets) builder.buttons({ customId: `${VOICE_PREFIX}:presets`, label: "Presets", emoji: "📌", tone: "secondary" });

    return view(builder);
}

/** Der Stand eines Kanals - kommt als kurze Antwort, wenn jemand etwas ändert. */
export function VoiceState(temp: ITempVoice, note: string): IVoiceView {
    const { settings } = temp;
    const builder = new ComponentV2Builder({ accentColor: VOICE_ACCENT });
    const lines = [
        `Besitzer: <@${temp.ownerId}>`,
        `Größe: ${settings.limit ? `${settings.limit} Plätze` : "unbegrenzt"}`,
        `Zutritt: ${settings.privacy === "private" ? "privat" : "offen"}${settings.stealth ? " · unsichtbar" : ""}`,
        `Region: ${REGION_LABELS.get(settings.region ?? "") ?? "Automatisch"}`,
        ...(settings.trusted.length ? [`Vertraut: ${settings.trusted.map((id) => `<@${id}>`).join(", ")}`] : []),
        ...(settings.blocked.length ? [`Blockiert: ${settings.blocked.map((id) => `<@${id}>`).join(", ")}`] : []),
    ];

    return view(builder.text(note).subtext(lines.join(" · ")));
}

/** Wen soll es treffen? Eine User-Auswahl zur gewählten Aktion. */
export function VoiceUserPrompt(action: string, label: string): IVoiceView {
    const builder = new ComponentV2Builder({ accentColor: VOICE_ACCENT });

    return view(builder.text(`**${label}** – wähle jemanden aus.`).userSelect({ customId: `${VOICE_PREFIX}:user:${action}`, placeholder: "Mitglied auswählen" }));
}

export function VoiceRegionPrompt(current: string | null): IVoiceView {
    const builder = new ComponentV2Builder({ accentColor: VOICE_ACCENT });

    return view(
        builder.text("**Region** – wo laufen die Stimmen entlang?").select({
            customId: `${VOICE_PREFIX}:region`,
            placeholder: "Region wählen",
            options: VOICE_REGIONS.map(([value, label]) => ({ label, value: value || "auto", default: (current ?? "") === value })),
        })
    );
}

/** Die Presets eines Users - anwenden, zum Standard machen, löschen. */
export function VoicePresetList(presets: IVoicePreset[], max: number, note: string | null): IVoiceView {
    const builder = new ComponentV2Builder({ accentColor: VOICE_ACCENT });

    builder.text("## 📌 Deine Presets").text(
        presets.length
            ? "Das Standard-Preset gilt für jeden neuen Kanal, den du aufmachst."
            : "Noch keins. Stell deinen Kanal ein, wie du ihn magst, und speichere ihn hier."
    );

    if (note) builder.subtext(note);

    for (const preset of presets) {
        builder.section(
            `**${preset.name}**${preset.isDefault ? " · Standard" : ""}\n-# ${preset.config.limit ? `${preset.config.limit} Plätze` : "unbegrenzt"} · ${preset.config.privacy === "private" ? "privat" : "offen"}${preset.config.stealth ? " · unsichtbar" : ""}`,
            { type: "button", customId: `${VOICE_PREFIX}:preset:apply:${preset.id}`, label: "Anwenden", tone: "primary" }
        );
        builder.buttons(
            { customId: `${VOICE_PREFIX}:preset:default:${preset.id}`, label: preset.isDefault ? "Ist Standard" : "Als Standard", emoji: "⭐", tone: "secondary", disabled: preset.isDefault },
            { customId: `${VOICE_PREFIX}:preset:delete:${preset.id}`, label: "Löschen", emoji: "🗑️", tone: "danger" }
        );
    }

    builder.buttons({
        customId: `${VOICE_PREFIX}:preset:save`,
        label: presets.length >= max ? `Höchstens ${max} Presets` : "Aktuellen Kanal speichern",
        emoji: "💾",
        tone: "success",
        disabled: presets.length >= max,
    });

    return view(builder);
}
