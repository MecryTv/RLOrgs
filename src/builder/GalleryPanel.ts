import { LRUCache } from "lru-cache";
import BotClient from "../client/BotClient";
import ComponentV2Builder from "./ComponentV2Builder";
import { DEFAULT_SCOPE } from "../constants/Gallery";
import { IPanelState, IPanelView } from "../interfaces/services/gallery/IGalleryPanel";
import { ICategoryEntry, IGalleryEntry } from "../interfaces/services/gallery/IGalleryService";

export const PANEL_PREFIX = "gallery:panel";
export const PAGE_SIZE = 10;

export const DIRECT_VALUE = "__direct";

const MAX_OPTIONS = 25;

export const PanelStates = new LRUCache<string, IPanelState>({ max: 200, ttl: 30 * 60_000 });

export function NewPanelState(guildId: string): IPanelState {
    return {
        homeGuildId: guildId,
        scope: guildId,
        category: null,
        subcategory: null,
        page: 0,
        mode: "browse",
        moving: null,
        marked: [],
        notice: null,
    };
}

function Breadcrumb(state: IPanelState): string {
    const scope = state.scope === DEFAULT_SCOPE ? "🌐 Default" : "⭐ Server";
    const parts = [scope, state.category, state.subcategory].filter(Boolean);

    return parts.join(" › ");
}

function CategoryOptions(categories: ICategoryEntry[], state: IPanelState) {
    return categories.slice(0, MAX_OPTIONS).map((entry) => ({
        label: `${entry.scope === "default" ? "🌐" : "⭐"} ${entry.name}`.slice(0, 100),
        value: `${entry.guildId}:${entry.name}`,
        description: `${entry.images} Bild(er)`,
        default: entry.guildId === state.scope && entry.name === state.category,
    }));
}

export async function RenderPanel(client: BotClient, state: IPanelState): Promise<IPanelView> {
    const gallery = client.galleryService;
    const writable = state.scope === state.homeGuildId;

    const categories = await gallery.GetCategories(state.homeGuildId, { requireImages: false });

    const subcategories = state.category
        ? await gallery.GetSubcategories(state.scope, state.category, { requireImages: false })
        : [];

    const images: IGalleryEntry[] = state.category
        ? await gallery.GetImages({ guildId: state.scope, category: state.category, subcategory: state.subcategory })
        : [];

    const pages = Math.max(1, Math.ceil(images.length / PAGE_SIZE));
    const page = Math.min(Math.max(state.page, 0), pages - 1);
    const slice = images.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const { media, files } = gallery.Attach(slice);

    const builder = new ComponentV2Builder({ accentColor: "#B57BFF" }).title(
        "🖼️ | Galerie",
        state.category ? Breadcrumb(state) : "Wähle unten eine Kategorie aus."
    );

    if (state.notice) builder.subtext(state.notice);
    builder.separator();

    if (slice.length > 0) {
        builder.gallery(...media);
        builder.list(slice.map((image) => `[\`${image.file}\`](${image.url})`));
        builder.subtext(`${images.length} Bild(er) · Seite ${page + 1} von ${pages}`);
    } else if (state.category) {
        builder.text("Dieser Ordner ist leer.");
    } else if (categories.length === 0) {
        builder.text("Für diesen Server gibt es noch keine Kategorien. Leg unten eine an.");
    }

    builder.separator();

    if (categories.length > 0) {
        builder.select({
            customId: `${PANEL_PREFIX}:cat`,
            placeholder: "📁 | Kategorie wählen...",
            options: CategoryOptions(categories, state),
        });
    }

    if (subcategories.length > 0) {
        builder.select({
            customId: `${PANEL_PREFIX}:sub`,
            placeholder: "📂 | Unterordner wählen...",
            options: [
                {
                    label: `➔ direkt in ${state.category}`,
                    value: DIRECT_VALUE,
                    default: state.subcategory === null,
                },
                ...subcategories.slice(0, MAX_OPTIONS - 1).map((entry) => ({
                    label: `📂 ${entry.name}`.slice(0, 100),
                    value: entry.name,
                    description: `${entry.images} Bild(er)`,
                    default: entry.name === state.subcategory,
                })),
            ],
        });
    }

    if (state.mode === "delete") {
        return Deleting(builder, state, images, files);
    }

    if (state.mode === "move") {
        return Moving(builder, state, images, writable, files);
    }

    if (pages > 1) {
        builder.buttons(
            { customId: `${PANEL_PREFIX}:prev`, label: "Zurück", emoji: "◀️", disabled: page === 0 },
            {
                customId: `${PANEL_PREFIX}:next`,
                label: "Weiter",
                emoji: "▶️",
                tone: "primary",
                disabled: page === pages - 1,
            }
        );
    }

    const hasImages = images.length > 0;

    builder.buttons(
        {
            customId: `${PANEL_PREFIX}:upload`,
            label: "Hochladen",
            emoji: "⬆️",
            tone: "success",
            disabled: !writable || !state.category,
        },
        {
            customId: `${PANEL_PREFIX}:delete`,
            label: "Bilder löschen",
            emoji: "🗑️",
            tone: "danger",
            disabled: !writable || !hasImages,
        },
        {
            customId: `${PANEL_PREFIX}:move`,
            label: "Verschieben",
            emoji: "📦",
            disabled: !writable || !hasImages,
        },
        { customId: `${PANEL_PREFIX}:refresh`, label: "Aktualisieren", emoji: "🔄" }
    );

    builder.buttons(
        { customId: `${PANEL_PREFIX}:newcat`, label: "Kategorie anlegen", emoji: "➕", tone: "primary" },
        {
            customId: `${PANEL_PREFIX}:delcat`,
            label: "Kategorie löschen",
            emoji: "➖",
            tone: "danger",
            disabled: !writable || !state.category,
        }
    );

    if (!writable) {
        builder.subtext("Default-Bilder gehören dem Bot und lassen sich nicht ändern.");
    }

    return { components: [builder.build()], files };
}

