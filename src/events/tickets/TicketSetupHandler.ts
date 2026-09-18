import {
    ChannelSelectMenuInteraction,
    Events,
    Interaction,
    LabelBuilder,
    MessageComponentInteraction,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    RoleSelectMenuInteraction,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import ComponentV2Builder from "../../builder/ComponentV2Builder";
import { ISetupState, SetupPage, SetupStates, SetupView } from "../../builder/TicketSetupPanel";
import { TicketError } from "../../services/TicketService";
import {
    MESSAGE_KEYS,
    MESSAGE_LABELS,
    PANEL_STATES,
    SETUP_PREFIX,
    TicketAction,
    TicketMessageKey,
} from "../../constants/Tickets";
import { IMessageBlock, IMessageDoc } from "../../interfaces/builder/IMessageDoc";
import { ITicketConfig, ITicketOption } from "../../interfaces/services/tickets/ITicket";

/** Der erste Textbaustein - das ist der Text, den die Kurzfassung bearbeitet. */
function FirstText(doc: IMessageDoc): string {
    const block = doc.blocks.find((entry) => entry.type === "text");

    return block?.type === "text" ? block.body : "";
}

function FirstImage(doc: IMessageDoc): string {
    const block = doc.blocks.find((entry) => entry.type === "image");

    return block?.type === "image" ? block.images[0] ?? "" : "";
}

/**
 * Kurzfassung in ein Dokument zurückschreiben: Text und Bild ersetzen genau
 * ihren Baustein, alles andere aus dem Dashboard bleibt stehen.
 */
function ApplyShort(doc: IMessageDoc, text: string, accent: string, image: string): IMessageDoc {
    const blocks: IMessageBlock[] = [...doc.blocks];
    const textIndex = blocks.findIndex((block) => block.type === "text");

    if (textIndex >= 0) blocks[textIndex] = { type: "text", body: text };
    else if (text) blocks.unshift({ type: "text", body: text });

    const imageIndex = blocks.findIndex((block) => block.type === "image");

    if (!image && imageIndex >= 0) blocks.splice(imageIndex, 1);
    else if (image && imageIndex >= 0) blocks[imageIndex] = { type: "image", images: [image] };
    else if (image) blocks.push({ type: "image", images: [image] });

    return { ...(accent ? { accent } : {}), blocks };
}

/**
 * Der Assistent hinter /ticket setup. Er schreibt über denselben TicketService
 * wie das Dashboard - es gibt keine zweite Stelle, die Einstellungen prüft.
 */
export default class TicketSetupHandler extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.InteractionCreate,
            description: "Bedient den Einrichtungs-Assistenten von /ticket setup",
            once: false,
        });
    }

    async Execute(interaction: Interaction): Promise<void> {
        const isComponent = interaction.isMessageComponent();

        if (!isComponent && !interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith(`${SETUP_PREFIX}:`)) return;

        const [, action, argument] = interaction.customId.split(":");

        try {
            if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                throw new TicketError("Dafür brauchst du „Server verwalten“.");
            }

            if (interaction.isModalSubmit()) await this.Modal(interaction, action, argument);
            else await this.Component(interaction, action);
        } catch (error) {
            if (error instanceof TicketError) {
                await this.Fail(interaction, error.message);

                return;
            }

            const normalized = error instanceof Error ? error : new Error(String(error));

            await this.Fail(interaction, "Das hat nicht geklappt – ich habe es den Entwicklern gemeldet.");
            await this.client.guardian.ReportError(normalized, interaction, `Ticket-Setup: ${interaction.customId}`);
        }
    }

    /* ----------------------------------------------------------
       Klicks
       ---------------------------------------------------------- */
    private async Component(interaction: MessageComponentInteraction, action: string): Promise<void> {
        const state = this.State(interaction.message.id);
        const guild = interaction.guild!;
        const config = await this.client.ticketSettings.Of(guild.id);

        state.notice = null;

        // Alles außer den drei Modals erst quittieren: Speichern legt im Forum
        // unter Umständen Tags an und zieht das Panel nach - das dauert länger als
        // die drei Sekunden, die Discord auf eine erste Antwort wartet.
        if (!["add", "edit", "msg"].includes(action)) await interaction.deferUpdate();

        if (action === "page" && interaction.isStringSelectMenu()) {
            state.page = interaction.values[0] as SetupPage;

            return this.Show(interaction, state);
        }

        if (action === "contact") {
            await this.Patch(guild.id, { contact: config.contact === "direct" ? "modmail" : "direct" }, state);

            return this.Show(interaction, state);
        }

        if (action === "surface") {
            await this.Patch(guild.id, { surface: config.surface === "channel" ? "forum" : "channel" }, state);

            return this.Show(interaction, state);
        }

        if (action === "style") {
            await this.Patch(guild.id, { style: config.style === "buttons" ? "select" : "buttons" }, state);

            return this.Show(interaction, state);
        }

        if (action === "role" && interaction.isRoleSelectMenu()) {
            await this.Patch(guild.id, { supportRoleId: this.Role(interaction) }, state);

            return this.Show(interaction, state);
        }

        if (action === "forum" && interaction.isChannelSelectMenu()) {
            await this.Patch(guild.id, { forumId: this.Channel(interaction) }, state);

            return this.Show(interaction, state);
        }

        if (action === "limit" && interaction.isStringSelectMenu()) {
            await this.Patch(guild.id, { limit: Number(interaction.values[0]) }, state);

            return this.Show(interaction, state);
        }

        if (action === "delete" && interaction.isStringSelectMenu()) {
            await this.Patch(guild.id, { deleteAfter: Number(interaction.values[0]) }, state);

            return this.Show(interaction, state);
        }

        if (action === "actions" && interaction.isStringSelectMenu()) {
            await this.Patch(guild.id, { actions: interaction.values as TicketAction[] }, state);

            return this.Show(interaction, state);
        }

        if (action === "trsave") {
            await this.Patch(guild.id, { transcripts: { ...config.transcripts, enabled: !config.transcripts.enabled } }, state);

            return this.Show(interaction, state);
        }

        if (action === "trdm") {
            await this.Patch(guild.id, { transcripts: { ...config.transcripts, dm: !config.transcripts.dm } }, state);

            return this.Show(interaction, state);
        }

        if (action === "trchan" && interaction.isChannelSelectMenu()) {
            await this.Patch(guild.id, { transcripts: { ...config.transcripts, channelId: this.Channel(interaction) } }, state);

            return this.Show(interaction, state);
        }

        if (action === "trnone") {
            await this.Patch(guild.id, { transcripts: { ...config.transcripts, channelId: null } }, state, "Kein Log-Kanal mehr.");

            return this.Show(interaction, state);
        }

        if (action === "pick" && interaction.isStringSelectMenu()) {
            state.optionId = interaction.values[0];

            return this.Show(interaction, state);
        }

        if (action === "cat" && interaction.isChannelSelectMenu()) {
            return this.Option(interaction, state, config, (option) => ({ ...option, categoryId: this.Channel(interaction) }));
        }

        if (action === "optrole" && interaction.isRoleSelectMenu()) {
            return this.Option(interaction, state, config, (option) => ({ ...option, supportRoleId: this.Role(interaction) }));
        }

        if (action === "up") {
            const index = config.options.findIndex((option) => option.id === state.optionId);

            if (index <= 0) throw new TicketError("Die Option steht schon ganz oben.");

            const options = [...config.options];

            [options[index - 1], options[index]] = [options[index], options[index - 1]];

            await this.Patch(guild.id, { options }, state, "⬆️ Reihenfolge geändert.");

            return this.Show(interaction, state);
        }

        if (action === "del") {
            const options = config.options.filter((option) => option.id !== state.optionId);

            if (options.length === config.options.length) throw new TicketError("Wähle zuerst eine Option aus.");

            state.optionId = null;

            await this.Patch(guild.id, { options }, state, "🗑️ Option gelöscht. Offene Tickets bleiben, wo sie sind.");

            return this.Show(interaction, state);
        }

        if (action === "panelchan" && interaction.isChannelSelectMenu()) {
            state.panelChannelId = this.Channel(interaction);

            return this.Show(interaction, state);
        }

        if (action === "send") {
            const channelId = state.panelChannelId ?? config.panel.channelId;

            if (!channelId) throw new TicketError("Wähle zuerst einen Kanal.");

            const { url, state: placed } = await this.client.ticketService.SendPanel(guild, channelId);

            state.notice = `📮 ${PANEL_STATES[placed].text.replace("{channel}", `<#${channelId}>`)} [Ansehen](${url})`;

            return this.Show(interaction, state);
        }

        if (action === "unpanel") {
            const removed = await this.client.ticketService.RemovePanel(guild);

            state.notice = removed ? "🗑️ Panel entfernt." : "Es stand kein Panel mehr da – jetzt ist es auch vergessen.";

            return this.Show(interaction, state);
        }

        if (action === "add" && interaction.isButton()) return this.AskOption(interaction, null);

        if (action === "edit" && interaction.isButton()) {
            const option = config.options.find((entry) => entry.id === state.optionId);

            if (!option) throw new TicketError("Wähle zuerst eine Option aus.");

            return this.AskOption(interaction, option);
        }

        if (action === "msg" && interaction.isStringSelectMenu()) {
            const key = interaction.values[0] as TicketMessageKey;

            if (!MESSAGE_KEYS.includes(key)) throw new TicketError("Diese Nachricht kenne ich nicht.");

            return this.AskMessage(interaction, key, config);
        }
    }

    /* ----------------------------------------------------------
       Modals
       ---------------------------------------------------------- */
    private async Modal(interaction: ModalSubmitInteraction, action: string, argument: string): Promise<void> {
        const guild = interaction.guild!;
        const config = await this.client.ticketSettings.Of(guild.id);
        const state = this.State(interaction.message?.id ?? "");

        state.notice = null;

        if (interaction.isFromMessage()) await interaction.deferUpdate();

        if (action === "opt") {
            const name = interaction.fields.getTextInputValue("name").trim();
            const description = interaction.fields.getTextInputValue("description").trim();
            const emoji = interaction.fields.getTextInputValue("emoji").trim();

            if (!name) throw new TicketError("Die Option braucht einen Namen.");
            if (emoji && !this.client.ticketService.CleanEmoji(emoji)) {
                throw new TicketError("Das Emoji kenne ich nicht. Nimm ein Standard-Emoji oder eins von diesem Server.");
            }

            const existing = config.options.find((option) => option.id === argument);
            const patched: ITicketOption = existing
                ? { ...existing, name, description, emoji: emoji || null }
                : {
                      id: "",
                      name,
                      description,
                      emoji: emoji || null,
                      categoryId: null,
                      tagId: null,
                      supportRoleId: null,
                      opened: null,
                  };

            const options = existing
                ? config.options.map((option) => (option.id === existing.id ? patched : option))
                : [...config.options, patched];

            const saved = await this.Patch(guild.id, { options }, state, existing ? "✏️ Option gespeichert." : "➕ Option angelegt.");

            state.optionId = existing ? existing.id : saved.options[saved.options.length - 1]?.id ?? null;

            return this.Show(interaction, state);
        }

        if (action === "msgedit") {
            const key = argument as TicketMessageKey;

            if (!MESSAGE_KEYS.includes(key)) throw new TicketError("Diese Nachricht kenne ich nicht.");

            const doc = ApplyShort(
                config.messages[key],
                interaction.fields.getTextInputValue("text").trim(),
                interaction.fields.getTextInputValue("accent").trim(),
                interaction.fields.getTextInputValue("image").trim()
            );

            await this.Patch(guild.id, { messages: { ...config.messages, [key]: doc } }, state, `✉️ ${MESSAGE_LABELS[key]} gespeichert.`);

            return this.Show(interaction, state);
        }
    }

    private async AskOption(interaction: MessageComponentInteraction, option: ITicketOption | null): Promise<void> {
        const field = (id: string, label: string, hint: string, value: string, required: boolean, max: number) =>
            new LabelBuilder()
                .setLabel(label)
                .setDescription(hint)
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId(id)
                        .setStyle(TextInputStyle.Short)
                        .setRequired(required)
                        .setMaxLength(max)
                        .setValue(value)
                );

        await interaction.showModal(
            new ModalBuilder()
                .setCustomId(`${SETUP_PREFIX}:opt:${option?.id ?? ""}`)
                .setTitle(option ? "Option bearbeiten" : "Option hinzufügen")
                .addLabelComponents(
                    field("name", "Name", "Steht auf dem Knopf bzw. im Menü", option?.name ?? "", true, 80),
                    field("description", "Beschreibung", "Kurzer Satz - nur im Auswahlmenü sichtbar", option?.description ?? "", false, 100),
                    field("emoji", "Emoji", "Standard-Emoji oder ein Server-Emoji wie <:name:123>", option?.emoji ?? "", false, 64)
                )
        );
    }

    private async AskMessage(
        interaction: MessageComponentInteraction,
        key: TicketMessageKey,
        config: ITicketConfig
    ): Promise<void> {
        const doc = config.messages[key];

        await interaction.showModal(
            new ModalBuilder()
                .setCustomId(`${SETUP_PREFIX}:msgedit:${key}`)
                .setTitle(MESSAGE_LABELS[key].slice(0, 45))
                .addLabelComponents(
                    new LabelBuilder()
                        .setLabel("Text")
                        .setDescription("Markdown und Platzhalter wie {user} oder {ticket.id}")
                        .setTextInputComponent(
                            new TextInputBuilder()
                                .setCustomId("text")
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                                .setMaxLength(2000)
                                .setValue(FirstText(doc).slice(0, 2000))
                        ),
                    new LabelBuilder()
                        .setLabel("Farbe")
                        .setDescription("Balken links, als #rrggbb")
                        .setTextInputComponent(
                            new TextInputBuilder()
                                .setCustomId("accent")
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                                .setMaxLength(7)
                                .setValue(doc.accent ?? "")
                        ),
                    new LabelBuilder()
                        .setLabel("Bild")
                        .setDescription("https-Adresse, Galerie-ID oder leer lassen")
                        .setTextInputComponent(
                            new TextInputBuilder()
                                .setCustomId("image")
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                                .setMaxLength(300)
                                .setValue(FirstImage(doc))
                        )
                )
        );
    }

    /* ----------------------------------------------------------
       Kleinkram
       ---------------------------------------------------------- */
    private State(messageId: string): ISetupState {
        const state = SetupStates.get(messageId);

        if (!state) throw new TicketError("Der Assistent ist abgelaufen. Öffne ihn mit `/ticket setup` neu.");

        return state;
    }

    private Role(interaction: RoleSelectMenuInteraction): string | null {
        const role = interaction.roles.first();

        // @everyone steht im Menü für "keine eigene Rolle".
        return role && role.id !== interaction.guildId ? role.id : null;
    }

    private Channel(interaction: ChannelSelectMenuInteraction): string | null {
        return interaction.channels.first()?.id ?? null;
    }

    private async Patch(
        guildId: string,
        patch: Partial<ITicketConfig>,
        state: ISetupState,
        notice?: string
    ): Promise<ITicketConfig> {
        const guild = this.client.guilds.cache.get(guildId)!;
        const config = await this.client.ticketService.Save(guild, patch);

        if (notice) state.notice = notice;

        return config;
    }

    private async Option(
        interaction: MessageComponentInteraction,
        state: ISetupState,
        config: ITicketConfig,
        change: (option: ITicketOption) => ITicketOption
    ): Promise<void> {
        const current = config.options.find((option) => option.id === state.optionId);

        if (!current) throw new TicketError("Wähle zuerst eine Option aus.");

        const options = config.options.map((option) => (option.id === current.id ? change(option) : option));

        await this.Patch(interaction.guildId!, { options }, state, "✅ Option gespeichert.");

        return this.Show(interaction, state);
    }

    private async Show(interaction: MessageComponentInteraction | ModalSubmitInteraction, state: ISetupState): Promise<void> {
        const guild = interaction.guild!;
        const view = await SetupView(this.client, guild, state);
        const payload = { ...view, flags: MessageFlags.IsComponentsV2 as const };

        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else if (interaction.isModalSubmit()) await interaction.reply({ ...view, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        else await interaction.update(payload);

        if (interaction.message) SetupStates.set(interaction.message.id, state);
    }

    private async Fail(interaction: MessageComponentInteraction | ModalSubmitInteraction, text: string): Promise<void> {
        const view = {
            ...new ComponentV2Builder({ accentColor: "Red" }).text(`❌ ${text}`).toMessage({ ephemeral: true }),
        };

        if (interaction.replied || interaction.deferred) await interaction.followUp(view).catch(() => undefined);
        else await interaction.reply(view).catch(() => undefined);
    }
}
