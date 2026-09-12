import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ColorResolvable,
    ContainerBuilder,
    FileBuilder,
    MediaGalleryBuilder,
    MessageActionRowComponentBuilder,
    MessageFlags,
    resolveColor,
    RoleSelectMenuBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    UserSelectMenuBuilder,
} from "discord.js";
import {
    ButtonOptions,
    ButtonTone,
    IComponentV2BuilderOptions,
    IListOptions,
    IProgressOptions,
    IChannelSelectOptions,
    IRoleSelectOptions,
    ISelectMenuOptions,
    ISeparatorOptions,
    IUserSelectOptions,
    SectionAccessory,
} from "../interfaces/builder/IComponentV2Builder";

const MAX_TEXT_LENGTH = 4000;
const MAX_COMPONENTS = 40;
const MAX_BUTTONS_PER_ROW = 5;
const MAX_SELECT_OPTIONS = 25;
const MAX_GALLERY_ITEMS = 10;

const BUTTON_TONES: Record<ButtonTone, ButtonStyle> = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
};

export default class ComponentV2Builder {
    private readonly container = new ContainerBuilder();
    private textBudget = MAX_TEXT_LENGTH;
    private componentBudget = MAX_COMPONENTS - 1;

    constructor(options: IComponentV2BuilderOptions = {}) {
        if (options.accentColor !== undefined) this.container.setAccentColor(resolveColor(options.accentColor));
        if (options.spoiler) this.container.setSpoiler(true);
    }

    public accent(color: ColorResolvable): this {
        this.container.setAccentColor(resolveColor(color));
        return this;
    }

    public title(title: string, subtitle?: string): this {
        const heading = `# ${title.replace(/^#{1,3}\s*/, "")}`;
        return this.text(subtitle ? `${heading}\n-# ${subtitle}` : heading);
    }

    public heading(heading: string, level: 1 | 2 | 3 = 2): this {
        return this.text(`${"#".repeat(level)} ${heading.replace(/^#{1,3}\s*/, "")}`);
    }

    public text(content: string): this {
        this.spend(1);
        this.container.addTextDisplayComponents(new TextDisplayBuilder().setContent(this.fit(content)));
        return this;
    }

    public subtext(content: string): this {
        return this.text(`-# ${content}`);
    }

    public list(items: string[], options: IListOptions = {}): this {
        const { ordered = false, bullet = "-", indent = 0 } = options;
        const padding = " ".repeat(indent * 2);

        return this.text(
            items.map((item, index) => `${padding}${ordered ? `${index + 1}.` : bullet} ${item}`).join("\n")
        );
    }

    public progress(current: number, total: number, options: IProgressOptions = {}): this {
        const { width = 10, filled = "▰", empty = "▱", label, showPercent = true } = options;

        const ratio = Math.min(Math.max(current / Math.max(total, 1), 0), 1);
        const done = Math.round(ratio * width);
        const bar = `\`${filled.repeat(done)}${empty.repeat(width - done)}\``;

        const parts = [bar, `${current} / ${total}${label ? ` ${label}` : ""}`];
        if (showPercent) parts.push(`${Math.round(ratio * 100)} %`);

        return this.text(parts.join(" · "));
    }

    public section(content: string, accessory: SectionAccessory): this {
        this.spend(3);

        const section = new SectionBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(this.fit(content))
        );

        if (accessory.type === "thumbnail") {
            const thumbnail = new ThumbnailBuilder().setURL(accessory.url);
            if (accessory.description) thumbnail.setDescription(accessory.description);
            if (accessory.spoiler) thumbnail.setSpoiler(true);
            section.setThumbnailAccessory(thumbnail);
        } else {
            section.setButtonAccessory(this.toButton(accessory));
        }

