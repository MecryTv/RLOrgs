/** Abschnitt: Galerie eines Servers. */

import { icon, need } from "../core/Dom.js";
import { BASE } from "../core/Base.js";
import { failureText, MAX_UPLOAD_BYTES, megabytes, uploadImage } from "../core/Gallery.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";

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

// Ein Bild auf dem Weg in die Galerie - so lange nur eine lokale Notiz, kein
// Eintrag aus der API. Ueber category/subcategory findet paintGrid() heraus,
// ob die Kachel zum gerade gezeigten Album gehoert.
interface IBusyUpload {
    id: number;
    category: string;
    subcategory: string | null;
    file: File;
    // Das Bild aus dem Browser: die Kachel zeigt es, bevor der Bot es hat.
    preview: string;
    phase: "queued" | "upload" | "shrink" | "failed";
    // Anteil der schon gesendeten Bytes, 0 bis 1.
    progress: number;
    error: string | null;
}

// Identitaet eines Albums fuer die Auswahl - guildId traegt den Scope schon
// mit (Vorlagen liegen unter "default", eigene Alben unter der echten Guild-ID),
// ein drittes Feld dafuer braucht es nicht.
function keyOf(folder: { guildId: string; parent: string | null; name: string }): string {
    return `${folder.guildId}|${folder.parent ?? ""}|${folder.name}`;
}

// Ein Unteralbum ist in der API sein eigener Eintrag mit parent gesetzt - fuer
// Anfragen an die Route braucht es dagegen category/subcategory des Hauptalbums.
function targetOf(folder: IFolder): { category: string; subcategory: string | null } {
    return { category: folder.parent ?? folder.name, subcategory: folder.parent ? folder.name : null };
}

// Kachel-Titel: Dateiname ohne Endung.
function stem(file: string): string {
    const dot = file.lastIndexOf(".");

    return dot > 0 ? file.slice(0, dot) : file;
}

// Zeile unter dem Titel: bei Vorlagen immer "Vorlage" (das sagt mehr als ihre
// tatsaechliche Endung), bei eigenen Bildern die Art der Datei - GalleryService
// speichert eigene Uploads immer als .webp ausser bei einem echten GIF, die
// Grossbuchstaben-Endung ist nur ein Auffangnetz fuer alles andere.
function kindOf(file: string, own: boolean): string {
    if (!own) return "Vorlage";

    const dot = file.lastIndexOf(".");
    const extension = dot >= 0 ? file.slice(dot + 1).toLowerCase() : "";

    if (extension === "gif") return "GIF · animiert";
    if (extension === "webp") return "WebP";

    return extension.toUpperCase();
}

// Ohne Vorauswahl: zuerst ein eigenes Hauptalbum, sonst irgendein eigenes,
// sonst eine Vorlage - nur wenn eine Guild wirklich nichts hat, bleibt null.
function defaultPick(list: IFolder[]): IFolder | null {
    return (
        list.find((folder) => folder.scope === "custom" && folder.parent === null) ??
        list.find((folder) => folder.scope === "custom") ??
        list.find((folder) => folder.scope === "default" && folder.parent === null) ??
        list.find((folder) => folder.scope === "default") ??
        null
    );
}

