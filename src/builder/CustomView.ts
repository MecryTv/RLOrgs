import { AttachmentBuilder, ContainerBuilder, MessageMentionOptions } from "discord.js";
import BotClient from "../client/BotClient";
import { RenderDoc } from "./MessageDoc";
import { MESSAGE_PREFIX } from "../constants/Messages";
import { AnyPlaceholderValues } from "../constants/Placeholders";
import { ICustomButton } from "../interfaces/services/messages/IMessages";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";
import { ButtonOptions } from "../interfaces/builder/IComponentV2Builder";

/**
 * Eine eigene Nachricht mit ihren Knöpfen. Die Knöpfe hängen an der Nachricht,
 * nicht an einer Sitzung: ihre Custom-ID trägt die ID der Nachricht und die des
 * Knopfes, damit sie auch nach einem Neustart noch funktionieren.
 */

export interface ICustomView {
    components: ContainerBuilder[];
    files?: AttachmentBuilder[];
    allowedMentions: MessageMentionOptions;
}

export async function CustomMessageView(
    client: BotClient,
    id: number,
    doc: IMessageDoc,
    buttons: ICustomButton[],
    values: AnyPlaceholderValues = {}
): Promise<ICustomView> {
    const rows = buttons.slice(0, 10);
    const { builder, files } = await RenderDoc(client, doc, values, { reserve: rows.length ? Math.ceil(rows.length / 5) + 1 : 1, fallback: "Leere Nachricht" });

    // Je fünf Knöpfe eine Reihe - mehr lässt Discord nicht zu.
    for (let index = 0; index < rows.length; index += 5) {
        const chunk = rows.slice(index, index + 5).map((button): ButtonOptions => {
            if (button.action === "link") return { url: button.url ?? "https://discord.com", label: button.label, ...(button.emoji ? { emoji: button.emoji } : {}) };

            return {
                customId: `${MESSAGE_PREFIX}:btn:${id}:${button.id}`,
                label: button.label,
                tone: button.tone,
                ...(button.emoji ? { emoji: button.emoji } : {}),
            };
        });

        builder.buttons(...chunk);
    }

    return { components: [builder.build()], files, allowedMentions: { parse: [] } };
}
