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
import { PANEL_PREFIX, PanelStates, RenderPanel } from "../../builder/DevLogsPanel";
import { IDevLogsState } from "../../interfaces/services/devlogs/IDevLogsPanel";
import { ILogFile } from "../../interfaces/services/devlogs/IDevLogsService";
import { MAX_SEARCH_TERM, MAX_UPLOAD_BYTES, PagesFor } from "../../constants/DevLogs";

type ErrorJump = "first" | "prev" | "next";

export default class DevLogsHandler extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.InteractionCreate,
            description: "Bedient das DevLogs-Panel (Buttons, Select-Menü, Modals)",
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

            await this.client.guardian.ReportError(normalized, interaction, `DevLogs Error: ${interaction.customId}`);
        }
    }

    private async Component(interaction: MessageComponentInteraction): Promise<void> {
        const state = PanelStates.get(interaction.message.id);

        if (!state) {
            await interaction.update(this.Notice("⌛ | Panel abgelaufen", "Öffne die Logs mit `/devlogs` erneut."));

            return;
        }

        const action = interaction.customId.slice(PANEL_PREFIX.length + 1);
        state.notice = null;

        if (interaction.isStringSelectMenu()) return this.Selected(interaction, state);
        if (!interaction.isButton()) return;

        switch (action) {
            case "list":
                state.view = "list";
                state.term = null;
                break;

            case "older":
                state.listPage += 1;
                break;

            case "newer":
                state.listPage -= 1;
                break;

            case "read":
                state.view = "page";
                state.page = 0;
                break;

            case "overview":
                state.view = "overview";
                state.term = null;
                break;

            case "prev":
                state.page -= 1;
                break;

            case "next":
                state.page += 1;
                break;

            case "partprev":
                state.part = Math.max((state.part ?? 0) - 1, 0);
                state.view = "overview";
                state.page = 0;
                break;

            case "partnext":
                state.part = (state.part ?? 0) + 1;
                state.view = "overview";
                state.page = 0;
                break;

            case "errfirst":
                return this.JumpError(interaction, state, "first");

            case "errprev":
                return this.JumpError(interaction, state, "prev");

            case "errnext":
                return this.JumpError(interaction, state, "next");

            case "jump":
                return this.AskPage(interaction, state);

            case "search":
                return this.AskTerm(interaction);

            case "download":
                return this.Download(interaction, state);

            default:
                break;
        }

        await this.Apply(interaction, state);
    }

    private async Selected(interaction: AnySelectMenuInteraction, state: IDevLogsState): Promise<void> {
        state.session = Number(interaction.values[0]);
        state.part = null;
        state.page = 0;
        state.term = null;
        state.view = "overview";

        await this.Apply(interaction, state);
    }

    private async JumpError(
        interaction: ButtonInteraction,
        state: IDevLogsState,
        direction: ErrorJump
    ): Promise<void> {
        const file = await this.File(state);

        if (!file) {
            state.notice = "❌ Die Datei ist nicht mehr da.";

            return this.Apply(interaction, state);
        }

        const { errorPages } = await this.client.devLogsService.Stats(file);

        const target =
            direction === "first"
                ? errorPages[0]
                : direction === "next"
                  ? errorPages.find((page) => page > state.page)
                  : [...errorPages].reverse().find((page) => page < state.page);

        if (target === undefined) {
            state.notice = "🔴 In diese Richtung gibt es keine weitere Fehlerstelle.";

            return this.Apply(interaction, state);
        }

        state.view = "page";
        state.page = target;

        await this.Apply(interaction, state);
    }

    private async Download(interaction: ButtonInteraction, state: IDevLogsState): Promise<void> {
        const file = await this.File(state);

        if (!file) {
            state.notice = "❌ Die Datei ist nicht mehr da.";

            return this.Apply(interaction, state);
        }

        if (file.size > MAX_UPLOAD_BYTES) {
            state.notice = `❌ ${(file.size / 1024 / 1024).toFixed(1)} MB — zu groß für einen Discord-Upload.`;

            return this.Apply(interaction, state);
        }

        await interaction.reply({
            files: [this.client.devLogsService.Attachment(file)],
            flags: MessageFlags.Ephemeral,
        });
    }

    private async AskPage(interaction: ButtonInteraction, state: IDevLogsState): Promise<void> {
        const file = await this.File(state);

        if (!file) {
            state.notice = "❌ Die Datei ist nicht mehr da.";

            return this.Apply(interaction, state);
        }

        const pages = PagesFor(file.size);

        await interaction.showModal(
            new ModalBuilder()
                .setCustomId(`${PANEL_PREFIX}:jumpsubmit:${interaction.message.id}`)
                .setTitle("Zu Seite springen")
                .addLabelComponents(
                    new LabelBuilder()
                        .setLabel(`Seite (1 - ${pages})`)
                        .setTextInputComponent(
                            new TextInputBuilder()
                                .setCustomId("page")
                                .setPlaceholder(`1 - ${pages}`)
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setMaxLength(9)
                        )
                )
        );
    }

    private async AskTerm(interaction: ButtonInteraction): Promise<void> {
        await interaction.showModal(
            new ModalBuilder()
                .setCustomId(`${PANEL_PREFIX}:searchsubmit:${interaction.message.id}`)
                .setTitle("Session-Log durchsuchen")
                .addLabelComponents(
                    new LabelBuilder()
                        .setLabel("Suchbegriff")
                        .setDescription("Groß- und Kleinschreibung egal")
                        .setTextInputComponent(
                            new TextInputBuilder()
                                .setCustomId("term")
                                .setPlaceholder("z. B. ERROR, /gallery, ein Username…")
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setMaxLength(MAX_SEARCH_TERM)
                        )
                )
        );
    }

    private async Modal(interaction: ModalSubmitInteraction): Promise<void> {
        const parts = interaction.customId.split(":");
        const messageId = parts[parts.length - 1];
        const state = PanelStates.get(messageId);

        if (!state) {
            await interaction.reply({
                ...this.Notice("⌛ | Panel abgelaufen", "Öffne die Logs mit `/devlogs` erneut."),
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });

            return;
        }

        state.notice = null;

        if (parts[2] === "searchsubmit") {
            const term = interaction.fields.getTextInputValue("term").trim();

            if (term) {
                state.term = term;
                state.view = "search";
            } else {
                state.notice = "⚠️ Der Suchbegriff war leer.";
            }
        } else {
            const wanted = Number(interaction.fields.getTextInputValue("page").trim());

            if (Number.isInteger(wanted) && wanted > 0) {
                state.page = wanted - 1;
                state.view = "page";
            } else {
                state.notice = "⚠️ Das war keine gültige Seitenzahl.";
            }
        }

        PanelStates.set(messageId, state);

        const view = await RenderPanel(this.client, state);

        if (interaction.isFromMessage()) {
            await interaction.update({ ...view, flags: MessageFlags.IsComponentsV2 });

            return;
        }

        await interaction.reply({ ...view, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    private async File(state: IDevLogsState): Promise<ILogFile | null> {
        if (state.session === null) return null;

        return this.client.devLogsService.Resolve(state.session, state.part);
    }

    private async Apply(interaction: MessageComponentInteraction, state: IDevLogsState): Promise<void> {
        PanelStates.set(interaction.message.id, state);

        const view = await RenderPanel(this.client, state);

        await interaction.update({ ...view, flags: MessageFlags.IsComponentsV2 });
    }

    private Notice(title: string, text: string) {
        return new ComponentV2Builder({ accentColor: "Red" }).title(title).separator().text(text).toMessage();
    }
}