export function renderGallery(guildId: string, canManage: boolean): void {
    const note = need<HTMLElement>("#galNote");
    const treeNav = need<HTMLElement>("#galTree");
    const pane = need<HTMLElement>("#galPane");
    const crumb = need<HTMLElement>("#galCrumb");
    const title = need<HTMLElement>("#galTitle");
    const meta = need<HTMLElement>("#galMeta");
    const backdropButton = need<HTMLButtonElement>("#galBackdrop");
    const galActions = need<HTMLElement>("#galActions");
    const uploadButton = need<HTMLButtonElement>("#galUpload");
    const urlToggleButton = need<HTMLButtonElement>("#galUrlToggle");
    const delCatButton = need<HTMLButtonElement>("#galDelCat");
    const delCatLabel = need<HTMLElement>("#galDelCat span");
    const urlForm = need<HTMLFormElement>("#galUrl");
    const urlInput = need<HTMLInputElement>("#galUrlInput");
    const urlCloseButton = need<HTMLButtonElement>("#galUrlClose");
    const galReadonly = need<HTMLElement>("#galReadonly");
    const grid = need<HTMLElement>("#galGrid");
    const empty = need<HTMLElement>("#galEmpty");
    const emptyUploadButton = need<HTMLButtonElement>("#galEmpty button");
    const file = need<HTMLInputElement>("#galFile");
    const moveDialog = need<HTMLDialogElement>("#galMove");
    const moveFileText = need<HTMLElement>("#galMoveFile");
    const moveList = need<HTMLElement>("#galMoveList");
    const moveGoButton = need<HTMLButtonElement>("#galMoveGo");

    let folders: IFolder[] = [];
    let images: IImage[] = [];
    let busy: IBusyUpload[] = [];
    let busyId = 0;
    // Je Upload seine Kachel. Sie entsteht einmal und wird danach nur
    // nachgezogen - neu gebaut spraenge der Balken bei jedem Fortschritt zurueck.
    const busyTiles = new Map<number, HTMLElement>();
    // Das gerade fertig gewordene Bild: paintGrid() hebt seine Kachel einmal
    // hervor, damit das Auge es an seinem sortierten Platz findet.
    let fresh: string | null = null;
    let current: IFolder | null = null;

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    // T ist der Erfolgs-Rumpf der jeweiligen Aktion (category liefert die
    // gespeicherten Namen, die anderen Aktionen braucht niemand ausgewertet -
    // Record<string, unknown> reicht ihnen als Vorgabe).
    async function send<T = Record<string, unknown>>(action: string, body: unknown): Promise<T | null> {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(body),
            });

            const failure = await failureText(response);

            if (failure !== null) {
                warn(failure);
                return null;
            }

            return (await response.json().catch(() => ({}))) as T;
        } catch {
            warn("Der Bot antwortet gerade nicht.");
        }

        return null;
    }

    // Nur ein eigenes Album, das der Nutzer auch verwalten darf, laesst sich
    // aendern - eine Vorlage nie, ein eigenes Album ohne canManage genauso
    // wenig wie eine Vorlage (der Grund dafuer steht im Hinweis #readonly der
    // Serverseite, nicht hier).
    function isWritable(): boolean {
        return canManage && current !== null && current.scope === "custom";
    }

    /* ------------------------------------------------------------
       Baum
       ------------------------------------------------------------ */
    function cap(text: string, lock: boolean): HTMLElement {
        const el = document.createElement("div");

        el.className = "galtree__cap";
        if (lock) el.append(icon("#i-lock"));
        el.append(text);

        return el;
    }

    function row(folder: IFolder): HTMLElement {
        const wrap = document.createElement("div");

        wrap.className = "galtree__row";

        const item = document.createElement("button");

        item.type = "button";
        item.className = folder.parent ? "galtree__item is-sub" : "galtree__item";
        item.setAttribute("aria-current", String(folder === current));

        const name = document.createElement("span");

        name.className = "galtree__name";
        name.textContent = folder.name;

        const num = document.createElement("span");

        num.className = "galtree__count";
        num.textContent = String(folder.images);

        item.append(icon("#i-folder"), name, num);
        item.addEventListener("click", () => select(folder));
        wrap.append(item);

        // Ein Unteralbum anlegen geht nur an einem eigenen Hauptalbum, und nur
        // mit Verwaltungsrecht - ohne das fehlt auch "Neues Album" unten.
        if (folder.scope === "custom" && folder.parent === null && canManage) {
            const sub = document.createElement("button");

            sub.type = "button";
            sub.className = "galtree__sub";
            sub.title = `Unteralbum in „${folder.name}“ anlegen`;
            sub.setAttribute("aria-label", sub.title);
            sub.append(icon("#i-folder-plus"));
            sub.addEventListener("click", () => openForm(wrap, folder.name));
            wrap.append(sub);
        }

        return wrap;
    }

    // Je Gruppe: erst die Hauptalben, direkt gefolgt von ihren eigenen
    // Unteralben - so wie die API sie liefert (Hauptalben und Unteralben
    // getrennt sortiert), aber im Baum sollen Unteralben unter ihrem Hauptalbum
    // stehen statt irgendwo in einer zweiten, eigenen Liste.
    function groupedRows(scope: "custom" | "default"): HTMLElement[] {
        const group = folders.filter((folder) => folder.scope === scope);
        const mains = group.filter((folder) => folder.parent === null);
        const rows: HTMLElement[] = [];

        for (const main of mains) {
            rows.push(row(main));

            for (const sub of group.filter((folder) => folder.parent === main.name)) rows.push(row(sub));
        }

        return rows;
    }

    function paintTree(): void {
        const children: (Node | string)[] = [cap("Dein Server", false), ...groupedRows("custom")];

        if (canManage) {
            const add = document.createElement("button");

            add.type = "button";
            add.className = "galtree__add";
            add.append(icon("#i-plus"), document.createTextNode("Neues Album"));
            add.addEventListener("click", () => openForm(add, null));
            children.push(add);
        }

        children.push(cap("Vorlagen", true), ...groupedRows("default"));

        treeNav.replaceChildren(...children);
    }

    // Inline-Formular fuer ein neues Album bzw. Unteralbum - ersetzt jedes Mal
    // ein eventuell schon offenes. parent ist entweder ein Nutzername (kommt
    // per textContent hinein, nie per innerHTML) oder null fuer ein Hauptalbum.
    function closeForm(): void {
        document.querySelector(".galtree__form")?.remove();
    }

    function openForm(after: Element, parent: string | null): void {
        closeForm();

        const box = document.createElement("form");

        box.className = "galtree__form";

        const label = document.createElement("label");

        label.htmlFor = "galNewName";
        label.textContent = parent ? `Unteralbum in „${parent}“` : "Neues Album";

        const input = document.createElement("input");

        input.className = "text";
        input.id = "galNewName";
        input.maxLength = 32;
        input.placeholder = "z. B. sponsoren";

        const buttons = document.createElement("div");
        const submit = document.createElement("button");

        submit.className = "btn btn--primary";
        submit.type = "submit";
        submit.textContent = "Anlegen";

        const cancel = document.createElement("button");

        cancel.className = "btn btn--quiet";
        cancel.type = "button";
        cancel.textContent = "Abbrechen";
        cancel.addEventListener("click", closeForm);

        buttons.append(submit, cancel);
        box.append(label, input, buttons);

        box.addEventListener("submit", (event) => {
            event.preventDefault();

            const wanted = input.value.trim();

            if (!wanted) return;

            clickSound("primary");

            const body = parent ? { category: parent, subcategory: wanted } : { category: wanted };

            void send<{ category: string; subcategory: string | null }>("category", body).then((result) => {
                if (!result) return;

                closeForm();
                toast("info", "Album angelegt", `„${result.subcategory ?? result.category}“ steht jetzt bereit.`);

                // Der Dienst legt unter SanitizeName() an, nicht unter der
                // Rohtexteingabe - die Route liefert die gespeicherten Namen
                // zurueck (DashboardApiGalleryEdit.Run), damit hier nichts
                // geraten werden muss.
                void load(
                    keyOf({
                        guildId,
                        parent: result.subcategory ? result.category : null,
                        name: result.subcategory ?? result.category,
                    })
                );
            });
        });

        // In der waagerechten Leiste auf dem Handy haette das Formular keinen
        // Platz - dort steht es unter der Leiste statt mitten in der Zeile.
        if (matchMedia("(max-width: 860px)").matches) treeNav.after(box);
        else after.after(box);

        input.focus();
    }

    /* ------------------------------------------------------------
       Kopf und Sperren
       ------------------------------------------------------------ */
    let deleteArmed = false;
    let deleteTimer: number | null = null;

    function armDelete(question: string): void {
        deleteArmed = true;
        delCatButton.classList.add("is-sure");
        delCatLabel.textContent = question;
        deleteTimer = window.setTimeout(resetDeleteConfirm, 4000);
    }

    // Nach jedem Albumwechsel und jedem Neuladen auf denselben Stand - sonst
    // bliebe eine scharfgestellte Frage ueber den Wechsel hinweg stehen und der
    // naechste Klick loeschte das falsche Album.
    function resetDeleteConfirm(): void {
        if (!deleteArmed) return;

        deleteArmed = false;

        if (deleteTimer !== null) {
            window.clearTimeout(deleteTimer);
            deleteTimer = null;
        }

        delCatButton.classList.remove("is-sure");
        delCatLabel.textContent = "Album löschen";
    }

    function paintPane(): void {
        resetDeleteConfirm();

        if (!current) {
            crumb.replaceChildren();
            title.replaceChildren();
            meta.textContent = "";
            galActions.hidden = true;
            urlForm.hidden = true;
            urlToggleButton.setAttribute("aria-expanded", "false");
            galReadonly.hidden = true;
            grid.replaceChildren();
            empty.hidden = true;
            return;
        }

        const own = current.scope === "custom";
        const writable = isWritable();
        const target = targetOf(current);

        crumb.replaceChildren(own ? "Dein Server" : "Vorlagen");

        if (target.subcategory) {
            const sep = document.createElement("i");

            sep.textContent = "/";
            crumb.append(sep, target.category);
        }

        title.replaceChildren(current.name);

        if (!writable) {
            const pill = document.createElement("span");

            pill.className = "pill";
            pill.append(icon("#i-lock"), "Schreibgeschützt");
            title.append(pill);
        }

        const n = current.images;

        meta.textContent = own
            ? `${n} ${n === 1 ? "Bild" : "Bilder"} · neue Bilder werden auf 1920 px verkleinert`
            : `${n} ${n === 1 ? "Bild" : "Bilder"} · Vorlagen des Bots`;

        galActions.hidden = !writable;
        urlForm.hidden = true;
        urlToggleButton.setAttribute("aria-expanded", "false");
        // Nur für Vorlagen sichtbar - nicht für eigene Alben ohne Verwaltungsrecht.
        galReadonly.hidden = own;

        paintGrid();
    }

    /* ------------------------------------------------------------
       Raster
       ------------------------------------------------------------ */
    function tile(image: IImage, own: boolean, writable: boolean): HTMLElement {
        const box = document.createElement("figure");

        box.className = image.id === fresh ? "galtile is-new" : "galtile";

        const imgWrap = document.createElement("div");

        imgWrap.className = "galtile__img";

        const picture = document.createElement("img");

        picture.loading = "lazy";
        picture.alt = stem(image.file);
        picture.src = image.url;
        imgWrap.append(picture);

        const figcap = document.createElement("figcaption");

        figcap.className = "galtile__cap";

        const name = document.createElement("b");

        name.textContent = stem(image.file);

        const kind = document.createElement("span");

        kind.textContent = kindOf(image.file, own);
        figcap.append(name, kind);
        box.append(imgWrap, figcap);

        if (!writable) return box;

        const bar = document.createElement("div");

        bar.className = "galtile__actions";

        const move = document.createElement("button");

        move.type = "button";
        move.className = "galtile__act";
        move.title = "Verschieben";
        move.setAttribute("aria-label", `${stem(image.file)} verschieben`);
        move.append(icon("#i-move"));
        move.addEventListener("click", () => openMove(image));

        const del = document.createElement("button");

        del.type = "button";
        del.className = "galtile__act is-danger";
        del.title = "Löschen";
        del.setAttribute("aria-label", `${stem(image.file)} löschen`);
        del.append(icon("#i-trash"));

        // Zwei Klicks fuer Unumkehrbares: der erste fragt, der zweite loescht.
        // Ein eigener Zustand je Kachel reicht - die Kachel wird bei jedem
        // Neuzeichnen ohnehin frisch gebaut.
        let sure = false;

        del.addEventListener("click", () => {
            clickSound("primary");

            if (!sure) {
                sure = true;
                del.classList.add("is-sure");
                del.replaceChildren(icon("#i-trash"), document.createTextNode("Löschen?"));
                window.setTimeout(() => {
                    sure = false;
                    del.classList.remove("is-sure");
                    del.replaceChildren(icon("#i-trash"));
                }, 4000);

                return;
            }

            const label = stem(image.file);

            void send("image/delete", { image: image.id }).then((result) => {
                if (!result) return;

                toast("info", "Bild gelöscht", `„${label}“ ist weg.`);
                void load();
            });
        });

        bar.append(move, del);
        box.append(bar);

        return box;
    }

    // Die Kachel eines Uploads: das Bild aus dem Browser unter einem Schleier,
    // der mit den gesendeten Bytes nach oben weicht, darunter ein Balken. Was
    // die Phase zeigt, regelt style.css ueber data-phase.
    function busyTile(entry: IBusyUpload): HTMLElement {
        const known = busyTiles.get(entry.id);

        if (known) return known;

        const box = document.createElement("figure");

        box.className = "galtile is-busy";

        const imgWrap = document.createElement("div");

        imgWrap.className = "galtile__img";

        const picture = document.createElement("img");

        picture.alt = "";
        // Ein Format, das der Browser nicht zeichnen kann, laesst nur die
        // Vorschau weg - der Upload selbst laeuft trotzdem.
        picture.addEventListener("error", () => picture.remove());
        picture.src = entry.preview;

        const veil = document.createElement("span");

        veil.className = "galtile__veil";

        const chip = document.createElement("span");

        chip.className = "galtile__pct";

        const bar = document.createElement("span");

        bar.className = "galtile__bar";
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-label", `${entry.file.name} hochladen`);
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");

        imgWrap.append(picture, veil, chip, bar);

        const figcap = document.createElement("figcaption");

        figcap.className = "galtile__cap";

        const name = document.createElement("b");

        name.textContent = stem(entry.file.name);
        figcap.append(name, document.createElement("span"));
        box.append(imgWrap, figcap);
        busyTiles.set(entry.id, box);
        paintBusy(entry);

        return box;
    }

    // Zieht die Kachel auf den Stand des Uploads nach, ohne sie neu zu bauen.
    function paintBusy(entry: IBusyUpload): void {
        const box = busyTiles.get(entry.id);

        // Ein Fehler steht einmal da und aendert sich nicht mehr.
        if (!box || box.dataset.phase === "failed") return;

        const chip = box.querySelector<HTMLElement>(".galtile__pct")!;
        const bar = box.querySelector<HTMLElement>(".galtile__bar")!;
        const text = box.querySelector<HTMLElement>(".galtile__cap span")!;
        const percent = Math.round(entry.progress * 100);

        box.dataset.phase = entry.phase;
        box.style.setProperty("--p", String(entry.progress));

        if (entry.phase === "upload") {
            chip.textContent = `${percent} %`;
            bar.setAttribute("aria-valuenow", String(percent));
            text.textContent = `${megabytes(entry.file.size * entry.progress)} von ${megabytes(entry.file.size)}`;
            return;
        }

        // Ohne Wert gilt der Balken als unbestimmt - so lange weiss niemand,
        // wie lange Warten oder Verkleinern dauern.
        bar.removeAttribute("aria-valuenow");
        chip.replaceChildren();

        if (entry.phase === "queued") {
            text.textContent = "Wartet …";
            return;
        }

        if (entry.phase === "shrink") {
            text.textContent = "Wird verkleinert …";
            return;
        }

        chip.append(icon("#i-warn"));
        text.textContent = entry.error;
        // Wird eingefuegt statt geaendert, damit ein Screenreader es vorliest.
        text.setAttribute("role", "alert");

        // Einmal zucken, nicht bei jedem Neuzeichnen: paintGrid() haengt die
        // Kachel immer wieder neu ein, und damit liefe die Animation erneut.
        box.classList.add("is-nudge");
        box.addEventListener("animationend", () => box.classList.remove("is-nudge"), { once: true });

        const dismiss = document.createElement("button");

        dismiss.type = "button";
        dismiss.className = "galtile__act galtile__dismiss";
        dismiss.title = "Entfernen";
        dismiss.setAttribute("aria-label", `Hinweis zu ${entry.file.name} entfernen`);
        dismiss.append(icon("#i-x"));
        dismiss.addEventListener("click", () => {
            forget(entry);
            paintGrid();
        });
        box.append(dismiss);
    }

    function forget(entry: IBusyUpload): void {
        busy = busy.filter((other) => other !== entry);
        busyTiles.delete(entry.id);
        URL.revokeObjectURL(entry.preview);
    }

    function dropButton(): HTMLElement {
        const el = document.createElement("button");

        el.type = "button";
        el.className = "galdrop";
        el.append(icon("#i-upload"));

        const strong = document.createElement("b");

        strong.textContent = "Bilder hierher ziehen";
        el.append(strong, document.createTextNode("oder klicken zum Auswählen"));
        el.addEventListener("click", () => file.click());

        return el;
    }

    function paintGrid(): void {
        if (!current) return;

        const own = current.scope === "custom";
        const writable = isWritable();
        const target = targetOf(current);

        const shown = images.filter(
            (image) => image.category === target.category && image.subcategory === target.subcategory
        );
        const busyHere = busy.filter(
            (entry) => entry.category === target.category && entry.subcategory === target.subcategory
        );

        const tiles = shown.map((image) => tile(image, own, writable));

        for (const entry of busyHere) tiles.push(busyTile(entry));
        if (writable) tiles.push(dropButton());

        grid.replaceChildren(...tiles);
        // Hervorgehoben wird nur beim ersten Zeichnen danach, nicht bei jedem.
        fresh = null;

        const isEmpty = writable && shown.length === 0 && busyHere.length === 0;

        empty.hidden = !isEmpty;
        grid.hidden = isEmpty;
    }

    function select(folder: IFolder): void {
        current = folder;
        paintTree();
        paintPane();
    }

    /* ------------------------------------------------------------
       Verschieben
       ------------------------------------------------------------ */
    let moveImage: IImage | null = null;
    let moveTarget: IFolder | null = null;

    function moveRow(folder: IFolder): HTMLElement {
        const item = document.createElement("button");

        item.type = "button";
        item.setAttribute("role", "radio");
        item.setAttribute("aria-checked", "false");
        // Ohne is-sub: im Dialog fehlt die Baumlinie, "hauptalbum / unteralbum"
        // sagt die Zugehoerigkeit stattdessen im Text.
        item.className = "galtree__item";

        const label = document.createElement("span");

        label.className = "galtree__name";
        label.textContent = folder.parent ? `${folder.parent} / ${folder.name}` : folder.name;

        item.append(icon("#i-folder"), label);
        item.addEventListener("click", () => {
            for (const other of moveList.children) other.setAttribute("aria-checked", "false");

            item.setAttribute("aria-checked", "true");
            moveTarget = folder;
            moveGoButton.disabled = false;
        });

        return item;
    }

    function openMove(image: IImage): void {
        const here = current;

        if (!here) return;

        moveImage = image;
        moveTarget = null;
        moveGoButton.disabled = true;
        moveFileText.textContent = `„${stem(image.file)}“ in ein anderes eigenes Album legen.`;

        const candidates = folders.filter((folder) => folder.scope === "custom" && keyOf(folder) !== keyOf(here));

        moveList.replaceChildren(...candidates.map((folder) => moveRow(folder)));
        moveDialog.showModal();
    }

    /* ------------------------------------------------------------
       Hochladen
       ------------------------------------------------------------ */
    async function uploadFiles(chosen: File[]): Promise<void> {
        if (!isWritable() || !current) return;

        const target = targetOf(current);
        const albumLabel = current.name;
        // Dieselbe Liste wie im accept des Datei-Felds - beim Ziehen gilt die
        // sonst nicht.
        const accepted = file.accept.split(",");
        const queue: IBusyUpload[] = [];

        for (const picked of chosen) {
            if (!picked.type.startsWith("image/")) {
                warn(`„${picked.name}“ ist kein Bild und wurde übersprungen.`);
                continue;
            }

            const entry: IBusyUpload = {
                id: ++busyId,
                ...target,
                file: picked,
                preview: URL.createObjectURL(picked),
                phase: "queued",
                progress: 0,
                error: null,
            };

            // Was die Route ohnehin ablehnt, scheitert sofort auf der Kachel,
            // statt erst Megabytes durchs Netz zu schicken.
            if (picked.size > MAX_UPLOAD_BYTES) {
                entry.phase = "failed";
                entry.error = `Zu groß – ${megabytes(picked.size)}, höchstens ${megabytes(MAX_UPLOAD_BYTES)}.`;
            } else if (!accepted.includes(picked.type)) {
                entry.phase = "failed";
                entry.error = "Nur PNG, JPG, GIF oder WebP.";
            } else {
                queue.push(entry);
            }

            busy.push(entry);
        }

        paintGrid();

        let uploaded = 0;

        // Nacheinander statt parallel: ein grosses Bild bekommt die ganze
        // Leitung, die Kacheln dahinter zeigen "Wartet", bis sie dran sind.
        for (const entry of queue) {
            entry.phase = "upload";
            paintBusy(entry);

            const result = await uploadImage(guildId, entry, entry.file, (phase, fraction) => {
                entry.phase = phase;
                entry.progress = fraction;
                paintBusy(entry);
            });

            if (result.error !== null) {
                entry.phase = "failed";
                entry.error = result.error;
                paintBusy(entry);
                continue;
            }

            uploaded++;
            // Erst aus der Liste, dann neu laden: bis die Antwort da ist, bleibt
            // die Kachel stehen, danach steht das echte Bild im Raster.
            forget(entry);
            fresh = result.id ?? null;

            if (!(await load())) paintGrid();
        }

        if (uploaded > 0) {
            toast(
                "info",
                uploaded === 1 ? "Bild hochgeladen" : "Bilder hochgeladen",
                uploaded === 1 ? `Liegt jetzt in „${albumLabel}“.` : `${uploaded} Bilder liegen jetzt in „${albumLabel}“.`
            );
        }
    }

    /* ------------------------------------------------------------
       Laden
       ------------------------------------------------------------ */
    // Steigt bei jedem load()-Aufruf; eine Antwort zaehlt nur, wenn sie noch zur
    // zuletzt gestarteten load() gehoert. Ohne das entscheidet die Netzlaufzeit
    // statt der Reihenfolge der Aufrufe, welcher Stand am Ende angezeigt wird.
    let loadGeneration = 0;

    // prefer waehlt das Album direkt beim Neuladen aus (fuer den Fall, dass die
    // vorherige Auswahl nach dem Neuladen nicht mehr die richtige ist - siehe
    // openForm() oben und delCatButton weiter unten); ohne prefer bleibt die
    // bisherige Auswahl, sofern es sie noch gibt, sonst greift defaultPick().
    // false heisst: nichts neu gezeichnet (Fehler oder ueberholt).
    async function load(prefer?: string): Promise<boolean> {
        const generation = ++loadGeneration;

        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery`, {
                headers: { Accept: "application/json" },
            });

            const failure = await failureText(response);

            if (generation !== loadGeneration) return false;

            if (failure !== null) {
                warn(failure);
                return false;
            }

            const data = (await response.json()) as { categories: IFolder[]; images: IImage[] };

            if (generation !== loadGeneration) return false;

            folders = data.categories;
            images = data.images;
            warn(null);

            const wanted = prefer ?? (current ? keyOf(current) : null);

            current = (wanted !== null ? folders.find((folder) => keyOf(folder) === wanted) : undefined) ?? defaultPick(folders);

            paintTree();
            paintPane();

            return true;
        } catch {
            if (generation === loadGeneration) warn("Der Bot antwortet gerade nicht.");
        }

        return false;
    }

    /* ------------------------------------------------------------
       Dauerhafte Listener - einmal angebunden, nicht bei jedem Neuzeichnen.
       ------------------------------------------------------------ */
    backdropButton.addEventListener("click", () => {
        const on = !pane.classList.contains("is-light");

        pane.classList.toggle("is-light", on);
        backdropButton.setAttribute("aria-pressed", String(on));
    });

    urlToggleButton.addEventListener("click", () => {
        const open = urlForm.hidden;

        urlForm.hidden = !open;
        urlToggleButton.setAttribute("aria-expanded", String(open));
        if (open) urlInput.focus();
    });

    function closeUrlForm(): void {
        urlForm.hidden = true;
        urlToggleButton.setAttribute("aria-expanded", "false");
    }

    urlCloseButton.addEventListener("click", closeUrlForm);

    urlForm.addEventListener("submit", (event) => {
        event.preventDefault();

        if (!current) return;

        const wanted = urlInput.value.trim();

        if (!wanted) return;

        const target = targetOf(current);
        const albumLabel = current.name;

        clickSound("primary");

        void send("image/url", { url: wanted, category: target.category, subcategory: target.subcategory }).then(
            (result) => {
                if (!result) return;

                urlInput.value = "";
                closeUrlForm();
                toast("info", "Bild geholt", `Liegt jetzt in „${albumLabel}“.`);
                void load();
            }
        );
    });

    // Album loeschen: zwei Klicks wie beim Bild. Ein Hauptalbum loescht der
    // Dienst rekursiv samt Unteralben - das muss die Frage schon sagen, nicht
    // erst die Loeschung.
    delCatButton.addEventListener("click", () => {
        if (!current) return;

        clickSound("primary");

        const target = targetOf(current);

        if (!deleteArmed) {
            armDelete(target.subcategory ? "Wirklich? Löscht alle Bilder darin" : "Wirklich? Auch alle Unteralben");
            return;
        }

        resetDeleteConfirm();

        const label = current.name;
        // Nach dem Loeschen eines Unteralbums ist sein Hauptalbum gewaehlt; nach
        // dem Loeschen eines Hauptalbums greift defaultPick() in load() von
        // selbst, weil dessen eigener Schluessel dann nicht mehr existiert.
        const parentKey = target.subcategory ? keyOf({ guildId, parent: null, name: target.category }) : undefined;

        void send("category/delete", { category: target.category, subcategory: target.subcategory }).then(
            (result) => {
                if (!result) return;

                toast("info", "Album gelöscht", `„${label}“ ist weg.`);
                void load(parentKey);
            }
        );
    });

    uploadButton.addEventListener("click", () => file.click());
    emptyUploadButton.addEventListener("click", () => file.click());

    file.addEventListener("change", () => {
        // Erst kopieren, dann leeren: file.files ist eine lebende Liste, die das
        // Zuruecksetzen des Werts mit leert - vorher kam so nie ein Upload an.
        const chosen = [...(file.files ?? [])];

        file.value = "";
        if (chosen.length > 0) void uploadFiles(chosen);
    });

    pane.addEventListener("dragover", (event) => {
        if (!isWritable()) return;

        event.preventDefault();
        pane.classList.add("is-drag");
    });
    pane.addEventListener("dragleave", (event) => {
        if (!pane.contains(event.relatedTarget as Node | null)) pane.classList.remove("is-drag");
    });
    pane.addEventListener("drop", (event) => {
        if (!isWritable()) return;

        event.preventDefault();
        pane.classList.remove("is-drag");

        const dropped = event.dataTransfer?.files;

        if (dropped && dropped.length > 0) void uploadFiles([...dropped]);
    });

    moveDialog.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;

        if (target.closest("[data-close]") || target === moveDialog) moveDialog.close();
    });

    moveGoButton.addEventListener("click", () => {
        if (!moveTarget || !moveImage) return;

        const targetFolder = moveTarget;
        const image = moveImage;
        const label = stem(image.file);
        const targetLabel = targetFolder.name;

        moveDialog.close();
        clickSound("primary");

        void send("image/move", {
            image: image.id,
            category: targetFolder.parent ?? targetFolder.name,
            subcategory: targetFolder.parent ? targetFolder.name : null,
        }).then((result) => {
            if (!result) return;

            toast("info", "Bild verschoben", `„${label}“ liegt jetzt in „${targetLabel}“.`);
            void load();
        });
    });

    void load();
}
