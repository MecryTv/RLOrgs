/**
 * Bildauswahl für den Nachrichten-Editor: Galerie, Hochladen, Adresse.
 *
 * Zurück kommt eine Bildquelle, wie der Bot sie versteht - eine Galerie-ID, eine
 * https-Adresse oder ein Bild-Platzhalter. Eigene Uploads landen im Album
 * "custom" des Servers, also in derselben Galerie wie alles andere: kein zweiter
 * Bilderspeicher, und was eine Nachricht benutzt, steht sichtbar in der Galerie.
 */

import { BASE } from "../core/Base.js";
import { icon } from "../core/Dom.js";
import { failureText, MAX_UPLOAD_BYTES, megabytes, uploadImage } from "../core/Gallery.js";
import { IMAGE_PLACEHOLDERS } from "../constants/Placeholders.js";

export interface IGalleryFolder {
    guildId: string;
    name: string;
    parent: string | null;
    scope: "default" | "custom";
    images: number;
}

export interface IGalleryImage {
    id: string;
    url: string;
    guildId: string;
    category: string;
    subcategory: string | null;
    file: string;
}

const CUSTOM_ALBUM = "custom";
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

const PLACEHOLDER_LABELS: Record<string, string> = {
    "{user.avatar}": "Avatar des Users",
    "{guild.icon}": "Server-Icon",
    "{stream.preview}": "Vorschaubild des Streams",
    "{streamer.avatar}": "Profilbild des Streamers",
    "{video.thumbnail}": "Vorschaubild des Videos",
    "{channel.avatar}": "Kanalbild",
};

// Die Platzhalter-Knöpfe unten - je nach Nachricht andere (Tickets, Twitch, YouTube).
let footHost: HTMLElement | null = null;

/** Die Galerie eines Servers, einmal geholt und danach gemerkt. */
const cache = new Map<string, { folders: IGalleryFolder[]; images: IGalleryImage[] }>();

