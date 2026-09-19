import { ContainerBuilder, escapeMarkdown } from "discord.js";
import ComponentV2Builder from "./ComponentV2Builder";
import { ACTION_INFO, CaseRef, DELETE_CHOICES, FormatDuration } from "../constants/Moderation";
import { IModCase } from "../interfaces/services/moderation/IModeration";

/**
 * Wie ein Fall in Discord aussieht: die Karte im Log-Kanal, die DM an den
 * Betroffenen und die Antwort auf einen Befehl. Alles Components V2.
 */

export interface IModView {
    components: ContainerBuilder[];
}

const SOURCE: Record<IModCase["source"], string> = {
    discord: "per Befehl",
    dashboard: "im Dashboard",
    auto: "automatisch",
};

function Stamp(ms: number, style = "f"): string {
    return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function Name(text: string | null, fallback: string): string {
    return text ? escapeMarkdown(text) : fallback;
}

/** "gilt", "aufgehoben durch Fall #14", "abgelaufen" - leer bei Aktionen, die nie gelten. */
export function StatusText(entry: IModCase): string {
    const ended = entry.details.ended;

    if (entry.active) return entry.expiresAt ? `gilt bis ${Stamp(entry.expiresAt)}` : "gilt";
    if (!ended) return "";

    const by = ended.case !== null ? ` durch Fall ${CaseRef(ended.case)}` : "";

    if (ended.how === "expired") return `abgelaufen ${Stamp(ended.at, "R")}`;
    if (ended.how === "discord") return `in Discord aufgehoben ${Stamp(ended.at, "R")}`;
    if (ended.how === "replaced") return `ersetzt${by}`;

    return `aufgehoben${by}${ended.byName ? ` (${escapeMarkdown(ended.byName)})` : ""}`;
}

/** Die Zeilen, die Log, Antwort und Befehl /fall teilen. */
function Facts(entry: IModCase, mentions: boolean): string[] {
    const lines: string[] = [];
    const who = (id: string | null, name: string | null): string =>
        id ? (mentions ? `<@${id}> · \`${Name(name, id)}\`` : `**${Name(name, id)}**`) : "–";

    if (entry.targetId) lines.push(`**User:** ${who(entry.targetId, entry.targetName)}${mentions ? ` · \`${entry.targetId}\`` : ""}`);

    lines.push(`**Moderator:** ${who(entry.moderatorId, entry.moderatorName)}`);

    if (entry.reason) lines.push(`**Grund:** ${escapeMarkdown(entry.reason)}`);

    if (entry.duration) {
        lines.push(`**Dauer:** ${FormatDuration(entry.duration)}${entry.expiresAt ? ` · endet ${Stamp(entry.expiresAt, "R")}` : ""}`);
    } else if (entry.action === "ban") {
        lines.push("**Dauer:** dauerhaft");
    }

    if (entry.details.deleteSeconds) {
        const choice = DELETE_CHOICES.find(([seconds]) => seconds === entry.details.deleteSeconds);

        lines.push(`**Nachrichten mitgelöscht:** ${choice ? choice[1] : FormatDuration(entry.details.deleteSeconds)}`);
    }

    if (entry.action === "purge") {
        lines.push(
            `**Kanal:** ${entry.details.channelId ? `<#${entry.details.channelId}>` : "–"} · ${entry.details.deleted ?? 0} von ${entry.details.requested ?? 0} gelöscht`
        );
    }

    if (entry.action === "warn" && entry.details.warns) {
        const stage = entry.details.stage;
        const then = stage
            ? ` → ${ACTION_INFO[stage.action].label}${stage.duration ? ` (${FormatDuration(stage.duration)})` : ""}${
                  stage.case !== null ? `, Fall ${CaseRef(stage.case)}` : stage.error ? ` – ging nicht: ${escapeMarkdown(stage.error)}` : ""
              }`
            : "";

        lines.push(`**Aktive Verwarnungen:** ${entry.details.warns}${then}`);
    }

    if (entry.related !== null) lines.push(`**Bezieht sich auf:** Fall ${CaseRef(entry.related)}`);

    return lines;
}

function Footer(entry: IModCase): string {
    const parts = [StatusText(entry)];

    if (entry.notes.length) parts.push(`${entry.notes.length} ${entry.notes.length === 1 ? "Notiz" : "Notizen"}`);
    if (entry.evidence.length) parts.push(`${entry.evidence.length} ${entry.evidence.length === 1 ? "Beweis" : "Beweise"}`);
    if (entry.details.dm !== undefined) parts.push(entry.details.dm ? "DM zugestellt" : "DM nicht zustellbar");

    return parts.filter(Boolean).join(" · ");
}

/** Die Karte im Log-Kanal - sie wird bei jeder Änderung am Fall nachgezogen. */
export function CaseView(entry: IModCase, link: string | null): IModView {
    const info = ACTION_INFO[entry.action];
    const builder = new ComponentV2Builder({ accentColor: entry.active || !entry.details.ended ? info.color : "#6b7683" })
        .title(`${info.emoji} | ${info.label} · Fall ${CaseRef(entry.number)}`, `${SOURCE[entry.source]} · ${Stamp(entry.createdAt)}`)
        .separator()
        .text(Facts(entry, true).join("\n"));

    const footer = Footer(entry);

    if (footer) builder.subtext(footer);
    if (link) builder.buttons({ url: link, label: "Im Dashboard öffnen", emoji: "🛡️" });

    return { components: [builder.build()] };
}

/** Die DM an den Betroffenen. Der Name des Moderators steht bewusst nicht drin. */
export function DirectView(entry: IModCase, guildName: string): IModView {
    const info = ACTION_INFO[entry.action];
    const server = `**${escapeMarkdown(guildName)}**`;
    const titles: Partial<Record<IModCase["action"], string>> = {
        ban: `Du wurdest auf ${server} gebannt`,
        kick: `Du wurdest von ${server} gekickt`,
        timeout: `Du bist auf ${server} stummgeschaltet`,
        untimeout: `Dein Timeout auf ${server} ist aufgehoben`,
        warn: `Du wurdest auf ${server} verwarnt`,
        unwarn: `Eine Verwarnung auf ${server} wurde entfernt`,
    };
    const lines: string[] = [];

    if (entry.reason) lines.push(`**Grund:** ${escapeMarkdown(entry.reason)}`);
    if (entry.duration) lines.push(`**Dauer:** ${FormatDuration(entry.duration)}${entry.expiresAt ? ` – endet ${Stamp(entry.expiresAt)}` : ""}`);
    else if (entry.action === "ban") lines.push("**Dauer:** dauerhaft");
    if (entry.action === "warn" && entry.details.warns) lines.push(`Das ist deine **${entry.details.warns}.** aktive Verwarnung.`);

    const builder = new ComponentV2Builder({ accentColor: info.color }).text(`### ${info.emoji} ${titles[entry.action] ?? info.label}`);

    if (lines.length) builder.text(lines.join("\n"));

    builder.subtext(`Fall ${CaseRef(entry.number)} · Fragen dazu beantwortet das Team des Servers.`);

    return { components: [builder.build()] };
}

/** Die Antwort auf einen Befehl - nur für den Moderator sichtbar. */
export function DoneView(entry: IModCase, logged: boolean): IModView {
    const info = ACTION_INFO[entry.action];
    const target = entry.targetId ? `**${Name(entry.targetName, entry.targetId)}**` : null;
    const headline =
        entry.action === "purge"
            ? `${info.emoji} ${entry.details.deleted ?? 0} Nachrichten in <#${entry.details.channelId}> gelöscht`
            : `${info.emoji} ${target ?? "Der User"} wurde ${info.past}`;
    const extra = [Footer(entry), logged ? "im Log-Kanal vermerkt" : ""].filter(Boolean).join(" · ");
    const builder = new ComponentV2Builder({ accentColor: info.color })
        .text(`### ${headline} – Fall ${CaseRef(entry.number)}`)
        .text(Facts(entry, false).filter((line) => !line.startsWith("**Moderator:**") && !line.startsWith("**User:**")).join("\n") || "Ohne Grund.");

    if (extra) builder.subtext(extra);

    return { components: [builder.build()] };
}

/** /fall: der ganze Fall mit Notizen und Beweisen - für das Team. */
export function DetailView(entry: IModCase, link: string | null): IModView {
    const view = CaseView(entry, link);
    const [container] = view.components;
    const extra: string[] = [];

    for (const note of entry.notes.slice(-5)) extra.push(`📝 **${escapeMarkdown(note.byName)}** ${Stamp(note.at, "R")}: ${escapeMarkdown(note.text).slice(0, 300)}`);
    for (const item of entry.evidence.slice(-5)) extra.push(`📎 ${item.kind === "link" ? item.value : escapeMarkdown(item.name ?? item.value)} · ${escapeMarkdown(item.byName)}`);

    if (extra.length) {
        return {
            components: [
                container,
                new ComponentV2Builder({ accentColor: "#6b7683" }).text(extra.join("\n")).build(),
            ],
        };
    }

    return view;
}

/** /verlauf: die letzten Fälle eines Users in einer Karte. */
export function HistoryView(name: string, cases: IModCase[], counts: Partial<Record<IModCase["action"], number>>, link: string | null): IModView {
    const summary = (["warn", "timeout", "kick", "ban"] as const)
        .map((action) => `${ACTION_INFO[action].emoji} ${counts[action] ?? 0}`)
        .join("  ·  ");
    const builder = new ComponentV2Builder({ accentColor: "#00afff" })
        .title(`🛡️ | Verlauf von ${escapeMarkdown(name)}`, summary)
        .separator()
        .text(
            cases.length
                ? cases
                      .map((entry) => {
                          const info = ACTION_INFO[entry.action];
                          const status = StatusText(entry);

                          return `${info.emoji} **Fall ${CaseRef(entry.number)}** · ${info.label} · ${Stamp(entry.createdAt, "d")}${
                              entry.reason ? ` – ${escapeMarkdown(entry.reason).slice(0, 80)}` : ""
                          }${status ? `\n-# ${status}` : ""}`;
                      })
                      .join("\n")
                : "Keine Fälle – eine weiße Weste."
        );

    if (link) builder.buttons({ url: link, label: "Ganzer Verlauf im Dashboard", emoji: "🛡️" });

    return { components: [builder.build()] };
}

export function ModErrorView(text: string): IModView {
    return { components: [new ComponentV2Builder({ accentColor: "Red" }).text(`❌ ${text}`).build()] };
}
