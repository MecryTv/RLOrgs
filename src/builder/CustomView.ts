import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    EmbedBuilder,
    MessageActionRowComponentBuilder,
    MessageFlags,
    MessageMentionOptions,
} from "discord.js";
import BotClient from "../client/BotClient";
import { RenderDoc } from "./MessageDoc";
import { MESSAGE_PREFIX } from "../constants/Messages";
import { AnyPlaceholderValues, Fill } from "../constants/Placeholders";
import { ICustomButton, ICustomEmbed, MessageKind } from "../interfaces/services/messages/IMessages";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";
import { ButtonOptions } from "../interfaces/builder/IComponentV2Builder";

/**
 * Eine eigene Nachricht: als Karte (Components V2), als Embed oder ganz normal.
 * Die Knöpfe hängen an der Nachricht, nicht an einer Sitzung - ihre Custom-ID
 * trägt die ID der Nachricht und die des Knopfes und funktioniert deshalb auch
 * nach einem Neustart noch.
 */

export interface ICustomView {
    content?: string;
    embeds?: EmbedBuilder[];
    components: (ContainerBuilder | ActionRowBuilder<MessageActionRowComponentBuilder>)[];
    files?: AttachmentBuilder[];
    flags?: MessageFlags.IsComponentsV2;
    allowedMentions: MessageMentionOptions;
}

export interface ICustomSource {
    id: number;
    kind: MessageKind;
    content: string;
    embed: ICustomEmbed | null;
    doc: IMessageDoc;
    buttons: ICustomButton[];
}

const STYLES: Record<string, ButtonStyle> = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
};

/** Die Knöpfe als klassische Reihen - für Embed und normale Nachricht. */
function rows(id: number, buttons: ICustomButton[]): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const list: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

    for (let index = 0; index < buttons.length; index += 5) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

        for (const button of buttons.slice(index, index + 5)) {
            const builder = new ButtonBuilder().setLabel(button.label.slice(0, 80));

            if (button.emoji) builder.setEmoji(button.emoji);

            if (button.action === "link") builder.setStyle(ButtonStyle.Link).setURL(button.url ?? "https://discord.com");
            else builder.setStyle(STYLES[button.tone] ?? ButtonStyle.Secondary).setCustomId(`${MESSAGE_PREFIX}:btn:${id}:${button.id}`);

            row.addComponents(builder);
        }

        list.push(row);
    }

    return list;
}

/** Die Knöpfe innerhalb der Karte - dort baut sie der ComponentV2Builder. */
function v2Buttons(id: number, buttons: ICustomButton[]): ButtonOptions[][] {
    const chunks: ButtonOptions[][] = [];

    for (let index = 0; index < buttons.length; index += 5) {
        chunks.push(
            buttons.slice(index, index + 5).map((button): ButtonOptions => {
                if (button.action === "link") return { url: button.url ?? "https://discord.com", label: button.label, ...(button.emoji ? { emoji: button.emoji } : {}) };

                return { customId: `${MESSAGE_PREFIX}:btn:${id}:${button.id}`, label: button.label, tone: button.tone, ...(button.emoji ? { emoji: button.emoji } : {}) };
            })
        );
    }

    return chunks;
}

function EmbedOf(embed: ICustomEmbed, values: AnyPlaceholderValues): EmbedBuilder {
    const text = (value: string | null): string | null => (value ? Fill(value, values) : null);
    const builder = new EmbedBuilder();
    const title = text(embed.title);
    const description = text(embed.description);

    if (title) builder.setTitle(title.slice(0, 256));
    if (description) builder.setDescription(description.slice(0, 4000));
    if (embed.color) builder.setColor(embed.color as `#${string}`);
    if (embed.url) builder.setURL(embed.url);
    if (embed.image) builder.setImage(embed.image);
    if (embed.thumbnail) builder.setThumbnail(embed.thumbnail);
    if (embed.author?.name) builder.setAuthor({ name: Fill(embed.author.name, values).slice(0, 256), ...(embed.author.icon ? { iconURL: embed.author.icon } : {}) });
    if (embed.footer?.text) builder.setFooter({ text: Fill(embed.footer.text, values).slice(0, 2048), ...(embed.footer.icon ? { iconURL: embed.footer.icon } : {}) });
    if (embed.timestamp) builder.setTimestamp(new Date());

    const fields = embed.fields
        .filter((field) => field.name.trim() && field.value.trim())
        .slice(0, 10)
        .map((field) => ({ name: Fill(field.name, values).slice(0, 256), value: Fill(field.value, values).slice(0, 1024), inline: field.inline }));

    if (fields.length) builder.addFields(fields);

    return builder;
}

/** Was an Discord geht - je nach Art der Nachricht. */
export async function CustomMessageView(client: BotClient, source: ICustomSource, values: AnyPlaceholderValues = {}): Promise<ICustomView> {
    const buttons = source.buttons.slice(0, 10);

    if (source.kind === "v2") {
        const chunks = v2Buttons(source.id, buttons);
        const { builder, files } = await RenderDoc(client, source.doc, values, { reserve: chunks.length + 1, fallback: "Leere Nachricht" });

        for (const chunk of chunks) builder.buttons(...chunk);

        return { components: [builder.build()], files, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
    }

    const content = source.content ? Fill(source.content, values).slice(0, 2000) : "";
    const embeds = source.kind === "embed" && source.embed ? [EmbedOf(source.embed, values)] : [];

    return {
        content: content || undefined,
        embeds,
        components: rows(source.id, buttons),
        allowedMentions: { parse: [] },
    };
}
