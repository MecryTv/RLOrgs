/**
 * Prueft den einzigen Weg ins Bildverzeichnis, Store() in GalleryService: den
 * Kollisionsschutz bei gleichzeitigen Uploads und dass ein GIF-Label allein nicht
 * ueber den Durchlass entscheidet - das entscheiden die Bytes.
 *
 *   npm run check:gallery
 *
 * Absichtlich ohne Test-Framework - der Bot hat keins, und ein Durchlauf reicht,
 * um die Regeln aus dem Spec abzusichern.
 *
 * Geschrieben wird unter einer erfundenen Guild-ID, die es bei Discord nicht gibt.
 * GALLERY_ROOT bleibt das echte Verzeichnis - kein chdir, kein umgebogenes
 * GALLERY_ROOT: der Logger haelt eine offene Datei relativ zum Arbeitsverzeichnis,
 * und das brachte beim Aufraeumen unter Windows schon einmal EPERM. Der
 * Fake-Ordner wird deshalb vor dem Lauf und in einem finally wieder entfernt -
 * so kann auch ein abgestuerzter vorheriger Lauf diesen hier nicht vergiften.
 *
 * Seit Task 7 zusaetzlich: Overview() - die Sammel-Logik fuer die Dashboard-
 * Galerie-Uebersicht, aus GalleryService statt aus der Route geprueft. Eigene,
 * zweite Fake-Guild-ID, aus demselben Grund vorher und in einem finally entfernt -
 * die Checks oben fuellen ihren Fake-Ordner bereits mit eigenen Kategorien, die
 * hier nur stoeren wuerden.
 */

import path from "path";
import { readdir, readFile, rm } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import GalleryService from "../services/GalleryService";
import BotClient from "../client/BotClient";
import { IGalleryEntry } from "../interfaces/services/gallery/IGalleryService";
import { GALLERY_ROOT } from "../constants/Gallery";

// Eine Snowflake, die es bei Discord nicht gibt.
const GUILD = "100000000000000001";
const ROOT = path.join(GALLERY_ROOT, GUILD);

// Zweite erfundene Snowflake, nur fuer den Overview()-Abschnitt weiter unten -
// eigener Fake-Ordner statt Wiederverwendung von ROOT, damit die Kategorien von
// oben (bilder, wettlauf, ...) die Overview()-Checks nicht verfaelschen.
const GUILD2 = "100000000000000002";
const ROOT2 = path.join(GALLERY_ROOT, GUILD2);

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

// Ein breites Bild mit Farbverlauf: einfarbige Flaechen komprimiert WebP so
// stark, dass ein Groessenvergleich nichts mehr aussagt.
function Sample(width: number, height: number): Buffer {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, width, height);

    gradient.addColorStop(0, "#ff1e2d");
    gradient.addColorStop(1, "#101418");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    return canvas.toBuffer("image/png");
}

// Das kleinstmoegliche gueltige GIF (1x1, transparent).
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// GalleryService liest von client nur guilds.cache (fuer den Anzeigenamen),
// server.BaseURL (fuer die URL) und developerMode (fuer Attach, hier ungenutzt) -
// eine echte Discord-Verbindung braucht keiner der geprueften Pfade.
function FakeClient(): BotClient {
    return {
        guilds: { cache: new Map() },
        server: { BaseURL: "http://127.0.0.1" },
        developerMode: false,
    } as unknown as BotClient;
}

