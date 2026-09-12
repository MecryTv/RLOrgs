import { ContainerBuilder } from "discord.js";

export type DevLogsView = "list" | "overview" | "page" | "search";

export interface IDevLogsState {
    view: DevLogsView;
    listPage: number;
    session: number | null;
    part: number | null;
    page: number;
    term: string | null;
    notice: string | null;
}

export interface IDevLogsPanelView {
    components: ContainerBuilder[];
}
