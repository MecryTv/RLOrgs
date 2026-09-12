import {
    AnySelectMenuInteraction,
    ButtonInteraction,
    Events,
    Interaction,
    LabelBuilder,
    MessageComponentInteraction,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import ComponentV2Builder from "../../builder/ComponentV2Builder";
import { DIRECT_VALUE, PANEL_PREFIX, PanelStates, RenderPanel } from "../../builder/GalleryPanel";
import { IPanelState } from "../../interfaces/services/gallery/IGalleryPanel";
import { DEFAULT_SCOPE, SanitizeName } from "../../constants/Gallery";
import logger from "../../utils/logger";

const UPLOAD_TIMEOUT = 90_000;
const LINKS = /https:\/\/\S+/g;

export default class GalleryHandler extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.InteractionCreate,
            description: "Bedient das Galerie-Panel (Buttons, Select-Menüs, Modals)",
            once: false,
        });
    }

    async Execute(interaction: Interaction): Promise<void> {
        const isComponent = interaction.isMessageComponent();
        if (!isComponent && !interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith(PANEL_PREFIX)) return;

        try {
            if (interaction.isModalSubmit()) await this.Modal(interaction);
            else await this.Component(interaction);
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            await this.client.guardian.ReportError(normalized, interaction, `Panel Error: ${interaction.customId}`);
        }
    }

    private async Component(interaction: MessageComponentInteraction): Promise<void> {
        const state = PanelStates.get(interaction.message.id);

        if (!state) {
            await interaction.update(
                this.Notice("⌛ | Panel abgelaufen", "Öffne die Galerie mit `/gallery` erneut.")
            );

            return;
        }

        const action = interaction.customId.slice(PANEL_PREFIX.length + 1);
        state.notice = null;

        if (interaction.isStringSelectMenu()) return this.Selected(interaction, state, action);
        if (!interaction.isButton()) return;

        switch (action) {
            case "prev":
                state.page -= 1;
                break;

            case "next":
                state.page += 1;
                break;

            case "delete":
                state.mode = "delete";
                state.marked = [];
                break;

            case "move":
                state.mode = "move";
                state.moving = null;
                break;

            case "cancel":
                state.mode = "browse";
                state.marked = [];
                state.moving = null;
                break;

            case "confirm":
                return this.RemoveImages(interaction, state);

            case "movehere":
                return this.MoveHere(interaction, state);

            case "upload":
                return this.Upload(interaction, state);

            case "newcat":
                return this.AskCategory(interaction);

            case "delcat":
                return this.RemoveCategory(interaction, state);

            default:
                break;
        }

        await this.Apply(interaction, state);
    }

    private async Selected(
        interaction: AnySelectMenuInteraction,
        state: IPanelState,
        action: string
    ): Promise<void> {
        const values = interaction.values;

        if (action === "cat") {
            const separator = values[0].indexOf(":");

            state.scope = values[0].slice(0, separator);
            state.category = values[0].slice(separator + 1);
            state.subcategory = null;
            state.page = 0;
        }

        if (action === "sub") {
            state.subcategory = values[0] === DIRECT_VALUE ? null : values[0];
            state.page = 0;
        }

        if (action === "pick") {
            // Jetzt zur ID auflösen: nach einem Ordnerwechsel zeigt der State woandershin.
            const ids = values.map((file) => this.IdFor(state, file));

            if (state.mode === "move") state.moving = ids[0];
            else state.marked = ids;
        }

        await this.Apply(interaction, state);
    }

    private async Upload(interaction: ButtonInteraction, state: IPanelState): Promise<void> {
        const channel = interaction.channel;

        if (!channel?.isTextBased() || channel.isDMBased()) {
            state.notice = "❌ Uploads gehen nur in einem Server-Textkanal.";
            return this.Apply(interaction, state);
        }

        const deadline = Math.floor((Date.now() + UPLOAD_TIMEOUT) / 1000);
        state.notice =
            `⏳ Poste jetzt Bilder oder Links in diesen Kanal — mehrere in einer Nachricht gehen. ` +
            `Läuft ab <t:${deadline}:R>`;

        await this.Apply(interaction, state);

        const collected = await channel
            .awaitMessages({
                filter: (message) =>
                    message.author.id === interaction.user.id &&
                    (message.attachments.size > 0 || (message.content.match(LINKS)?.length ?? 0) > 0),
                max: 1,
                time: UPLOAD_TIMEOUT,
                errors: ["time"],
            })
            .catch(() => null);

        const message = collected?.first();

        if (!message) {
            state.notice = "⌛ Zeitfenster abgelaufen — es wurde nichts hochgeladen.";
            return this.Apply(interaction, state, true);
        }

        const saved: string[] = [];
        const skipped: string[] = [];

        const sources: Array<{ url: string; name?: string }> = [
            ...message.attachments.map((attachment) => ({ url: attachment.url, name: attachment.name })),
            ...(message.content.match(LINKS) ?? []).map((url) => ({ url })),
        ];

        for (const source of sources) {
            try {
                const image = await this.client.galleryService.AddImage(
                    { guildId: state.homeGuildId, category: state.category!, subcategory: state.subcategory },
                    source.url,
                    source.name
                );

                saved.push(image.file);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);

                skipped.push(`${source.name ?? source.url}: ${reason}`);
            }
        }

        await message.delete().catch(() => {});

        state.notice =
            saved.length > 0
                ? `✅ ${saved.length} Bild(er) hochgeladen${skipped.length ? ` · ${skipped.length} übersprungen` : ""}`
                : `❌ Nichts gespeichert — ${skipped[0] ?? "keine gültigen Bilder dabei"}`;

        await this.Apply(interaction, state, true);
    }

    private async RemoveImages(interaction: ButtonInteraction, state: IPanelState): Promise<void> {
        let removed = 0;
        for (const id of state.marked) {
            if (await this.client.galleryService.DeleteImage(id)) removed++;
        }

        state.notice = `🗑️ ${removed} Bild(er) gelöscht.`;
        state.mode = "browse";
        state.marked = [];
        state.page = 0;

        await this.Apply(interaction, state);
    }

    private async MoveHere(interaction: ButtonInteraction, state: IPanelState): Promise<void> {
        const moved =
            state.moving &&
            (await this.client.galleryService.MoveImage(state.moving, {
                category: state.category!,
                subcategory: state.subcategory,
            }));

        state.notice = moved ? "📦 Bild verschoben." : "❌ Das Bild konnte nicht verschoben werden.";
        state.mode = "browse";
        state.moving = null;

        await this.Apply(interaction, state);
    }

    private async RemoveCategory(interaction: ButtonInteraction, state: IPanelState): Promise<void> {
        const removed = await this.client.galleryService.DeleteCategory({
            guildId: state.homeGuildId,
            category: state.category!,
            subcategory: state.subcategory,
        });

        state.notice = `🗑️ Kategorie \`${state.subcategory ?? state.category}\` gelöscht (${removed} Bild(er)).`;

        if (state.subcategory) state.subcategory = null;
        else state.category = null;

        state.page = 0;
        state.mode = "browse";

        await this.Apply(interaction, state);
    }

    private async AskCategory(interaction: ButtonInteraction): Promise<void> {
        const modal = new ModalBuilder()
            .setCustomId(`${PANEL_PREFIX}:newcat:${interaction.message.id}`)
            .setTitle("Kategorie anlegen")
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel("Hauptkategorie")
                    .setDescription("Buchstaben, Zahlen, - und _")
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId("category")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setMaxLength(32)
                    ),
                new LabelBuilder()
                    .setLabel("Unterordner")
                    .setDescription("Optional — leer lassen für eine Hauptkategorie")
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId("subcategory")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setMaxLength(32)
                    )
            );

        await interaction.showModal(modal);
    }

    private async Modal(interaction: ModalSubmitInteraction): Promise<void> {
        const messageId = interaction.customId.split(":").pop()!;
        const state = PanelStates.get(messageId);

        if (!state) {
            await interaction.reply({
                ...this.Notice("⌛ | Panel abgelaufen", "Öffne die Galerie mit `/gallery` erneut."),
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });

            return;
        }

        const category = SanitizeName(interaction.fields.getTextInputValue("category"));
        const raw = interaction.fields.getTextInputValue("subcategory");
        const subcategory = raw ? SanitizeName(raw) : null;

        if (!category) {
            state.notice = "⚠️ Ungültiger Name — erlaubt sind Buchstaben, Zahlen, `-` und `_`.";
        } else {
            const created = await this.client.galleryService.CreateCategory({
                guildId: state.homeGuildId,
                category,
                subcategory,
            });

            if (created) {
                state.notice = `✅ Kategorie \`${subcategory ? `${category}/${subcategory}` : category}\` angelegt.`;
                state.scope = state.homeGuildId;
                state.category = category;
                state.subcategory = subcategory;
                state.page = 0;
            } else {
                state.notice = subcategory
                    ? `⚠️ Gibt es schon — oder die Hauptkategorie \`${category}\` fehlt noch.`
                    : `⚠️ \`${category}\` gibt es bereits.`;
            }
        }

        PanelStates.set(messageId, state);

        const view = await RenderPanel(this.client, state);

        if (interaction.isFromMessage()) {
            await interaction.update({ ...view, flags: MessageFlags.IsComponentsV2, attachments: [] });
            return;
        }

        await interaction.reply({ ...view, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    private async Apply(
        interaction: MessageComponentInteraction,
        state: IPanelState,
        edit = false
    ): Promise<void> {
        PanelStates.set(interaction.message.id, state);

        const view = await RenderPanel(this.client, state);

        if (edit) await interaction.editReply({ ...view, flags: MessageFlags.IsComponentsV2, attachments: [] });
        else await interaction.update({ ...view, flags: MessageFlags.IsComponentsV2, attachments: [] });
    }

    private IdFor(state: IPanelState, file: string): string {
        return [state.scope, state.category, state.subcategory, file].filter(Boolean).join("/");
    }

    private Notice(title: string, text: string) {
        return new ComponentV2Builder({ accentColor: "Red" }).title(title).separator().text(text).toMessage();
    }
}
