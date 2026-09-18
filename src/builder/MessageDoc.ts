import { AttachmentBuilder } from "discord.js";
import BotClient from "../client/BotClient";
import ComponentV2Builder from "./ComponentV2Builder";
import { IMessageBlock, IMessageDoc } from "../interfaces/builder/IMessageDoc";
import { IGalleryEntry } from "../interfaces/services/gallery/IGalleryService";
import { Fill, IMAGE_PLACEHOLDERS, PlaceholderValues } from "../constants/Placeholders";

const MAX_BLOCKS = 25;
const MAX_BODY = 4000;
const MAX_URL = 512;
const MAX_IMAGES = 10;

/**
 * Was ein Baustein vom 40er-Budget einer Nachricht kostet - dieselben Zahlen wie
 * in docs/ComponentV2Builder.md. Der Editor im Dashboard rechnet mit denselben.
 */
export const BLOCK_COST: Record<IMessageBlock["type"], number> = { text: 1, image: 1, separator: 1, section: 3 };

// 40 minus den Container selbst.
const BUDGET = 39;

// <scope>/<album>[/<unteralbum>]/<datei> - wie GalleryService.ToEntry() sie baut.
const GALLERY_ID = /^(default|\d{17,20})\/[a-z0-9_-]{1,32}(\/[a-z0-9_-]{1,32})?\/[^/\\]{1,120}$/;

function IsRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Eine Bildquelle, die ein Server benutzen darf: ein Bild-Platzhalter, eine
 * https-URL oder ein Bild aus seiner eigenen Galerie bzw. den Vorlagen.
 */
export function IsImageSource(source: string, guildId: string): boolean {
    if ((IMAGE_PLACEHOLDERS as readonly string[]).includes(source)) return true;
    if (source.startsWith("https://")) return source.length <= MAX_URL && URL.canParse(source);

    return GALLERY_ID.test(source) && (source.startsWith("default/") || source.startsWith(`${guildId}/`));
}

function CleanBlock(input: unknown, guildId: string): IMessageBlock | null {
    if (!IsRecord(input)) return null;

    switch (input.type) {
        case "text":
            return typeof input.body === "string" ? { type: "text", body: input.body.slice(0, MAX_BODY) } : null;

        case "image": {
            if (!Array.isArray(input.images)) return null;

            const images = input.images
                .filter((source): source is string => typeof source === "string" && IsImageSource(source, guildId))
                .slice(0, MAX_IMAGES);

            return images.length > 0 ? { type: "image", images } : null;
        }

        case "separator":
            return { type: "separator", big: input.big === true, line: input.line !== false };

        case "section":
            return typeof input.body === "string" &&
                typeof input.thumbnail === "string" &&
                IsImageSource(input.thumbnail, guildId)
                ? { type: "section", body: input.body.slice(0, MAX_BODY), thumbnail: input.thumbnail }
                : null;

        default:
            return null;
    }
}

/**
 * Macht aus einer Eingabe - Dashboard oder Assistent - ein gültiges Dokument.
 * Was nicht passt, fällt heraus, statt die ganze Nachricht abzulehnen; null nur,
 * wenn es gar kein Dokument ist.
 */
export function CleanDoc(input: unknown, guildId: string): IMessageDoc | null {
    if (!IsRecord(input) || !Array.isArray(input.blocks)) return null;

    const blocks = input.blocks
        .slice(0, MAX_BLOCKS)
        .map((block) => CleanBlock(block, guildId))
        .filter((block): block is IMessageBlock => block !== null);

    const accent =
        typeof input.accent === "string" && /^#[0-9a-f]{6}$/i.test(input.accent) ? input.accent.toLowerCase() : null;

    return accent ? { accent, blocks } : { blocks };
}

export interface IRenderedDoc {
    builder: ComponentV2Builder;
    files: AttachmentBuilder[];
}

/**
 * Dokument → ComponentV2Builder. reserve hält Komponenten für das frei, was der
 * Aufrufer danach noch anhängt (Knöpfe, Menü, Statuszeile); Bausteine, die
 * darüber hinaus nicht mehr passen, fallen weg, statt dass Discord die ganze
 * Nachricht ablehnt. Bleibt nichts übrig, steht fallback da - ein leerer
 * Container wäre ebenfalls ungültig.
 */
export async function RenderDoc(
    client: BotClient,
    doc: IMessageDoc,
    values: PlaceholderValues,
    options: { reserve?: number; fallback?: string } = {}
): Promise<IRenderedDoc> {
    const builder = new ComponentV2Builder(doc.accent ? { accentColor: doc.accent as `#${string}` } : {});

    // Galerie-Bilder erst sammeln und einmal durch Attach(): im Dev-Modus
    // nummeriert es die Anhänge, ein zweiter Aufruf finge wieder bei 0 an.
    const entries: IGalleryEntry[] = [];
    const indexOf = new Map<string, number>();

    for (const block of doc.blocks) {
        const sources = block.type === "image" ? block.images : block.type === "section" ? [block.thumbnail] : [];

        for (const source of sources) {
            if (indexOf.has(source) || source.startsWith("{") || source.startsWith("https://")) continue;

            const entry = await client.galleryService.GetImage(source);

            if (!entry) continue;

            indexOf.set(source, entries.length);
            entries.push(entry);
        }
    }

    const { media, files } = client.galleryService.Attach(entries);

    const urlOf = (source: string): string | null => {
        if (source.startsWith("{")) {
            const filled = Fill(source, values);

            return filled.startsWith("https://") ? filled : null;
        }

        if (source.startsWith("https://")) return source;

        const index = indexOf.get(source);

        return index === undefined ? null : media[index];
    };

    let budget = BUDGET - (options.reserve ?? 0);
    let added = 0;

    for (const block of doc.blocks) {
        const cost = BLOCK_COST[block.type];

        if (cost > budget) break;

        if (block.type === "separator") {
            builder.separator({ divider: block.line !== false, spacing: block.big ? "large" : "small" });
        } else if (block.type === "image") {
            const urls = block.images.map(urlOf).filter((url): url is string => url !== null);

            if (urls.length === 0) continue;

            builder.gallery(...urls);
        } else {
            // Discord lehnt einen leeren Textbaustein ab - ein Platzhalter, der zu
            // nichts wird, darf die Nachricht nicht kippen.
            const body = Fill(block.body, values).trim();

            if (!body) continue;

            const thumbnail = block.type === "section" ? urlOf(block.thumbnail) : null;

            if (thumbnail) builder.section(body, { type: "thumbnail", url: thumbnail });
            else builder.text(body);
        }

        budget -= cost;
        added++;
    }

    if (added === 0 && options.fallback) builder.text(Fill(options.fallback, values));

    return { builder, files };
}
