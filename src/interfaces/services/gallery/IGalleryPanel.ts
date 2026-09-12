import { AttachmentBuilder, ContainerBuilder } from "discord.js";

export type PanelMode = "browse" | "delete" | "move";

export interface IPanelState {
    homeGuildId: string;
    scope: string;
    category: string | null;
    subcategory: string | null;
    page: number;
    mode: PanelMode;
    moving: string | null;
    marked: string[];
    notice: string | null;
}

export interface IPanelView {
    components: ContainerBuilder[];
    files: AttachmentBuilder[];
}