async function main(): Promise<void> {
    console.log("\n🖼️  Galerie: Store() und der Weg auf die Platte\n");

    // Ein abgestuerzter vorheriger Lauf darf diesen hier nicht vergiften.
    await rm(ROOT, { recursive: true, force: true });
    await rm(ROOT2, { recursive: true, force: true });

    const service = new GalleryService(FakeClient());

    try {
        console.log("\n  — Grosses Bild —");

        const bilder = { guildId: GUILD, category: "bilder" };
        const gross = Sample(3000, 1000);

        const erstes = await service.AddUpload(bilder, gross, "image/png", "foto.png");

        check("Grosses PNG landet als .webp", erstes.file.endsWith(".webp"), erstes.file);

        const ersteBytes = await readFile(path.join(ROOT, "bilder", erstes.file));

        check(
            "Verkleinertes Bild ist kleiner als das Original",
            ersteBytes.length < gross.length,
            `${gross.length} → ${ersteBytes.length}`
        );

        console.log("\n  — Echtes GIF —");

        const gif = await service.AddUpload(bilder, GIF, "image/gif", "anim.gif");

        check("GIF landet als .gif", gif.file.endsWith(".gif"), gif.file);

        const gifBytes = await readFile(path.join(ROOT, "bilder", gif.file));

        check("GIF liegt byteidentisch auf der Platte", gifBytes.equals(GIF));

        console.log("\n  — Zweiter Upload desselben Namens —");

        const zweites = await service.AddUpload(bilder, Sample(300, 200), "image/png", "foto.png");

        check("Zweiter Upload bekommt die -2-Endung", zweites.file === "foto-2.webp", zweites.file);

        const ersteBytesDanach = await readFile(path.join(ROOT, "bilder", erstes.file));

        check("Die erste Datei bleibt unveraendert liegen", ersteBytesDanach.equals(ersteBytes));

        console.log("\n  — Gleichzeitige Uploads (Regressionsschutz gegen die Race) —");

        const CONCURRENCY = 8;
        const wettlauf = { guildId: GUILD, category: "wettlauf" };
        const wettlaufBild = Sample(300, 200);

        let ergebnisse: IGalleryEntry[] = [];
        let wettlaufFehler: string | null = null;

        try {
            ergebnisse = await Promise.all(
                Array.from({ length: CONCURRENCY }, () =>
                    service.AddUpload(wettlauf, wettlaufBild, "image/png", "gleich.png")
                )
            );
        } catch (error) {
            wettlaufFehler = (error as Error).message;
        }

        check(
            `Alle ${CONCURRENCY} gleichzeitigen Uploads loesen auf`,
            wettlaufFehler === null && ergebnisse.length === CONCURRENCY,
            wettlaufFehler ?? `${ergebnisse.length} von ${CONCURRENCY}`
        );

        const namen = ergebnisse.map((entry) => entry.file);

        check("Alle Dateinamen sind verschieden", new Set(namen).size === CONCURRENCY, namen.join(", "));

        const wettlaufDateien = await readdir(path.join(ROOT, "wettlauf")).catch(() => []);

        check(
            `${CONCURRENCY} Dateien liegen tatsaechlich auf der Platte`,
            wettlaufDateien.length === CONCURRENCY,
            `${wettlaufDateien.length}`
        );

        console.log("\n  — Falsches Label 'image/gif' —");

        const echtesBild = await service.AddUpload(
            { guildId: GUILD, category: "label-bild" },
            Sample(300, 200),
            "image/gif",
            "verkleidet.png"
        );

        check(
            "PNG mit Label 'image/gif' landet als .webp, nicht .gif",
            echtesBild.file.endsWith(".webp"),
            echtesBild.file
        );

        const muellFehler = await service
            .AddUpload({ guildId: GUILD, category: "label-muell" }, Buffer.from("kein bild"), "image/gif", "muell.gif")
            .then(
                () => "kein Fehler",
                (error: Error) => error.message
            );

        check(
            "Muell mit Label 'image/gif' wird abgelehnt",
            muellFehler === "Das Bild ließ sich nicht lesen.",
            muellFehler
        );

        const muellDateien = await readdir(path.join(ROOT, "label-muell")).catch(() => []);

        check("Abgelehnter Muell hinterlaesst keine Datei", muellDateien.length === 0, muellDateien.join(", "));

        console.log("\n  — Overview(): Sammel-Logik fuer die Dashboard-Uebersicht —");

        // Eine Kategorie mit Bild, eine leere Kategorie, ein Unterordner mit Bild -
        // genau der Mix, an dem die Sammel-Logik in DashboardApiGallery.Handle
        // (jetzt GalleryService.Overview) beim Planen schon einmal danebenlag.
        await service.CreateCategory({ guildId: GUILD2, category: "leer" });

        const bildA = await service.AddUpload(
            { guildId: GUILD2, category: "mit-bild" },
            Sample(300, 200),
            "image/png",
            "a.png"
        );

        const bildB = await service.AddUpload(
            { guildId: GUILD2, category: "mit-bild", subcategory: "unter" },
            Sample(300, 200),
            "image/png",
            "b.png"
        );

        const overview = await service.Overview(GUILD2);

        check(
            "Leere Kategorie steckt in categories",
            overview.categories.some(
                (entry) =>
                    entry.guildId === GUILD2 && entry.parent === null && entry.name === "leer" && entry.images === 0
            ),
            overview.categories.map((entry) => `${entry.guildId}/${entry.parent ?? ""}/${entry.name}`).join(", ")
        );

        const triples = overview.categories.map((entry) => `${entry.guildId}/${entry.parent ?? ""}/${entry.name}`);

        check(
            "Kein (guildId, parent, name)-Tripel kommt doppelt in categories vor",
            new Set(triples).size === triples.length,
            triples.join(", ")
        );

        // Erwartung von der Platte ableiten statt hartkodieren - was einmal unter
        // src/images/default liegt, soll sich hier nicht von Hand nachpflegen muessen.
        const defaultDirs = (await readdir(path.join(GALLERY_ROOT, "default"), { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);

        const defaultOben = overview.categories.filter((entry) => entry.scope === "default" && entry.parent === null);
        const abweichungen = defaultDirs
            .map((name) => [name, defaultOben.filter((entry) => entry.name === name).length] as const)
            .filter(([, anzahl]) => anzahl !== 1);

        check(
            "Jedes Default-Verzeichnis von der Platte steckt genau einmal in categories",
            abweichungen.length === 0 && defaultOben.length === defaultDirs.length,
            abweichungen.length
                ? abweichungen.map(([name, anzahl]) => `${name}: ${anzahl}x`).join(", ")
                : `${defaultOben.length} statt ${defaultDirs.length} gefunden`
        );

        check(
            "Unterordner steckt mit seiner Kategorie als parent in categories",
            overview.categories.some(
                (entry) => entry.guildId === GUILD2 && entry.name === "unter" && entry.parent === "mit-bild"
            ),
            overview.categories.map((entry) => `${entry.name} (parent=${entry.parent})`).join(", ")
        );

        const bildIds = overview.images.map((entry) => entry.id);

        check(
            "Keine Bild-ID kommt doppelt in images vor",
            new Set(bildIds).size === bildIds.length,
            `${bildIds.length} Eintraege, ${new Set(bildIds).size} eindeutig`
        );

        check(
            "Beide angelegten Bilder stecken in images",
            bildIds.includes(bildA.id) && bildIds.includes(bildB.id),
            bildIds.join(", ")
        );
    } finally {
        await rm(ROOT, { recursive: true, force: true });
        await rm(ROOT2, { recursive: true, force: true });
    }

    console.log(failures === 0 ? "\n✅ Alle Prüfungen bestanden.\n" : `\n❌ ${failures} Prüfung(en) fehlgeschlagen.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: Error) => {
    console.log(`\n❌ Unerwarteter Fehler: ${error.message}\n`);
    process.exit(1);
});
