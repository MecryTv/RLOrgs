import { AttachmentBuilder } from "discord.js";
import IGalleryImage from "./IGalleryImage";

export interface IGalleryEntry extends IGalleryImage {
    id: string;
    url: string;
    path: string;
    shortPath: string;
}

export interface ICategoryEntry {
    guildId: string;
    name: string;
    parent: string | null;
    scope: "default" | "custom";
    images: number;
}

export interface IGalleryFolder {
    category: string;
    subcategory?: string | null;
}

export interface IGalleryTarget extends IGalleryFolder {
    guildId: string;
}

export interface IListOptions {
    requireImages?: boolean;
}

export interface IAttachedMedia {
    media: string[];
    files: AttachmentBuilder[];
}

export default interface IGalleryService {
    Initialize(): Promise<void>;

    GetCategories(guildId: string, options?: IListOptions): Promise<ICategoryEntry[]>;
    GetSubcategories(guildId: string, category: string, options?: IListOptions): Promise<ICategoryEntry[]>;
    GetImages(target: IGalleryTarget): Promise<IGalleryEntry[]>;
    GetImage(id: string): Promise<IGalleryEntry | null>;
    Overview(guildId: string): Promise<{ categories: ICategoryEntry[]; images: IGalleryEntry[] }>;
    Attach(images: IGalleryEntry[]): IAttachedMedia;

    CreateCategory(target: IGalleryTarget): Promise<boolean>;
    DeleteCategory(target: IGalleryTarget): Promise<number>;

    AddImage(target: IGalleryTarget, url: string, fileName?: string): Promise<IGalleryEntry>;
    AddUpload(target: IGalleryTarget, buffer: Buffer, mime: string, fileName: string): Promise<IGalleryEntry>;
    MoveImage(id: string, folder: IGalleryFolder): Promise<boolean>;
    DeleteImage(id: string): Promise<boolean>;
}
