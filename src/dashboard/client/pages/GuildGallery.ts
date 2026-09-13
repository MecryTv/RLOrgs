/** Abschnitt: Galerie eines Servers. */

import { icon, need } from "../core/Dom.js";
import { BASE } from "../core/Base.js";
import { clickSound } from "../core/Sound.js";

interface IFolder {
    guildId: string;
    name: string;
    parent: string | null;
    scope: "default" | "custom";
    images: number;
}

interface IImage {
    id: string;
    url: string;
    guildId: string;
    category: string;
    subcategory: string | null;
    file: string;
}

/** Ein Album ist eine Kategorie oder ein Unterordner - beides eine Zeile. */
function labelOf(folder: IFolder): string {
    const where = folder.scope === "default" ? "Vorlagen" : "Dein Server";

    return `${where} · ${folder.parent ? `${folder.parent}/${folder.name}` : folder.name}`;
}

function keyOf(folder: IFolder): string {
    return [folder.guildId, folder.parent ?? folder.name, folder.parent ? folder.name : ""].join("|");
}

// Muss genau wie SanitizeName() in src/constants/Gallery.ts rechnen: der Dienst
// legt ein neues Album unter dem sanitisierten Namen an, nicht unter der
// Rohtexteingabe. Der Dashboard-Client baut eigenstaendig (rootDir client/,
// nichts von ausserhalb) und kann diese Funktion deshalb nicht importieren -
// hier steht dieselbe Regel noch einmal, absichtlich, statt sie zu erraten.
function sanitized(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

export function renderGallery(guildId: string, canManage: boolean): void {
    const note = need<HTMLElement>("#galNote");
    const picker = need<HTMLSelectElement>("#galFolder");
    const parentPicker = need<HTMLSelectElement>("#galParent");
    const grid = need<HTMLElement>("#galGrid");
    const empty = need<HTMLElement>("#galEmpty");
    const file = need<HTMLInputElement>("#galFile");
    const newButton = need<HTMLButtonElement>("#galNew");
    const name = need<HTMLInputElement>("#galName");
    const delCatButton = need<HTMLButtonElement>("#galDelCat");
    const uploadButton = need<HTMLButtonElement>("#galUpload");
    const urlInput = need<HTMLInputElement>("#galUrl");
    const fetchButton = need<HTMLButtonElement>("#galFetch");

    let folders: IFolder[] = [];
    let images: IImage[] = [];

    // Zwei-Klick-Bestaetigung fuers Album-Loeschen (siehe resetDeleteConfirm/
    // delCatButton weiter unten). Als eigener Zustand, weil der Knopf - anders
    // als eine Bild-Kachel - bei einem Albumwechsel nicht neu gebaut wird: ohne
    // Rueckstellung bliebe eine scharfgestellte Frage ueber den Wechsel hinweg
    // stehen und der naechste Klick loeschte das falsche Album.
    let deleteArmed = false;
    let deleteTimer: number | null = null;

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    async function send(action: string, body: unknown): Promise<boolean> {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(body),
            });

            if (response.ok) return true;

            const data = (await response.json().catch(() => ({}))) as { error?: string };

            warn(data.error ?? `Der Bot hat abgelehnt (${response.status}).`);
        } catch {
            warn("Der Bot antwortet gerade nicht.");
        }

        return false;
    }

    function current(): { category: string; subcategory: string | null; own: boolean } | null {
        const folder = folders.find((entry) => keyOf(entry) === picker.value);

        if (!folder) return null;

        return {
            category: folder.parent ?? folder.name,
            subcategory: folder.parent ? folder.name : null,
            own: folder.scope === "custom",
        };
    }

    // Vorlagen sind nur zum Ansehen: was am gewaehlten Album haengt, sperrt mit
    // ihm. #galParent/#galName/#galNew haengen an keinem bestimmten Album -
    // die duerfen nur am Verwaltungsrecht scheitern, nicht an der Vorlage.
    function updateLocks(): void {
        const own = Boolean(current()?.own);

        parentPicker.disabled = !canManage;
        name.disabled = !canManage;
        newButton.disabled = !canManage;
        delCatButton.disabled = !canManage || !own;
        uploadButton.disabled = !canManage || !own;
        urlInput.disabled = !canManage || !own;
        fetchButton.disabled = !canManage || !own;
    }

    function resetDeleteConfirm(): void {
        deleteArmed = false;

        if (deleteTimer !== null) {
            window.clearTimeout(deleteTimer);
            deleteTimer = null;
        }

        delCatButton.replaceChildren(icon("#i-x"), document.createTextNode("Album löschen"));
    }

    // Nach jedem Albumwechsel (Auswahl oder Neuladen) auf denselben Stand:
    // Sperren, die Loesch-Frage und das Raster.
    function refresh(): void {
        resetDeleteConfirm();
        updateLocks();
        paintGrid();
    }

    async function load(): Promise<void> {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery`, {
                headers: { Accept: "application/json" },
            });

            if (!response.ok) {
                warn("Die Galerie lässt sich gerade nicht laden.");
                return;
            }

            const data = (await response.json()) as { categories: IFolder[]; images: IImage[] };

            folders = data.categories;
            images = data.images;
            warn(null);
            paintPicker();
            paintParent();
            refresh();
        } catch {
            warn("Der Bot antwortet gerade nicht.");
        }
    }

    // Eigener Rueckgabetyp statt "(ok) => ok && load()" direkt in then(): der
    // Ausdruck waere "false | Promise<void>", und das laesst then() nicht
    // durch. Verhalten unveraendert - laedt nur bei Erfolg neu.
    function reloadIfOk(ok: boolean): void {
        if (ok) void load();
    }

    function paintPicker(): void {
        const chosen = picker.value;

        picker.replaceChildren(
            ...folders.map((folder) => {
                const option = document.createElement("option");

                option.value = keyOf(folder);
                option.textContent = `${labelOf(folder)} (${folder.images})`;

                return option;
            })
        );

        // Nach dem Neuladen dasselbe Album wie vorher, sofern es das noch gibt.
        if (folders.some((folder) => keyOf(folder) === chosen)) picker.value = chosen;
    }

    // #galParent listet nur eigene Hauptalben: ein Unterordner unter einem
    // Unterordner kennt der Dienst nicht (DirectoryFor geht nur zwei Ebenen tief).
    function paintParent(): void {
        const chosen = parentPicker.value;
        const mains = folders.filter((folder) => folder.scope === "custom" && folder.parent === null);

        const top = document.createElement("option");

        top.value = "";
        top.textContent = "Oberste Ebene";

        parentPicker.replaceChildren(
            top,
            ...mains.map((folder) => {
                const option = document.createElement("option");

                option.value = folder.name;
                option.textContent = folder.name;

                return option;
            })
        );

        // Dieselbe Auswahl wie vorher, sofern das Hauptalbum noch existiert.
        if (mains.some((folder) => folder.name === chosen)) parentPicker.value = chosen;
    }

    function paintGrid(): void {
        const here = current();
        const shown = here
            ? images.filter(
                  (image) => image.category === here.category && image.subcategory === here.subcategory
              )
            : [];

        grid.replaceChildren(...shown.map((image) => tile(image, Boolean(here?.own) && canManage)));
        empty.hidden = shown.length > 0;
    }

    // Verschieben sitzt als Auswahl in der Kachel-Leiste: erste Option
    // "Verschieben nach…" (leer, gewaehlt), danach jedes eigene Album ausser
    // dem gerade gezeigten.
    function moveSelect(image: IImage): HTMLSelectElement {
        const select = document.createElement("select");

        select.className = "galtile__move";
        select.setAttribute("aria-label", "Bild verschieben nach");

        const blank = document.createElement("option");

        blank.value = "";
        blank.textContent = "Verschieben nach…";
        blank.selected = true;

        const targets = folders.filter((folder) => folder.scope === "custom" && keyOf(folder) !== picker.value);

        select.replaceChildren(
            blank,
            ...targets.map((folder) => {
                const option = document.createElement("option");

                option.value = keyOf(folder);
                option.textContent = `${labelOf(folder)} (${folder.images})`;

                return option;
            })
        );

        select.addEventListener("change", () => {
            const target = folders.find((folder) => keyOf(folder) === select.value);

            if (!target) return;

            clickSound("primary");
            void send("image/move", {
                image: image.id,
                category: target.parent ?? target.name,
                subcategory: target.parent ? target.name : null,
            }).then(reloadIfOk);
        });

        return select;
    }

    function tile(image: IImage, editable: boolean): HTMLElement {
        const box = document.createElement("figure");

        box.className = "galtile";

        const picture = document.createElement("img");

        picture.src = image.url;
        picture.alt = image.file;
        picture.loading = "lazy";
        box.append(picture);

        if (!editable) return box;

        const bar = document.createElement("div");

        bar.className = "galtile__bar";
        bar.append(moveSelect(image));

        const remove = document.createElement("button");

        remove.type = "button";
        remove.title = "Bild löschen";
        remove.append(icon("#i-x"));
        // Ein geloeschtes Bild ist weg - das darf keine Fingerbewegung sein.
        // Zwei Klicks statt einer Systembox: der erste fragt, der zweite loescht.
        let sure = false;

        remove.addEventListener("click", () => {
            clickSound("primary");

            if (!sure) {
                sure = true;
                remove.classList.add("is-sure");
                remove.replaceChildren(document.createTextNode("Wirklich?"));
                window.setTimeout(() => {
                    sure = false;
                    remove.classList.remove("is-sure");
                    remove.replaceChildren(icon("#i-x"));
                }, 4000);

                return;
            }

            void send("image/delete", { image: image.id }).then(reloadIfOk);
        });

        bar.append(remove);
        box.append(bar);

        return box;
    }

    picker.addEventListener("change", refresh);

    function create(): void {
        const wanted = name.value.trim();

        if (!wanted) return;

        const mainAlbum = parentPicker.value || null;
        const body = mainAlbum ? { category: mainAlbum, subcategory: wanted } : { category: wanted };

        clickSound("primary");
        void send("category", body).then((ok) => {
            if (!ok) return;

            name.value = "";

            // Sonst sieht der Nutzer nach dem Klick nur eine Zahl in der Liste
            // wachsen, statt sein neues Album vor sich zu haben.
            const key = keyOf({ guildId, name: sanitized(wanted), parent: mainAlbum, scope: "custom", images: 0 });

            void load().then(() => {
                picker.value = key;
                refresh();
            });
        });
    }

    newButton.addEventListener("click", create);
    name.addEventListener("keydown", (event) => {
        if (event.key === "Enter") create();
    });

    // Album loeschen: zwei Klicks wie beim Bild. Ein Hauptalbum loescht der
    // Dienst rekursiv samt Unteralben (DeleteCategory -> rm(..., {recursive:
    // true})) - das muss die Frage schon sagen, nicht erst die Loeschung.
    delCatButton.addEventListener("click", () => {
        const here = current();

        if (!here) return;

        clickSound("primary");

        if (!deleteArmed) {
            deleteArmed = true;
            delCatButton.replaceChildren(
                document.createTextNode(
                    here.subcategory ? "Wirklich? Löscht alle Bilder darin" : "Wirklich? Löscht auch alle Unteralben"
                )
            );
            deleteTimer = window.setTimeout(resetDeleteConfirm, 4000);

            return;
        }

        resetDeleteConfirm();
        void send("category/delete", { category: here.category, subcategory: here.subcategory }).then(reloadIfOk);
    });

    uploadButton.addEventListener("click", () => file.click());

    file.addEventListener("change", () => {
        const chosen = file.files?.[0];
        const here = current();

        file.value = "";

        if (!chosen) return;

        if (!here?.own) {
            warn("Vorlagen lassen sich nicht verändern – lege zuerst ein eigenes Album an.");
            return;
        }

        const query = new URLSearchParams({ category: here.category, name: chosen.name });

        if (here.subcategory) query.set("subcategory", here.subcategory);

        void (async () => {
            try {
                const response = await fetch(
                    `${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery/image?${query}`,
                    { method: "POST", headers: { "Content-Type": chosen.type }, body: chosen }
                );

                if (!response.ok) {
                    const data = (await response.json().catch(() => ({}))) as { error?: string };

                    warn(data.error ?? `Der Bot hat abgelehnt (${response.status}).`);
                    return;
                }

                warn(null);
                await load();
            } catch {
                warn("Der Bot antwortet gerade nicht.");
            }
        })();
    });

    fetchButton.addEventListener("click", () => {
        const wanted = urlInput.value.trim();

        if (!wanted) return;

        const here = current();

        clickSound("primary");
        void send("image/url", { url: wanted, category: here?.category, subcategory: here?.subcategory }).then(
            (ok) => {
                if (!ok) return;

                urlInput.value = "";
                void load();
            }
        );
    });

    updateLocks();
    void load();
}
