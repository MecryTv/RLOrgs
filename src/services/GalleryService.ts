import path from "path";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import axios from "axios";
import { AttachmentBuilder } from "discord.js";
import BotClient from "../client/BotClient";
import IGalleryImage from "../interfaces/services/gallery/IGalleryImage";
import IGalleryService, {
    IAttachedMedia,
    ICategoryEntry,
    IGalleryEntry,
    IGalleryFolder,
    IGalleryTarget,
    IListOptions,
} from "../interfaces/services/gallery/IGalleryService";
import {
    DEFAULT_SCOPE,
    GALLERY_ROOT,
    IMAGE_TYPES,
    IsImageFile,
    IsScope,
    ParseSource,
    PRIVATE_SCOPE,
    SanitizeName,
} from "../constants/Gallery";
import logger from "../utils/logger";

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 15_000;
const EXTENSION_BY_MIME = new Map<string, string>();
for (const [extension, mime] of Object.entries(IMAGE_TYPES)) {
    if (!EXTENSION_BY_MIME.has(mime)) EXTENSION_BY_MIME.set(mime, extension);
}

// Die Platte ist der Bestand: scope/kategorie[/unterordner]/datei. Ein zweiter Index
// daneben kann nur auseinanderlaufen, also gibt es keinen - gelesen wird direkt.
export default class GalleryService implements IGalleryService {
    client: BotClient;

    constructor(client: BotClient) {
        this.client = client;
    }

    async Initialize(): Promise<void> {
        await mkdir(path.join(GALLERY_ROOT, DEFAULT_SCOPE), { recursive: true });
        await mkdir(path.join(GALLERY_ROOT, PRIVATE_SCOPE), { recursive: true });

        const defaults = await this.Scan(DEFAULT_SCOPE);

        logger.info(`🖼️  Galerie bereit (${defaults.length} Default-Bild(er))`);
    }

    async GetCategories(guildId: string, options: IListOptions = {}): Promise<ICategoryEntry[]> {
        return this.ListCategories(guildId, null, options);
    }

    async GetSubcategories(guildId: string, category: string, options: IListOptions = {}): Promise<ICategoryEntry[]> {
        return this.ListCategories(guildId, SanitizeName(category), options);
    }

    async GetImages(target: IGalleryTarget): Promise<IGalleryEntry[]> {
        const { guildId, category, subcategory } = this.Normalize(target);
        if (!guildId || !category) return [];

        const directory = this.DirectoryFor(guildId, category, subcategory);
        const files = (await readdir(directory).catch(() => [])).filter(IsImageFile).sort();

        return files.map((file) => this.ToEntry({ guildId, category, subcategory, file }));
    }

    async GetImage(id: string): Promise<IGalleryEntry | null> {
        const image = this.ParseId(id);
        if (!image) return null;

        const info = await stat(this.FileFor(image)).catch(() => null);

        return info?.isFile() ? this.ToEntry(image) : null;
    }

    Attach(images: IGalleryEntry[]): IAttachedMedia {
        if (!this.client.developerMode) {
            return { media: images.map((image) => image.url), files: [] };
        }

        const names = images.map((image, index) => `${index}-${image.file}`);

        return {
            media: names.map((name) => `attachment://${name}`),
            files: images.map((image, index) => new AttachmentBuilder(this.FileFor(image), { name: names[index] })),
        };
    }

    async CreateCategory(target: IGalleryTarget): Promise<boolean> {
        const { guildId, category, subcategory } = this.Normalize(target);

        if (!guildId || guildId === DEFAULT_SCOPE || !category) return false;

        // Ein Unterordner ohne seine Hauptkategorie wäre ein Ordner, den das Panel nie
        // anzeigt - also erst gar nicht anlegen.
        if (subcategory && !(await this.Exists(this.DirectoryFor(guildId, category, null)))) return false;
        if (await this.Exists(this.DirectoryFor(guildId, category, subcategory))) return false;

        await mkdir(this.DirectoryFor(guildId, category, subcategory), { recursive: true });

        logger.info(`🖼️  Kategorie "${subcategory ? `${category}/${subcategory}` : category}" in ${guildId} angelegt`);

        return true;
    }

    async DeleteCategory(target: IGalleryTarget): Promise<number> {
        const { guildId, category, subcategory } = this.Normalize(target);
        if (!guildId || guildId === DEFAULT_SCOPE || !category) return 0;

        const removed = (await this.Scan(guildId)).filter(
            (image) => image.category === category && (!subcategory || image.subcategory === subcategory)
        ).length;

        await rm(this.DirectoryFor(guildId, category, subcategory), { recursive: true, force: true });

        logger.info(`🗑️  Kategorie "${category}" in ${guildId} gelöscht (${removed} Bild(er))`);

        return removed;
    }