export async function loadGallery(guildId: string, fresh = false): Promise<{ folders: IGalleryFolder[]; images: IGalleryImage[] }> {
    const known = cache.get(guildId);

    if (known && !fresh) return known;

    const empty = { folders: [], images: [] };

    try {
        const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery`, {
            headers: { Accept: "application/json" },
        });

        if ((await failureText(response)) !== null) return known ?? empty;

        const data = (await response.json()) as { categories: IGalleryFolder[]; images: IGalleryImage[] };
        const loaded = { folders: data.categories, images: data.images };

        cache.set(guildId, loaded);

        return loaded;
    } catch {
        return known ?? empty;
    }
}

/** Bild-ID zu Adresse - für die Vorschau. */
export function galleryUrl(guildId: string, source: string): string | null {
    if (source.startsWith("https://")) return source;

    return cache.get(guildId)?.images.find((image) => image.id === source)?.url ?? null;
}

function key(folder: IGalleryFolder): string {
    return `${folder.guildId}|${folder.parent ?? ""}|${folder.name}`;
}

function label(folder: IGalleryFolder): string {
    const scope = folder.scope === "default" ? "Vorlagen" : "Dein Server";

    return folder.parent ? `${scope} · ${folder.parent} / ${folder.name}` : `${scope} · ${folder.name}`;
}

function inFolder(image: IGalleryImage, folder: IGalleryFolder): boolean {
    const category = folder.parent ?? folder.name;
    const sub = folder.parent ? folder.name : null;

    return image.guildId === folder.guildId && image.category === category && image.subcategory === sub;
}

let dialog: HTMLDialogElement | null = null;
let answer: ((source: string | null) => void) | null = null;

/** Öffnet die Auswahl. null heißt: abgebrochen. placeholders: die Bild-Platzhalter dieser Nachricht. */
export function pickImage(guildId: string, placeholders: string[] = IMAGE_PLACEHOLDERS): Promise<string | null> {
    const host = dialog ?? build();

    paintFoot(placeholders);
    void fill(guildId, host);
    host.showModal();

    return new Promise((resolve) => {
        answer = resolve;
    });
}

function paintFoot(placeholders: string[]): void {
    if (!footHost) return;

    const label = footHost.firstElementChild!;

    footHost.replaceChildren(
        label,
        ...placeholders.map((placeholder) => {
            const chip = document.createElement("button");

            chip.type = "button";
            chip.className = "tagline";
            chip.textContent = PLACEHOLDER_LABELS[placeholder] ?? placeholder;
            chip.addEventListener("click", () => done(placeholder));

            return chip;
        })
    );
}

function done(source: string | null): void {
    dialog?.close();
    answer?.(source);
    answer = null;
}

function build(): HTMLDialogElement {
    const host = document.createElement("dialog");

    host.className = "modal imgpick";

    const head = document.createElement("div");

    head.className = "modal__head";

    const heading = document.createElement("div");
    const title = document.createElement("h2");

    title.textContent = "Bild wählen";

    const sub = document.createElement("p");

    sub.textContent = "Aus der Galerie, frisch hochgeladen oder als Adresse.";
    heading.append(title, sub);

    const close = document.createElement("button");

    close.type = "button";
    close.className = "iconbtn modal__x";
    close.setAttribute("aria-label", "Schließen");
    close.append(icon("#i-x"));
    close.addEventListener("click", () => done(null));

    head.append(heading, close);

    const body = document.createElement("div");

    body.className = "modal__body";

    const tabs = document.createElement("div");

    tabs.className = "seg imgpick__tabs";
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Woher das Bild kommt");

    const panes = document.createElement("div");

    for (const [name, text] of [
        ["gallery", "Galerie"],
        ["upload", "Hochladen"],
        ["url", "Adresse"],
    ] as const) {
        const tab = document.createElement("button");

        tab.type = "button";
        tab.dataset.tab = name;
        tab.textContent = text;
        tab.setAttribute("aria-pressed", String(name === "gallery"));
        tab.addEventListener("click", () => {
            for (const other of tabs.children) other.setAttribute("aria-pressed", String(other === tab));

            for (const pane of panes.children) {
                (pane as HTMLElement).hidden = (pane as HTMLElement).dataset.pane !== name;
            }
        });

        tabs.append(tab);
    }

    const note = document.createElement("p");

    note.className = "imgpick__note";
    note.hidden = true;

    const foot = document.createElement("div");

    foot.className = "imgpick__foot";

    const footText = document.createElement("span");

    footText.textContent = "Oder ein Platzhalter:";
    foot.append(footText);
    footHost = foot;

    panes.append(GalleryPane(), UploadPane(), UrlPane());
    body.append(tabs, panes, note, foot);
    host.append(head, body);
    host.addEventListener("cancel", () => done(null));
    document.body.append(host);

    dialog = host;

    return host;
}

function pane(name: string): HTMLElement {
    const box = document.createElement("div");

    box.className = "imgpick__pane";
    box.dataset.pane = name;
    box.hidden = name !== "gallery";

    return box;
}

function GalleryPane(): HTMLElement {
    const box = pane("gallery");
    const picker = document.createElement("select");

    picker.className = "pick imgpick__album";
    picker.setAttribute("aria-label", "Album");

    const grid = document.createElement("div");

    grid.className = "galgrid";
    picker.addEventListener("change", () => paintGrid(box));
    box.append(picker, grid);

    return box;
}

function UploadPane(): HTMLElement {
    const box = pane("upload");
    const hint = document.createElement("p");

    hint.className = "hintline";
    hint.textContent = `Das Bild landet im Album „${CUSTOM_ALBUM}" deines Servers, wird auf 1920 px verkleinert und als WebP gespeichert. Höchstens ${megabytes(MAX_UPLOAD_BYTES)}.`;

    const file = document.createElement("input");

    file.type = "file";
    file.accept = ACCEPT;
    file.hidden = true;

    const drop = document.createElement("button");

    drop.type = "button";
    drop.className = "galdrop";
    drop.append(icon("#i-upload"));

    const strong = document.createElement("b");

    strong.textContent = "Bild auswählen";
    drop.append(strong, document.createTextNode("PNG, JPG, GIF oder WebP"));
    drop.addEventListener("click", () => file.click());

    const status = document.createElement("p");

    status.className = "hintline";

    file.addEventListener("change", () => {
        const chosen = [...(file.files ?? [])];

        file.value = "";

        if (chosen.length > 0) void upload(box, chosen[0], status, drop);
    });

    box.append(hint, drop, file, status);

    return box;
}

function UrlPane(): HTMLElement {
    const box = pane("url");
    const form = document.createElement("form");

    form.className = "galurl";

    const input = document.createElement("input");

    input.className = "text";
    input.type = "url";
    input.required = true;
    input.placeholder = "https://… Adresse eines Bildes";
    input.setAttribute("aria-label", "Bild-Adresse");

    const submit = document.createElement("button");

    submit.className = "btn btn--primary";
    submit.type = "submit";
    submit.textContent = "Übernehmen";

    form.append(input, submit);
    form.addEventListener("submit", (event) => {
        event.preventDefault();

        const value = input.value.trim();

        if (!value.startsWith("https://")) {
            say(box, "Nur https-Adressen – Discord lädt nichts anderes.");

            return;
        }

        input.value = "";
        done(value);
    });

    const hint = document.createElement("p");

    hint.className = "hintline";
    hint.textContent =
        "Die Adresse bleibt, wie sie ist – der Bot lädt sie nicht herunter. Verschwindet das Bild dort, bleibt die Nachricht leer.";

    box.append(form, hint);

    return box;
}

function say(box: HTMLElement, text: string | null): void {
    const note = box.closest(".modal__body")?.querySelector<HTMLElement>(".imgpick__note");

    if (!note) return;

    note.hidden = text === null;
    note.textContent = text ?? "";
}

async function fill(guildId: string, host: HTMLDialogElement, fresh = false): Promise<void> {
    const box = host.querySelector<HTMLElement>('[data-pane="gallery"]')!;

    box.dataset.guild = guildId;
    say(box, null);

    const { folders } = await loadGallery(guildId, fresh);
    const picker = box.querySelector<HTMLSelectElement>(".imgpick__album")!;
    const before = picker.value;

    picker.replaceChildren(
        ...folders.map((folder) => {
            const option = document.createElement("option");

            option.value = key(folder);
            option.textContent = `${label(folder)} (${folder.images})`;

            return option;
        })
    );

    if (folders.length === 0) {
        const option = document.createElement("option");

        option.textContent = "Noch keine Alben";
        picker.append(option);
    }

    // Ohne vorherige Wahl das erste Album, in dem wirklich etwas liegt - das
    // oberste ist oft der leere Hauptordner.
    const start =
        (before && folders.some((folder) => key(folder) === before) ? before : null) ??
        key(
            folders.find((folder) => folder.scope === "custom" && folder.images > 0) ??
                folders.find((folder) => folder.images > 0) ??
                folders[0] ?? { guildId: "", parent: null, name: "" }
        );

    picker.value = start;

    paintGrid(box);
}

function paintGrid(box: HTMLElement): void {
    const guildId = box.dataset.guild ?? "";
    const { folders, images } = cache.get(guildId) ?? { folders: [], images: [] };
    const picker = box.querySelector<HTMLSelectElement>(".imgpick__album")!;
    const grid = box.querySelector<HTMLElement>(".galgrid")!;
    const folder = folders.find((entry) => key(entry) === picker.value);
    const shown = folder ? images.filter((image) => inFolder(image, folder)) : [];

    grid.replaceChildren(
        ...shown.map((image) => {
            const tile = document.createElement("button");

            tile.type = "button";
            tile.className = "galtile galtile--pick";
            tile.title = image.file;

            const wrap = document.createElement("div");

            wrap.className = "galtile__img";

            const picture = document.createElement("img");

            picture.loading = "lazy";
            picture.alt = image.file;
            picture.src = image.url;
            wrap.append(picture);

            const cap = document.createElement("figcaption");

            cap.className = "galtile__cap";

            const name = document.createElement("b");

            name.textContent = image.file;
            cap.append(name);

            tile.append(wrap, cap);
            tile.addEventListener("click", () => done(image.id));

            return tile;
        })
    );

    if (shown.length === 0) {
        const empty = document.createElement("p");

        empty.className = "hintline";
        empty.textContent = "In diesem Album liegt noch kein Bild.";
        grid.append(empty);
    }
}

async function upload(box: HTMLElement, file: File, status: HTMLElement, drop: HTMLButtonElement): Promise<void> {
    const guildId = box.closest(".modal")?.querySelector<HTMLElement>('[data-pane="gallery"]')?.dataset.guild ?? "";

    if (!guildId) return;

    if (file.size > MAX_UPLOAD_BYTES) {
        status.textContent = `Zu groß – ${megabytes(file.size)}, höchstens ${megabytes(MAX_UPLOAD_BYTES)}.`;

        return;
    }

    drop.disabled = true;
    status.textContent = "Wird vorbereitet …";

    // Das Album muss es geben; existiert es schon, antwortet die Route 400 -
    // das ist hier kein Fehler.
    await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery/category`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ category: CUSTOM_ALBUM }),
    }).catch(() => undefined);

    const result = await uploadImage(guildId, { category: CUSTOM_ALBUM, subcategory: null }, file, (phase, fraction) => {
        status.textContent =
            phase === "upload" ? `Lädt hoch … ${Math.round(fraction * 100)} %` : "Wird verkleinert …";
    });

    drop.disabled = false;
    status.textContent = "";

    if (result.error !== null) {
        status.textContent = result.error;

        return;
    }

    // Damit das neue Bild auch in der Galerie-Ansicht auftaucht.
    await loadGallery(guildId, true);

    done(result.id ?? null);
}
