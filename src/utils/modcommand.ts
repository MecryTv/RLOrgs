import { AutocompleteInteraction, ChatInputCommandInteraction, GuildMember, MessageFlags } from "discord.js";
import BotClient from "../client/BotClient";
import { DoneView, IModView, ModErrorView } from "../builder/ModerationView";
import { DURATION_PRESETS, FormatDuration, ParseDuration } from "../constants/Moderation";
import { IModActor, IModRequest, ModerationError } from "../services/ModerationService";
import logger from "./logger";

/**
 * Was alle Moderations-Befehle teilen: Antwort nur für den Moderator, Fehler
 * als Satz statt als Absturz, Dauer-Angaben mit Vorschlägen.
 */

const PERMANENT = new Set(["dauerhaft", "permanent", "perm", "für immer"]);

/** "1h30m" -> 5400. Unverständlich wirft - ein Tippfehler darf keinen Bann dauerhaft machen. */
export function ReadDuration(text: string | null, permanent: boolean): number | null {
    const value = (text ?? "").trim().toLowerCase();

    if (!value || (permanent && PERMANENT.has(value))) return null;

    const seconds = ParseDuration(value);

    if (seconds === null) throw new ModerationError(`„${text}“ verstehe ich nicht als Dauer – etwa 10m, 2h, 3d oder 1w.`);

    return seconds;
}

/** Vorschläge für ein Dauer-Feld: die Voreinstellungen - und was gerade getippt wird, sofern es passt. */
export async function SuggestDuration(interaction: AutocompleteInteraction, permanent: boolean, max: number): Promise<void> {
    const typed = interaction.options.getFocused().trim().toLowerCase();
    const parsed = typed ? ParseDuration(typed) : null;
    const choices: { name: string; value: string }[] = [];

    if (parsed !== null && parsed <= max) choices.push({ name: FormatDuration(parsed), value: `${parsed}s` });
    if (permanent && (!typed || "dauerhaft".startsWith(typed))) choices.push({ name: "Dauerhaft", value: "dauerhaft" });

    for (const [name, seconds] of DURATION_PRESETS) {
        if (seconds > max || seconds === parsed) continue;
        if (!typed || name.toLowerCase().includes(typed)) choices.push({ name, value: `${seconds}s` });
    }

    await interaction.respond(choices.slice(0, 25)).catch(() => undefined);
}

export async function ModSay(interaction: ChatInputCommandInteraction, view: IModView): Promise<void> {
    const message = { ...view, flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };

    if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => undefined);
    else await interaction.reply({ ...message, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => undefined);
}

export function Fail(interaction: ChatInputCommandInteraction, error: unknown, what: string): Promise<void> {
    if (!(error instanceof ModerationError)) logger.error(`🛡️ /${interaction.commandName} (${what}) fehlgeschlagen`, error);

    return ModSay(interaction, ModErrorView(error instanceof ModerationError ? error.message : "Da ging etwas schief – versuch es gleich nochmal."));
}

/** Das Mitglied hinter dem Befehl - samt Rollen, die Rechteprüfung braucht sie. */
export async function MemberOf(interaction: ChatInputCommandInteraction): Promise<GuildMember> {
    const guild = interaction.guild;

    if (!guild) throw new ModerationError("Diesen Befehl gibt es nur auf einem Server.");

    return interaction.member instanceof GuildMember ? interaction.member : guild.members.fetch(interaction.user.id);
}

export function ActorOf(member: GuildMember): IModActor {
    return { id: member.id, name: member.displayName, member };
}

/**
 * Eine Aktion aus einem Befehl. build liest die Optionen - wirft es, steht der
 * Satz als Antwort da. Die Antwort sieht nur der Moderator; öffentlich ist die
 * Karte im Log-Kanal.
 */
export async function RunAction(client: BotClient, interaction: ChatInputCommandInteraction, build: () => IModRequest): Promise<void> {
    try {
        const request = build();
        const member = await MemberOf(interaction);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const entry = await client.moderationService.Act(member.guild, member, request, "discord");

        await ModSay(interaction, DoneView(entry, entry.logMessage !== null));
    } catch (error) {
        await Fail(interaction, error, "Aktion");
    }
}

