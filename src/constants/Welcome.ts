import path from "path";
import { IWelcomeCard, IWelcomeConfig, IWelcomeMessage } from "../interfaces/services/welcome/IWelcome";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";

/**
 * Welcome System: Grenzen, Platzhalter und die Vorgaben.
 * Siehe docs/Welcome.md.
 */
export const WELCOME_ACCENT = "#00afff";
export const LEAVE_ACCENT = "#6b7683";

/** Hintergrundbilder der Karten - eines je Server und Richtung. */
export const WELCOME_ROOT = path.join(process.cwd(), "welcome");
export const STORED_BACKGROUND = /^(join|leave)\.(png|jpe?g|gif|webp)$/;
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

export const MAX_ROLES = 10;
export const MAX_LINE = 120;
export const MIN_TITLE_SIZE = 28;
export const MAX_TITLE_SIZE = 72;

export const CARD_WIDTH = 1000;
export const CARD_HEIGHT = 340;

/** Was in Texten und auf der Karte eingesetzt wird. */
export const WELCOME_PLACEHOLDER_KEYS = [
    "user",
    "user.name",
    "user.tag",
    "user.id",
    "user.avatar",
    "guild",
    "guild.icon",
    "guild.members",
    "member.number",
    "joined",
    "created",
] as const;

export function DefaultCard(kind: "join" | "leave"): IWelcomeCard {
    return {
        background: null,
        accent: kind === "join" ? WELCOME_ACCENT : LEAVE_ACCENT,
        dim: 45,
        title: kind === "join" ? "Willkommen, {user.name}!" : "Tschüss, {user.name}",
        subtitle: kind === "join" ? "Schön, dass du da bist." : "War schön mit dir.",
        footer: kind === "join" ? "Mitglied Nr. {member.number} auf {guild}" : "{guild} hat jetzt {guild.members} Mitglieder",
        align: "left",
        titleSize: 48,
        avatar: true,
        avatarRing: true,
        avatarShape: "circle",
        count: true,
        icon: true,
        date: false,
    };
}

export function DefaultDoc(kind: "join" | "leave"): IMessageDoc {
    return {
        accent: kind === "join" ? WELCOME_ACCENT : LEAVE_ACCENT,
        blocks: [
            {
                type: "text",
                body:
                    kind === "join"
                        ? "## 👋 Willkommen, {user}!\nSchön, dass du auf **{guild}** bist – du bist Mitglied Nr. {member.number}."
                        : "## 👋 {user.name} hat den Server verlassen\nJetzt sind es noch {guild.members} Mitglieder.",
            },
        ],
    };
}

export function DefaultMessage(kind: "join" | "leave"): IWelcomeMessage {
    return {
        on: kind === "join",
        channelId: null,
        kind: "card",
        content: kind === "join" ? "{user}" : "",
        embed: null,
        doc: DefaultDoc(kind),
        card: DefaultCard(kind),
    };
}

export function DefaultWelcomeConfig(): IWelcomeConfig {
    return { join: DefaultMessage("join"), leave: DefaultMessage("leave"), roles: [], botRoles: [] };
}