    async AddImage(target: IGalleryTarget, url: string, fileName?: string): Promise<IGalleryEntry> {
        const { guildId, category, subcategory } = this.Normalize(target);

        if (!guildId || guildId === DEFAULT_SCOPE) throw new Error("Der Default-Scope kann nicht befüllt werden.");
        if (!category) throw new Error("Es wurde keine gültige Kategorie angegeben.");

        const source = ParseSource(url);

        const response = await axios.get<Readable>(source.href, {
            responseType: "stream",
            timeout: DOWNLOAD_TIMEOUT,
            maxRedirects: 3,
            maxContentLength: MAX_DOWNLOAD_BYTES,
            validateStatus: (status) => status === 200,
        });

        const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        const extension = EXTENSION_BY_MIME.get(contentType);

        if (!extension) {
            response.data.destroy();
            throw new Error(`Nicht unterstützter Dateityp: ${contentType || "unbekannt"}`);
        }

        const wanted = fileName ?? path.basename(source.pathname);
        const file = `${SanitizeName(path.parse(wanted).name) || `image-${Date.now()}`}${extension}`;

        const directory = this.DirectoryFor(guildId, category, subcategory);
        await mkdir(directory, { recursive: true });

        const destination = path.join(directory, file);

        let received = 0;
        response.data.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > MAX_DOWNLOAD_BYTES) {
                response.data.destroy(new Error(`Bild ist größer als ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB.`));
            }
        });

        try {
            await pipeline(response.data, createWriteStream(destination));
        } catch (error) {
            await unlink(destination).catch(() => {});
            throw error;
        }

        logger.info(`⬇️  Bild "${file}" in ${guildId}/${category} gespeichert`);

        return this.ToEntry({ guildId, category, subcategory, file });
    }

    async MoveImage(id: string, folder: IGalleryFolder): Promise<boolean> {
        const image = this.ParseId(id);
        if (!image || image.guildId === DEFAULT_SCOPE) return false;

        const category = SanitizeName(folder.category);
        const subcategory = folder.subcategory ? SanitizeName(folder.subcategory) : null;
        if (!category) return false;

        const from = this.FileFor(image);
        const to = path.join(this.DirectoryFor(image.guildId, category, subcategory), image.file);
        if (from === to) return true;

        if (!(await this.Exists(from))) return false;

        await mkdir(path.dirname(to), { recursive: true });
        await rename(from, to);

        return true;
    }

    async DeleteImage(id: string): Promise<boolean> {
        const image = this.ParseId(id);
        if (!image || image.guildId === DEFAULT_SCOPE) return false;

        return unlink(this.FileFor(image))
            .then(() => true)
            .catch(() => false);
    }

    private DirectoryFor(guildId: string, category: string, subcategory: string | null): string {
        return path.join(GALLERY_ROOT, guildId, category, subcategory ?? "");
    }

    private FileFor(image: IGalleryImage): string {
        return path.join(this.DirectoryFor(image.guildId, image.category, image.subcategory), image.file);
    }

    private async Exists(target: string): Promise<boolean> {
        return stat(target)
            .then(() => true)
            .catch(() => false);
    }

    private Normalize(target: IGalleryTarget) {
        return {
            guildId: IsScope(target.guildId) ? target.guildId : null,
            category: SanitizeName(target.category),
            subcategory: target.subcategory ? SanitizeName(target.subcategory) : null,
        };
    }

    // Die ID ist der Pfad unterhalb von GALLERY_ROOT - damit bleibt sie ohne Index
    // eindeutig und lässt sich aus dem Panel zurückgeben.
    private ParseId(id: string): IGalleryImage | null {
        const segments = id.split("/").filter(Boolean);
        if (segments.length < 3 || segments.length > 4) return null;

        const [guildId, category, second, third] = segments;
        const subcategory = segments.length === 4 ? second : null;
        const file = segments.length === 4 ? third : second;

        if (!IsScope(guildId) || !IsImageFile(file)) return null;
        if (segments.some((segment) => segment === "." || segment === "..")) return null;

        return { guildId, category, subcategory, file };
    }

    private ToEntry(image: IGalleryImage): IGalleryEntry {
        const segments = [image.guildId, image.category, image.subcategory, image.file].filter(
            (segment): segment is string => Boolean(segment)
        );

        const label =
            image.guildId === DEFAULT_SCOPE
                ? DEFAULT_SCOPE
                : this.client.guilds.cache.get(image.guildId)?.name ?? image.guildId;

        const shortPath = segments.slice(1).join("/");

        return {
            ...image,
            id: segments.join("/"),
            url: `${this.client.server.BaseURL}/images/${segments.map(encodeURIComponent).join("/")}`,
            path: `${label}/${shortPath}`,
            shortPath,
        };
    }

    private async ListCategories(
        guildId: string,
        parent: string | null,
        options: IListOptions
    ): Promise<ICategoryEntry[]> {
        const { requireImages = true } = options;
        const scopes = IsScope(guildId) && guildId !== DEFAULT_SCOPE ? [DEFAULT_SCOPE, guildId] : [DEFAULT_SCOPE];

        const found: ICategoryEntry[] = [];

        for (const scope of scopes) {
            const images = await this.Scan(scope);
            const root = parent ? path.join(GALLERY_ROOT, scope, parent) : path.join(GALLERY_ROOT, scope);
            const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                found.push({
                    guildId: scope,
                    name: entry.name,
                    parent,
                    scope: scope === DEFAULT_SCOPE ? "default" : "custom",
                    images: images.filter((image) =>
                        parent === null
                            ? image.category === entry.name
                            : image.category === parent && image.subcategory === entry.name
                    ).length,
                });
            }
        }

        return found
            .filter((category) => !requireImages || category.images > 0)
            .sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
    }

    // Alle Bilder eines Scopes, zwei Ebenen tief - tiefer legt das Panel nichts an.
    private async Scan(scope: string): Promise<IGalleryImage[]> {
        const root = path.join(GALLERY_ROOT, scope);
        const found: IGalleryImage[] = [];

        const categories = await readdir(root, { withFileTypes: true }).catch(() => []);

        for (const category of categories) {
            if (!category.isDirectory()) continue;

            const entries = await readdir(path.join(root, category.name), { withFileTypes: true }).catch(() => []);

            for (const entry of entries) {
                if (entry.isFile()) {
                    if (IsImageFile(entry.name)) {
                        found.push({ guildId: scope, category: category.name, subcategory: null, file: entry.name });
                    }

                    continue;
                }

                const files = await readdir(path.join(root, category.name, entry.name)).catch(() => []);

                for (const file of files.filter(IsImageFile)) {
                    found.push({ guildId: scope, category: category.name, subcategory: entry.name, file });
                }
            }
        }

        return found;
    }
}
