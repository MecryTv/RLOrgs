import { ChannelType, ColorResolvable, ComponentEmojiResolvable } from "discord.js";

export type ButtonTone = "primary" | "secondary" | "success" | "danger";
export type SpacingSize = "small" | "large";

export interface IComponentV2BuilderOptions {
    accentColor?: ColorResolvable;
    spoiler?: boolean;
}

export interface IActionButtonOptions {
    customId: string;
    label?: string;
    tone?: ButtonTone;
    emoji?: ComponentEmojiResolvable;
    disabled?: boolean;
}

export interface ILinkButtonOptions {
    url: string;
    label?: string;
    emoji?: ComponentEmojiResolvable;
    disabled?: boolean;
}

export type ButtonOptions = IActionButtonOptions | ILinkButtonOptions;

export interface IThumbnailAccessory {
    type: "thumbnail";
    url: string;
    description?: string;
    spoiler?: boolean;
}

export type SectionAccessory = IThumbnailAccessory | ({ type: "button" } & ButtonOptions);

export interface ISelectEntryOptions {
    label: string;
    value: string;
    description?: string;
    emoji?: ComponentEmojiResolvable;
    default?: boolean;
}

export interface ISelectMenuOptions {
    customId: string;
    options: ISelectEntryOptions[];
    placeholder?: string;
    minValues?: number;
    maxValues?: number;
    disabled?: boolean;
}

export interface IChannelSelectOptions {
    customId: string;
    channelTypes?: ChannelType[];
    placeholder?: string;
    defaultChannel?: string | null;
    disabled?: boolean;
}

export interface IRoleSelectOptions {
    customId: string;
    placeholder?: string;
    defaultRole?: string | null;
    disabled?: boolean;
}

export interface IUserSelectOptions {
    customId: string;
    placeholder?: string;
    defaultUser?: string | null;
    disabled?: boolean;
}

export interface IListOptions {
    ordered?: boolean;
    bullet?: string;
    indent?: number;
}

export interface IProgressOptions {
    width?: number;
    label?: string;
    filled?: string;
    empty?: string;
    showPercent?: boolean;
}

export interface ISeparatorOptions {
    divider?: boolean;
    spacing?: SpacingSize;
}
