import {
    ButtonInteraction,
    Events,
    GuildMember,
    Interaction,
    LabelBuilder,
    MessageComponentInteraction,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    StringSelectMenuInteraction,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuInteraction,
} from "discord.js";
import BotClient from "../../client/BotClient";
import Event from "../../structures/Event";
import ComponentV2Builder from "../../builder/ComponentV2Builder";
import {
    ErrorView,
    InfoView,
    ITicketView,
    MessageView,
    PanelView,
    SummaryView,
    TicketValues,
    VaultView,
} from "../../builder/TicketPanel";
import { ITicketContext, SlowmodeLabel, TicketError } from "../../services/TicketService";
import { ParseDate, ParseTime, ZonedDate } from "../../services/RunnableService";
import {
    PRIORITIES,
    PRIORITY_LABELS,
    SLOWMODE_STEPS,
    TICKET_PREFIX,
    TicketNumber,
    TicketPriority,
} from "../../constants/Tickets";
import logger from "../../utils/logger";

/** Eine Antwort, die nur der Klickende sieht. */
function Reply(view: ITicketView) {
    return { ...view, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
}

/** Dieselbe Ansicht als Ersatz einer bestehenden Nachricht - update kennt kein Ephemeral. */
function Edit(view: ITicketView) {
    return { ...view, flags: MessageFlags.IsComponentsV2 as const };
}

/**
 * Alles, was im Ticket-System angeklickt wird: Panel, Aktions-Menü, die
 * Nachfragen dazu und die Knöpfe in der DM bei ModMail. Der Assistent von
 * /ticket setup hat sein eigenes Präfix und seinen eigenen Handler.
 */
export default class TicketHandler extends Event {
    constructor(client: BotClient) {
        super(client, {
            name: Events.InteractionCreate,
            description: "Bedient Ticket-Panel, Aktions-Menü und die DM-Knöpfe",
            once: false,
        });
    }

    async Execute(interaction: Interaction): Promise<void> {
        const isComponent = interaction.isMessageComponent();

        if (!isComponent && !interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith(`${TICKET_PREFIX}:`)) return;

        const [, action, argument] = interaction.customId.split(":");

        try {
            if (interaction.isModalSubmit()) await this.Modal(interaction, action, argument);
            else await this.Component(interaction, action, argument);
        } catch (error) {
            if (error instanceof TicketError) {
                await this.Fail(interaction, error.message);

                return;
            }

            const normalized = error instanceof Error ? error : new Error(String(error));

            await this.Fail(interaction, "Das hat nicht geklappt – ich habe es den Entwicklern gemeldet.");
            await this.client.guardian.ReportError(normalized, interaction, `Ticket Error: ${interaction.customId}`);
        }
    }

    /* ----------------------------------------------------------
       Knöpfe und Menüs
       ---------------------------------------------------------- */
    private async Component(interaction: MessageComponentInteraction, action: string, argument: string): Promise<void> {
        if (action === "open") return this.Open(interaction, argument);
        if (action === "act" && interaction.isStringSelectMenu()) return this.Action(interaction, Number(argument));
        if (action === "dmclose" && interaction.isButton()) return this.CloseFromDirect(interaction, Number(argument));
        if (action === "dmguild" && interaction.isStringSelectMenu()) return this.DirectGuild(interaction);
        if (action === "dmopt" && interaction.isStringSelectMenu()) return this.OpenFromDirect(interaction, argument, interaction.values[0]);
        if (action === "adduser" && interaction.isUserSelectMenu()) return this.Members(interaction, Number(argument), true);
        if (action === "removeuser" && interaction.isUserSelectMenu()) return this.Members(interaction, Number(argument), false);

        if (!interaction.isStringSelectMenu()) return;

        const value = interaction.values[0];
        const service = this.client.ticketService;

        if (action === "transfer") {
            return this.Run(interaction, Number(argument), async (context, member) => {
                await service.Transfer(context, member, value);

                return `🔁 Verschoben nach **${context.config.options.find((option) => option.id === value)?.name ?? value}**.`;
            });
        }

        if (action === "priority") {
            return this.Run(interaction, Number(argument), async (context, member) => {
                const priority = value as TicketPriority;

                await service.SetPriority(context, member, priority);

                return `${PRIORITY_LABELS[priority].emoji} Priorität steht auf **${PRIORITY_LABELS[priority].name}**.`;
            });
        }

        if (action === "slowmode") {
            return this.Run(interaction, Number(argument), async (context, member) => {
                await service.SetSlowmode(context, member, Number(value));

                return `⏱️ Slowmode: **${SlowmodeLabel(Number(value))}**.`;
            });
        }
    }

    /** Panel-Klick: Knopf mit der Option in der customId oder Auswahlmenü. */
    private async Open(interaction: MessageComponentInteraction, argument: string): Promise<void> {
        const optionId = interaction.isStringSelectMenu() ? interaction.values[0] : argument;
        const guild = interaction.guild;

        if (!guild) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Discord merkt sich die Auswahl im Menü, bis die Nachricht neu kommt -
        // sonst ließe sich dieselbe Option kein zweites Mal wählen.
        if (interaction.isStringSelectMenu()) void this.ResetPanel(interaction);

        try {
            const ticket = await this.client.ticketService.Open(guild, interaction.user, optionId);

            await interaction.editReply(
                Edit(
                    InfoView(
                        ticket.contact === "modmail"
                            ? `📬 Dein Ticket ${TicketNumber(ticket.number)} ist offen – schreib mir einfach hier per DM weiter.`
                            : `🎫 Dein Ticket ${TicketNumber(ticket.number)} steht bereit: <#${ticket.channelId}>`,
                        "#35e07f"
                    )
                )
            );
        } catch (error) {
            if (!(error instanceof TicketError)) throw error;

            // Für Gesperrte zeigt der Server seine eigene Absage statt eines Fehlers.
            if (error.doc) {
                const config = await this.client.ticketSettings.Of(guild.id);
                const values = TicketValues(guild, config, { user: interaction.user });

                await interaction.editReply(Edit(await MessageView(this.client, guild, config, error.doc, values)));

                return;
            }

            await interaction.editReply(Edit(ErrorView(error.message)));
        }
    }

    private async ResetPanel(interaction: StringSelectMenuInteraction): Promise<void> {
        const guild = interaction.guild;

        if (!guild) return;

        const config = await this.client.ticketSettings.Of(guild.id);

        if (config.style !== "select") return;

        const view = await PanelView(this.client, guild, config);

        await interaction.message.edit({ ...view, attachments: [], allowedMentions: { parse: [] } }).catch(() => undefined);
    }

    /* ----------------------------------------------------------
       Das Aktions-Menü im Ticket
       ---------------------------------------------------------- */
    private async Action(interaction: StringSelectMenuInteraction, ticketId: number): Promise<void> {
        const service = this.client.ticketService;
        const context = await service.Context(ticketId);
        const member = await this.Member(interaction);
        const action = interaction.values[0];

        // Schließen darf auch der Ersteller - alles andere nur das Team. Geprüft
        // wird vor jedem Modal und jeder Nachfrage, nicht erst danach.
        if (action !== "close" && !service.IsStaff(member, context)) throw new TicketError("Das darf nur das Team.");

        // Sonst zeigt das Menü die zuletzt gewählte Aktion weiter an. Wer seine
        // Nachricht ohnehin selbst neu zeichnet, bekommt keine zweite Anfrage
        // dazwischen, die mit altem Stand zuletzt ankommen könnte.
        if (!["claim", "unclaim", "freeze"].includes(action)) void service.Refresh(context);

        switch (action) {
            case "close":
                return this.AskText(interaction, "close", ticketId, {
                    title: "Ticket schließen",
                    label: "Grund",
                    hint: "Optional – steht in der Abschluss-Nachricht",
                    id: "reason",
                    required: false,
                    max: 300,
                });

            case "staff_note":
                return this.AskText(interaction, "note", ticketId, {
                    title: "Team-Notiz",
                    label: "Notiz",
                    hint: "Nur fürs Team – der User sieht sie nie",
                    id: "note",
                    required: true,
                    max: 1000,
                    long: true,
                });

            case "blacklist":
                return this.AskText(interaction, "blacklist", ticketId, {
                    title: "User sperren",
                    label: "Grund",
                    hint: "Der User kann danach keine Tickets mehr öffnen, das Ticket wird geschlossen.",
                    id: "reason",
                    required: false,
                    max: 300,
                });

            case "schedule_meeting":
                return this.AskSchedule(interaction, ticketId);

            case "add_user":
            case "remove_user": {
                const add = action === "add_user";

                await interaction.reply(
                    Reply({
                        components: [
                            new ComponentV2Builder({ accentColor: "#00afff" })
                                .text(add ? "Wen soll ich zum Ticket hinzufügen?" : "Wen soll ich aus dem Ticket entfernen?")
                                .userSelect({
                                    customId: `${TICKET_PREFIX}:${add ? "adduser" : "removeuser"}:${ticketId}`,
                                    placeholder: add ? "User hinzufügen …" : "User entfernen …",
                                })
                                .build(),
                        ],
                        files: [],
                    })
                );

                return;
            }

            case "transfer": {
                const others = context.config.options.filter((option) => option.id !== context.ticket.optionId);

                if (others.length === 0) throw new TicketError("Es gibt keine andere Option, in die das Ticket passt.");

                await interaction.reply(
                    Reply({
                        components: [
                            new ComponentV2Builder({ accentColor: "#00afff" })
                                .text("Wohin soll das Ticket?")
                                .select({
                                    customId: `${TICKET_PREFIX}:transfer:${ticketId}`,
                                    placeholder: "Option wählen …",
                                    options: others.slice(0, 25).map((option) => ({
                                        label: option.name,
                                        value: option.id,
                                        description: option.description || undefined,
                                        emoji: option.emoji ?? undefined,
                                    })),
                                })
                                .build(),
                        ],
                        files: [],
                    })
                );

                return;
            }

            case "priority": {
                await interaction.reply(
                    Reply({
                        components: [
                            new ComponentV2Builder({ accentColor: "#00afff" })
                                .text("Wie dringend ist das Ticket?")
                                .select({
                                    customId: `${TICKET_PREFIX}:priority:${ticketId}`,
                                    placeholder: "Priorität wählen …",
                                    options: PRIORITIES.map((priority) => ({
                                        label: PRIORITY_LABELS[priority].name,
                                        value: priority,
                                        emoji: PRIORITY_LABELS[priority].emoji,
                                        default: context.ticket.priority === priority,
                                    })),
                                })
                                .build(),
                        ],
                        files: [],
                    })
                );

                return;
            }

            case "slowmode": {
                await interaction.reply(
                    Reply({
                        components: [
                            new ComponentV2Builder({ accentColor: "#00afff" })
                                .text(
                                    context.ticket.contact === "modmail"
                                        ? "Wie schnell darf der User schreiben? Bei ModMail bremst der Bot das Weiterleiten."
                                        : "Wie schnell darf im Ticket geschrieben werden?"
                                )
                                .select({
                                    customId: `${TICKET_PREFIX}:slowmode:${ticketId}`,
                                    placeholder: "Slowmode wählen …",
                                    options: SLOWMODE_STEPS.map((seconds) => ({
                                        label: SlowmodeLabel(seconds),
                                        value: String(seconds),
                                        default: context.ticket.slowmode === seconds,
                                    })),
                                })
                                .build(),
                        ],
                        files: [],
                    })
                );

                return;
            }

            case "claim":
                await service.Claim(context, member);

                return this.Done(interaction, "✅ Du bearbeitest das Ticket jetzt.");

            case "unclaim":
                await service.Unclaim(context, member);

                return this.Done(interaction, "↩️ Das Ticket wartet wieder auf das Team.");

            case "freeze": {
                const frozen = await service.ToggleFreeze(context, member);

                return this.Done(interaction, frozen ? "🥶 Das Ticket ist eingefroren." : "🔓 Das Ticket ist wieder offen.");
            }

            case "anonymous_mode": {
                const on = await service.ToggleAnonymous(context, member);

                return this.Done(
                    interaction,
                    on
                        ? "🛡️ Anonymer Modus an – deine Nachrichten in diesem Ticket erscheinen unter dem Team-Alias."
                        : "🛡️ Anonymer Modus aus – du schreibst wieder unter deinem Namen."
                );
            }

            case "tldr_summary": {
                if (!service.IsStaff(member, context)) throw new TicketError("Das darf nur das Team.");

                await interaction.reply(Reply(SummaryView(context.config, context.ticket)));

                return;
            }

            case "media_vault": {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const items = await service.Vault(context, member);

                await interaction.editReply(Edit(VaultView(context.ticket, items)));

                return;
            }

            default:
                throw new TicketError("Diese Aktion kenne ich nicht.");
        }
    }

    /* ----------------------------------------------------------
       Nachfragen
       ---------------------------------------------------------- */
    private async Members(interaction: UserSelectMenuInteraction, ticketId: number, add: boolean): Promise<void> {
        const service = this.client.ticketService;
        const context = await service.Context(ticketId);
        const member = await this.Member(interaction);
        const user = interaction.users.first();

        if (!user) throw new TicketError("Da war niemand ausgewählt.");

        if (add) await service.AddUser(context, member, user);
        else await service.RemoveUser(context, member, user);

        await interaction.update(
            Edit(InfoView(add ? `➕ ${user} ist jetzt im Ticket.` : `➖ ${user} ist nicht mehr im Ticket.`, "#35e07f"))
        );
    }

    /** Eine Auswahl, die eine Aktion auslöst und die Nachfrage danach ersetzt. */
    private async Run(
        interaction: StringSelectMenuInteraction,
        ticketId: number,
        work: (context: ITicketContext, member: GuildMember) => Promise<string>
    ): Promise<void> {
        const context = await this.client.ticketService.Context(ticketId);
        const member = await this.Member(interaction);
        const text = await work(context, member);

        await interaction.update(Edit(InfoView(text, "#35e07f")));
    }

    private async AskText(
        interaction: StringSelectMenuInteraction,
        action: string,
        ticketId: number,
        field: { title: string; label: string; hint: string; id: string; required: boolean; max: number; long?: boolean }
    ): Promise<void> {
        await interaction.showModal(
            new ModalBuilder()
                .setCustomId(`${TICKET_PREFIX}:${action}:${ticketId}`)
                .setTitle(field.title)
                .addLabelComponents(
                    new LabelBuilder()
                        .setLabel(field.label)
                        .setDescription(field.hint)
                        .setTextInputComponent(
                            new TextInputBuilder()
                                .setCustomId(field.id)
                                .setStyle(field.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
                                .setRequired(field.required)
                                .setMaxLength(field.max)
                        )
                )
        );
    }

    private async AskSchedule(interaction: StringSelectMenuInteraction, ticketId: number): Promise<void> {
        const field = (id: string, label: string, hint: string, required: boolean, max: number, placeholder?: string) =>
            new LabelBuilder()
                .setLabel(label)
                .setDescription(hint)
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId(id)
                        .setStyle(TextInputStyle.Short)
                        .setRequired(required)
                        .setMaxLength(max)
                        .setPlaceholder(placeholder ?? "")
                );

        await interaction.showModal(
            new ModalBuilder()
                .setCustomId(`${TICKET_PREFIX}:schedule:${ticketId}`)
                .setTitle("Termin vereinbaren")
                .addLabelComponents(
                    field("date", "Datum", "TT.MM.JJJJ", true, 10, "24.12.2026"),
                    field("time", "Uhrzeit", "HH:MM in deutscher Zeit", true, 5, "18:30"),
                    field("note", "Notiz", "Optional – worum es im Gespräch geht", false, 300)
                )
        );
    }

    /* ----------------------------------------------------------
       Modals
       ---------------------------------------------------------- */
    private async Modal(interaction: ModalSubmitInteraction, action: string, argument: string): Promise<void> {
        const service = this.client.ticketService;
        const context = await service.Context(Number(argument));
        const member = await this.Member(interaction);

        if (action === "close") {
            await service.Close(context, member, interaction.fields.getTextInputValue("reason"));

            return this.Done(interaction, "🔒 Ticket geschlossen.");
        }

        if (action === "note") {
            await service.AddNote(context, member, interaction.fields.getTextInputValue("note"));

            return this.Done(interaction, "📝 Notiz gespeichert – nur das Team sieht sie.");
        }

        if (action === "blacklist") {
            await service.Blacklist(context, member, interaction.fields.getTextInputValue("reason"));

            return this.Done(interaction, "🚫 User gesperrt und Ticket geschlossen.");
        }

        if (action === "schedule") {
            const date = ParseDate(interaction.fields.getTextInputValue("date"));
            const time = ParseTime(interaction.fields.getTextInputValue("time"));

            if (!date || !time) throw new TicketError("Datum oder Uhrzeit passen nicht: TT.MM.JJJJ und HH:MM.");

            const at = ZonedDate(date.year, date.month, date.day, time.hours, time.minutes).getTime();

            await service.Schedule(context, member, at, interaction.fields.getTextInputValue("note"));

            return this.Done(interaction, `📅 Termin steht: <t:${Math.floor(at / 1000)}:F>`);
        }
    }

    /* ----------------------------------------------------------
       ModMail in der DM
       ---------------------------------------------------------- */
    private async CloseFromDirect(interaction: ButtonInteraction, ticketId: number): Promise<void> {
        const service = this.client.ticketService;
        const context = await service.Context(ticketId);

        await service.Close(context, interaction.user, "Vom User geschlossen");
        await interaction.reply(Reply(InfoView("🔒 Dein Ticket ist geschlossen. Danke!", "#35e07f")));
    }

    private async DirectGuild(interaction: StringSelectMenuInteraction): Promise<void> {
        const guild = this.client.guilds.cache.get(interaction.values[0]);

        if (!guild) throw new TicketError("Diesen Server erreiche ich gerade nicht.");

        const config = await this.client.ticketSettings.Of(guild.id);

        if (config.options.length <= 1) {
            return this.OpenFromDirect(interaction, guild.id, config.options[0]?.id ?? "");
        }

        await interaction.update(
            Edit({
                components: [
                    new ComponentV2Builder({ accentColor: "#ff1e2d" })
                        .title(`🎫 | ${guild.name}`, "Worum geht es?")
                        .select({
                            customId: `${TICKET_PREFIX}:dmopt:${guild.id}`,
                            placeholder: "Thema wählen …",
                            options: config.options.slice(0, 25).map((option) => ({
                                label: option.name,
                                value: option.id,
                                description: option.description || undefined,
                                emoji: option.emoji ?? undefined,
                            })),
                        })
                        .build(),
                ],
                files: [],
            })
        );
    }

    private async OpenFromDirect(interaction: StringSelectMenuInteraction, guildId: string, optionId: string): Promise<void> {
        const guild = this.client.guilds.cache.get(guildId);

        if (!guild) throw new TicketError("Diesen Server erreiche ich gerade nicht.");

        await interaction.deferUpdate();

        try {
            const ticket = await this.client.ticketService.Open(guild, interaction.user, optionId);

            await interaction.message.edit(
                Edit(InfoView(`✅ Ticket ${TicketNumber(ticket.number)} auf **${guild.name}** ist offen.`, "#35e07f"))
            );

            await this.client.ticketService.FlushPending(interaction.user, ticket);
        } catch (error) {
            if (!(error instanceof TicketError)) throw error;

            await interaction.message.edit(Edit(ErrorView(error.message)));
        }
    }

    /* ----------------------------------------------------------
       Kleinkram
       ---------------------------------------------------------- */
    private async Member(interaction: MessageComponentInteraction | ModalSubmitInteraction): Promise<GuildMember> {
        if (interaction.member instanceof GuildMember) return interaction.member;

        const guild = interaction.guild;

        if (!guild) throw new TicketError("Diese Aktion geht nur auf dem Server selbst.");

        const member = await guild.members.fetch(interaction.user.id).catch(() => null);

        if (!member) throw new TicketError("Ich finde dich auf diesem Server nicht.");

        return member;
    }

    private async Done(interaction: MessageComponentInteraction | ModalSubmitInteraction, text: string): Promise<void> {
        const view = Reply(InfoView(text, "#35e07f"));

        if (interaction.replied || interaction.deferred) await interaction.followUp(view);
        else await interaction.reply(view);
    }

    private async Fail(interaction: MessageComponentInteraction | ModalSubmitInteraction, text: string): Promise<void> {
        const view = Reply(ErrorView(text));

        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp(view);
            else await interaction.reply(view);
        } catch (problem) {
            logger.warn(`🎫 Fehlermeldung nicht zustellbar: ${String(problem)}`);
        }
    }
}
