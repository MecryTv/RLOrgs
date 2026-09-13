import path from "path";
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import https from "node:https";
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
    CheckRedirect,
    DEFAULT_SCOPE,
    GALLERY_ROOT,
    IMAGE_TYPES,
    IsImageFile,
    IsScope,
    LookupPublic,
    MAX_IMAGE_BYTES,
    ParseSource,
    PRIVATE_SCOPE,
    SanitizeName,
} from "../constants/Gallery";
import { Shrink } from "../utils/image";
import logger from "../utils/logger";

const DOWNLOAD_TIMEOUT = 15_000;

// Jede https-Verbindung des Downloads fragt DNS ueber LookupPublic - die Sperre
// gegen das interne Netz sitzt dort, im Moment des Verbindens.
const DOWNLOAD_AGENT = new https.Agent({ lookup: LookupPublic });

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

    // Die Sammel-Logik fuers Dashboard: Kategorien samt Unterordnern und die Bilder
    // darin, an einer Stelle statt dupliziert in der Route.
    async Overview(guildId: string): Promise<{ categories: ICategoryEntry[]; images: IGalleryEntry[] }> {
        // Auch leere Alben: ohne das verschwaende ein frisch angelegtes Album
        // sofort wieder aus der Liste, und "Anlegen" saehe aus, als taete es
        // nichts. Das Discord-Panel blendet leere Alben aus, das Dashboard nicht.
        const all = { requireImages: false };

        // GetCategories(guildId) liefert Vorlagen und Server schon zusammen - ein
        // zweiter Aufruf fuer "default" haette jede Vorlage doppelt gezeigt.
        const categories = await this.GetCategories(guildId, all);

        // Unterordner je Name nur einmal abfragen: GetSubcategories schaut
        // ebenfalls in beide Bereiche, und ein Name kann in beiden vorkommen.
        const names = [...new Set(categories.map((entry) => entry.name))];
        const nested = (await Promise.all(names.map((name) => this.GetSubcategories(guildId, name, all)))).flat();

        // Unterordner stehen gleichberechtigt in derselben Liste; ihr Feld
        // "parent" sagt, wohin sie gehoeren.
        const folders = [...categories, ...nested];

        const images = (
            await Promise.all(
                folders.map((entry) =>
                    this.GetImages({
                        guildId: entry.guildId,
                        category: entry.parent ?? entry.name,
                        subcategory: entry.parent ? entry.name : null,
                    })
                )
            )
        ).flat();

        return { categories: folders, images };
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
        // Prueft den eingetippten Text vorab. Fuer einen DNS-Namen nur fuer eine
        // lesbare Meldung - die Sperre, auf die es ankommt, sitzt dann unten beim
        // Verbinden (LookupPublic). Bei einer nackten IP in der URL ruft Node dort
        // nie ein lookup auf; dann ist diese Pruefung hier - und CheckRedirect bei
        // jeder Weiterleitung - die einzige Sperre.
        const source = ParseSource(url);

        const response = await axios.get<ArrayBuffer>(source.href, {
            responseType: "arraybuffer",
            timeout: DOWNLOAD_TIMEOUT,
            maxRedirects: 3,
            maxContentLength: MAX_IMAGE_BYTES,
            validateStatus: (status) => status === 200,
            // httpsAgent und beforeRedirect kennt nur der Node-Adapter; der fetch-Adapter
            // uebergeht beide still - und mit ihnen die Sperre. Also fest dieser.
            adapter: "http",
            // axios reicht den Agent an follow-redirects weiter, das ihn fuer jeden
            // https-Sprung neu einsetzt; CheckRedirect laeuft vor jedem Sprung.
            httpsAgent: DOWNLOAD_AGENT,
            beforeRedirect: CheckRedirect,
            // Sonst nimmt axios einen Proxy aus HTTPS_PROXY: dann verbindet der Agent
            // nur zum Proxy, der Proxy loest das Ziel selbst auf, und LookupPublic
            // bekaeme die Zieladresse nie zu sehen.
            proxy: false,
        });

        const mime = String(response.headers["content-type"] ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();

        if (!EXTENSION_BY_MIME.has(mime)) throw new Error(`Nicht unterstützter Dateityp: ${mime || "unbekannt"}`);

        return this.Store(target, Buffer.from(response.data), mime, fileName ?? path.basename(source.pathname));
    }

    async AddUpload(
        target: IGalleryTarget,
        buffer: Buffer,
        mime: string,
        fileName: string
    ): Promise<IGalleryEntry> {
        if (buffer.length > MAX_IMAGE_BYTES) {
            throw new Error(`Bild ist größer als ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
        }

        if (!EXTENSION_BY_MIME.has(mime)) throw new Error(`Nicht unterstützter Dateityp: ${mime || "unbekannt"}`);

        return this.Store(target, buffer, mime, fileName);
    }

    // Der einzige Weg, auf dem ein Bild ins Verzeichnis kommt - aus dem Netz wie
    // aus dem Dashboard. Deshalb steht das Verkleinern hier und nirgends sonst.
    private async Store(
        target: IGalleryTarget,
        buffer: Buffer,
        mime: string,
        wanted: string
    ): Promise<IGalleryEntry> {
        const { guildId, category, subcategory } = this.Normalize(target);

        if (!guildId || guildId === DEFAULT_SCOPE) throw new Error("Der Default-Scope kann nicht befüllt werden.");
        if (!category) throw new Error("Es wurde keine gültige Kategorie angegeben.");

        const shrunk = await Shrink(buffer, mime);
        const stem = SanitizeName(path.parse(wanted).name) || `image-${Date.now()}`;

        const directory = this.DirectoryFor(guildId, category, subcategory);
        await mkdir(directory, { recursive: true });

        // Zwei Uploads mit demselben Namen sind kein Fehler des Nutzers. Ohne
        // diese Schleife ueberschriebe der zweite den ersten, stumm.
        let file = `${stem}${shrunk.extension}`;
        let attempt = 2;

        for (;;) {
            const destination = path.join(directory, file);

            // Der Schreibvorgang selbst ist die Pruefung: "wx" legt die Datei nur an,
            // wenn dort noch keine liegt. Ein stat() vorher prueft nur einen Augenblick,
            // der sofort wieder vorbei ist - bis zum eigenen writeFile() kann ein
            // zweiter Upload denselben Namen laengst angelegt haben, und "w" (anlegen-
            // oder-abschneiden) ueberschriebe ihn dann stumm.
            try {
                await writeFile(destination, shrunk.buffer, { flag: "wx" });
                break;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                    // Unter "wx" legt nur dieser Aufruf die Datei an - stuende dort schon
                    // eine, kaeme EEXIST statt dessen. Das Fragment hier gehoert also
                    // wirklich ihm und darf vor dem Weiterwerfen wieder verschwinden.
                    await unlink(destination).catch(() => {});
                    throw error;
                }

                file = `${stem}-${attempt++}${shrunk.extension}`;
            }
        }

        logger.info(
            `⬇️  Bild "${file}" in ${guildId}/${category} gespeichert (${Math.round(shrunk.buffer.length / 1024)} KB)`
        );

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