function Deleting(
    builder: ComponentV2Builder,
    state: IPanelState,
    images: IGalleryEntry[],
    files: IPanelView["files"]
): IPanelView {
    const selectable = images.slice(0, MAX_OPTIONS);

    builder.text("🗑️ **Löschen** — markiere die Bilder, die verschwinden sollen.");

    if (selectable.length > 0) {
        builder.select({
            customId: `${PANEL_PREFIX}:pick`,
            placeholder: "🖼️ | Bilder markieren...",
            minValues: 1,
            maxValues: selectable.length,
            options: selectable.map((image) => ({
                label: image.file.slice(0, 100),
                value: image.file,
                default: state.marked.includes(image.id),
            })),
        });
    }

    if (images.length > MAX_OPTIONS) {
        builder.subtext(`Es lassen sich ${MAX_OPTIONS} von ${images.length} Bildern auf einmal markieren.`);
    }

    builder.buttons(
        {
            customId: `${PANEL_PREFIX}:confirm`,
            label: state.marked.length > 0 ? `${state.marked.length} löschen` : "Löschen",
            emoji: "🗑️",
            tone: "danger",
            disabled: state.marked.length === 0,
        },
        { customId: `${PANEL_PREFIX}:cancel`, label: "Abbrechen", emoji: "✖️" }
    );

    return { components: [builder.build()], files };
}

function Moving(
    builder: ComponentV2Builder,
    state: IPanelState,
    images: IGalleryEntry[],
    writable: boolean,
    files: IPanelView["files"]
): IPanelView {
    if (!state.moving) {
        const selectable = images.slice(0, MAX_OPTIONS);

        builder.text("📦 **Verschieben** — wähle zuerst das Bild aus.");

        if (selectable.length > 0) {
            builder.select({
                customId: `${PANEL_PREFIX}:pick`,
                placeholder: "🖼️ | Bild wählen...",
                options: selectable.map((image) => ({ label: image.file.slice(0, 100), value: image.file })),
            });
        }

        builder.buttons({ customId: `${PANEL_PREFIX}:cancel`, label: "Abbrechen", emoji: "✖️" });

        return { components: [builder.build()], files };
    }

    builder.text(`📦 **Verschieben** — navigiere zum Zielordner und bestätige.\nAktuelles Ziel: \`${Breadcrumb(state)}\``);

    builder.buttons(
        {
            customId: `${PANEL_PREFIX}:movehere`,
            label: "Hierher verschieben",
            emoji: "📥",
            tone: "success",
            disabled: !writable || !state.category,
        },
        { customId: `${PANEL_PREFIX}:cancel`, label: "Abbrechen", emoji: "✖️" }
    );

    return { components: [builder.build()], files };
}