        this.container.addSectionComponents(section);
        return this;
    }

    public separator(options: ISeparatorOptions = {}): this {
        const { divider = true, spacing = "small" } = options;

        this.spend(1);
        this.container.addSeparatorComponents(
            new SeparatorBuilder()
                .setDivider(divider)
                .setSpacing(spacing === "large" ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small)
        );

        return this;
    }

    public gallery(...urls: string[]): this {
        if (urls.length === 0) return this;
        if (urls.length > MAX_GALLERY_ITEMS) {
            throw new RangeError(`ComponentV2Builder: max ${MAX_GALLERY_ITEMS} gallery items, got ${urls.length}.`);
        }

        this.spend(1);
        this.container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(urls.map((url) => ({ media: { url } })))
        );

        return this;
    }

    public file(name: string, spoiler = false): this {
        this.spend(1);

        const file = new FileBuilder().setURL(name.startsWith("attachment://") ? name : `attachment://${name}`);
        if (spoiler) file.setSpoiler(true);

        this.container.addFileComponents(file);
        return this;
    }

    public buttons(...buttons: ButtonOptions[]): this {
        if (buttons.length === 0) return this;
        if (buttons.length > MAX_BUTTONS_PER_ROW) {
            throw new RangeError(`ComponentV2Builder: max ${MAX_BUTTONS_PER_ROW} buttons per row, got ${buttons.length}.`);
        }

        this.spend(1 + buttons.length);
        this.container.addActionRowComponents(
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                buttons.map((button) => this.toButton(button))
            )
        );

        return this;
    }

    public select(options: ISelectMenuOptions): this {
        if (options.options.length === 0 || options.options.length > MAX_SELECT_OPTIONS) {
            throw new RangeError(
                `ComponentV2Builder: a select menu needs 1-${MAX_SELECT_OPTIONS} options, got ${options.options.length}.`
            );
        }

        this.spend(2);

        const menu = new StringSelectMenuBuilder()
            .setCustomId(options.customId)
            .addOptions(
                options.options.map((option) => ({
                    label: option.label,
                    value: option.value,
                    description: option.description,
                    emoji: option.emoji,
                    default: option.default,
                }))
            );

        if (options.placeholder) menu.setPlaceholder(options.placeholder);
        if (options.minValues !== undefined) menu.setMinValues(options.minValues);
        if (options.maxValues !== undefined) menu.setMaxValues(options.maxValues);
        if (options.disabled) menu.setDisabled(true);

        this.container.addActionRowComponents(
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)
        );

        return this;
    }

    public channelSelect(options: IChannelSelectOptions): this {
        this.spend(2);

        const menu = new ChannelSelectMenuBuilder().setCustomId(options.customId);

        if (options.channelTypes?.length) menu.addChannelTypes(...options.channelTypes);
        if (options.placeholder) menu.setPlaceholder(options.placeholder);
        if (options.defaultChannel) menu.setDefaultChannels(options.defaultChannel);
        if (options.disabled) menu.setDisabled(true);

        this.container.addActionRowComponents(
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)
        );

        return this;
    }

    public roleSelect(options: IRoleSelectOptions): this {
        this.spend(2);

        const menu = new RoleSelectMenuBuilder().setCustomId(options.customId);

        if (options.placeholder) menu.setPlaceholder(options.placeholder);
        if (options.defaultRole) menu.setDefaultRoles(options.defaultRole);
        if (options.disabled) menu.setDisabled(true);

        this.container.addActionRowComponents(
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)
        );

        return this;
    }

    public userSelect(options: IUserSelectOptions): this {
        this.spend(2);

        const menu = new UserSelectMenuBuilder().setCustomId(options.customId);

        if (options.placeholder) menu.setPlaceholder(options.placeholder);
        if (options.defaultUser) menu.setDefaultUsers(options.defaultUser);
        if (options.disabled) menu.setDisabled(true);

        this.container.addActionRowComponents(
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)
        );

        return this;
    }

    public build(): ContainerBuilder {
        return this.container;
    }

    public toMessage(options: { ephemeral?: boolean } = {}) {
        return {
            components: [this.container],
            flags: options.ephemeral
                ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                : MessageFlags.IsComponentsV2,
        };
    }

    private fit(content: string): string {
        const text = String(content);
        if (this.textBudget <= 0) return "…";

        if (text.length <= this.textBudget) {
            this.textBudget -= text.length;
            return text;
        }

        const clipped = `${text.slice(0, Math.max(this.textBudget - 1, 0))}…`;
        this.textBudget = 0;
        return clipped;
    }

    private spend(components: number): void {
        if (components > this.componentBudget) {
            throw new RangeError(`ComponentV2Builder: message exceeds the ${MAX_COMPONENTS} component limit.`);
        }

        this.componentBudget -= components;
    }

    private toButton(options: ButtonOptions): ButtonBuilder {
        const button = new ButtonBuilder();

        if ("url" in options) {
            button.setStyle(ButtonStyle.Link).setURL(options.url);
        } else {
            button.setStyle(BUTTON_TONES[options.tone ?? "secondary"]).setCustomId(options.customId);
        }

        if (options.label) button.setLabel(options.label);
        if (options.emoji) button.setEmoji(options.emoji);
        if (options.disabled) button.setDisabled(true);

        return button;
    }
}
