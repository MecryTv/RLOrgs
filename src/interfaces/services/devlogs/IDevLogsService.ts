import { AttachmentBuilder } from "discord.js";
import { ISessionEntry } from "../../logger/ISessionManifest";

export interface ILogFile {
    entry: ISessionEntry;
    file: string;
    path: string;
    part: number;
    parts: number;
    size: number;
}

export interface ILogStats {
    lines: number;
    errors: number;
    warnings: number;
    errorPages: number[];
}

export interface ILogPage {
    text: string;
    page: number;
    pages: number;
}

export interface ISearchMatch {
    line: number;
    text: string;
}

export interface ISearchResult {
    matches: ISearchMatch[];
    total: number;
}

export default interface IDevLogsService {
    Sessions(): ISessionEntry[];
    ListPageOf(session: number): number;

    Resolve(session: number, part?: number | null): Promise<ILogFile | null>;
    Stats(file: ILogFile): Promise<ILogStats>;
    Page(file: ILogFile, page: number): Promise<ILogPage>;
    Search(file: ILogFile, term: string): Promise<ISearchResult>;
    Attachment(file: ILogFile): AttachmentBuilder;
}
