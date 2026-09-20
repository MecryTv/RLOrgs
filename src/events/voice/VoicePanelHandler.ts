import {
    Events,
    GuildMember,
    Interaction,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import { InfoCard } from "../../builder/CommunityView";
import { VoicePresetList, VoiceRegionPrompt, VoiceState, VoiceUserPrompt } from "../../builder/VoiceView";
import { MAX_LIMIT, MAX_PRESETS, MAX_VOICE_NAME, NEEDS_USER, VOICE_ACTIONS, VOICE_PREFIX } from "../../constants/Voice";
import { VoiceAction } from "../../interfaces/services/voice/IVoice";
import { VoiceError, VOICE_MODULE } from "../../services/VoiceService";

const EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/**
 * Das Temp-Voice-Panel: Auswahlmenü, User-Auswahl, Modals und die Presets.
 * Alles antwortet nur dem, der geklickt hat - das Panel selbst bleibt stehen,
 * es gehört allen.
 */
export default class VoicePanelHandler extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.InteractionCreate,
            description: "Bedient das Temp-Voice-Panel",
            once: false,
        });
    }

    async Execute(interaction: Interaction): Promise<void> {
        const component = interaction.isMessageComponent();

        if (!component && !interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith(`${VOICE_PREFIX}:`)) return;
        if (!interaction.inCachedGuild()) return;

        const member = interaction.member as GuildMember;

        try {
            if (!(await this.client.settings.Of(interaction.guildId)).modules.includes(VOICE_MODULE)) {
                await this.Say(interaction, "Das Temp-Voice-System ist hier aus.");

                return;
            }

            await this.Route(interaction, member);
        } catch (error) {
            if (error instanceof VoiceError) {
                await this.Say(interaction, `⚠️ ${error.message}`);

                return;
            }

            const normalized = error instanceof Error ? error : new Error(String(error));

            await this.client.guardian.ReportError(normalized, interaction, `Voice-Panel: ${interaction.customId}`);
        }
    }

    private async Route(interaction: Interaction, member: GuildMember): Promise<void> {
        if (interaction.isModalSubmit()) return this.Modal(interaction, member);
        if (!interaction.isMessageComponent()) return;

        const parts = interaction.customId.split(":");
        const service = this.client.voiceService;

        // voice:menu - eine Option aus dem Panel
        if (parts[1] === "menu" && interaction.isStringSelectMenu()) {
            const action = interaction.values[0] as VoiceAction;

            // Erst prüfen, ob ihm der Kanal überhaupt gehört - sonst öffnet sich ein Modal für nichts.
            await service.Mine(member);

            if (action === "name" || action === "userlimit") return this.AskText(interaction, action);
            if (action === "region") {
                const { temp } = await service.Mine(member);

                await interaction.reply({ ...VoiceRegionPrompt(temp.settings.region), flags: EPHEMERAL });

                return;
            }

            if (NEEDS_USER.includes(action)) {
                const label = VOICE_ACTIONS.find((entry) => entry.value === action)!.name;

                await interaction.reply({ ...VoiceUserPrompt(action, label), flags: EPHEMERAL });

                return;
            }

            return this.Done(interaction, member, await service.Run(member, action));
        }

        // voice:user:<aktion> - wen es treffen soll
        if (parts[1] === "user" && interaction.isUserSelectMenu()) {
            const action = parts[2] as VoiceAction;
            const target = interaction.guild!.members.cache.get(interaction.values[0]) ?? (await interaction.guild!.members.fetch(interaction.values[0]).catch(() => null));

            return this.Done(interaction, member, await service.Run(member, action, { target }), true);
        }

        // voice:region - die gewählte Region
        if (parts[1] === "region" && interaction.isStringSelectMenu()) {
            const value = interaction.values[0] === "auto" ? "" : interaction.values[0];

            return this.Done(interaction, member, await service.Run(member, "region", { text: value }), true);
        }

        if (!interaction.isButton()) return;

        // voice:presets - die eigenen Presets
        if (parts[1] === "presets") {
            const presets = await this.client.voicePresets.Of(member.id);

            await interaction.reply({ ...VoicePresetList(presets, MAX_PRESETS, null), flags: EPHEMERAL });

            return;
        }

        if (parts[1] !== "preset") return;

        if (parts[2] === "save") return this.AskPresetName(interaction);

        const id = Number(parts[3]);

        if (parts[2] === "apply") {
            const note = await service.ApplyPreset(member, id);

            return this.Done(interaction, member, note, true);
        }

        if (parts[2] === "default") await service.DefaultPreset(member.id, id);
        if (parts[2] === "delete") await service.DeletePreset(member.id, id);

        await interaction.update({
            ...VoicePresetList(await this.client.voicePresets.Of(member.id), MAX_PRESETS, parts[2] === "delete" ? "🗑️ Gelöscht." : "⭐ Neues Standard-Preset."),
            flags: MessageFlags.IsComponentsV2,
        });
    }

    /* ----------------------------------------------------------
       Modals
       ---------------------------------------------------------- */
    private async AskText(interaction: Interaction & { showModal: (modal: ModalBuilder) => Promise<void> }, action: "name" | "userlimit"): Promise<void> {
        const isName = action === "name";
        const modal = new ModalBuilder()
            .setCustomId(`${VOICE_PREFIX}:modal:${action}`)
            .setTitle(isName ? "Kanal umbenennen" : "Benutzerbegrenzung")
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel(isName ? "Neuer Name" : "Wie viele Plätze?")
                    .setDescription(isName ? "So heißt dein Kanal danach" : `0 bis ${MAX_LIMIT} – 0 heißt unbegrenzt`)
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId("value")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setMaxLength(isName ? MAX_VOICE_NAME : 2)
                    )
            );

        await interaction.showModal(modal);
    }

    private async AskPresetName(interaction: Interaction & { showModal: (modal: ModalBuilder) => Promise<void> }): Promise<void> {
        const modal = new ModalBuilder()
            .setCustomId(`${VOICE_PREFIX}:modal:preset`)
            .setTitle("Preset speichern")
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel("Name des Presets")
                    .setDescription("Etwa „Ranked 2v2“ oder „Chill“")
                    .setTextInputComponent(new TextInputBuilder().setCustomId("value").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60))
            );

        await interaction.showModal(modal);
    }

    private async Modal(interaction: ModalSubmitInteraction, member: GuildMember): Promise<void> {
        const action = interaction.customId.split(":")[2];
        const value = interaction.fields.getTextInputValue("value");

        if (action === "preset") {
            const note = await this.client.voiceService.SavePreset(member, value);

            await interaction.reply({ ...VoicePresetList(await this.client.voicePresets.Of(member.id), MAX_PRESETS, note), flags: EPHEMERAL });

            return;
        }

        const note = await this.client.voiceService.Run(member, action as VoiceAction, { text: value });

        await this.Done(interaction, member, note);
    }

    /* ----------------------------------------------------------
       Antworten
       ---------------------------------------------------------- */
    /** Die Antwort auf eine Änderung: was passiert ist und wie der Kanal jetzt steht. */
    private async Done(interaction: Interaction, member: GuildMember, note: string, update = false): Promise<void> {
        const temp = await this.client.tempVoices.Get(member.voice.channelId ?? "");
        const payload = temp ? VoiceState(temp, note) : InfoCard(note);

        if (update && interaction.isMessageComponent()) {
            await interaction.update({ ...payload, flags: MessageFlags.IsComponentsV2 });

            return;
        }

        if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
            await interaction.reply({ ...payload, flags: EPHEMERAL });
        }
    }

    private async Say(interaction: Interaction, text: string): Promise<void> {
        if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;

        const payload = { ...InfoCard(text), flags: EPHEMERAL };

        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => undefined);
        else await interaction.reply(payload).catch(() => undefined);
    }
}
