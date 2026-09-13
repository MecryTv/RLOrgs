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
 *
 * Seit Task 8 zusaetzlich: DashboardApiGalleryEdit selbst, ganz unten in
 * checkWriteRoute() - die Schreib-Route Ende-zu-Ende ueber instance.inject(),
 * mit gefakter Sitzung/Rechtepruefung und echtem GalleryService dahinter.
 * CheckDashboard.ts prueft dieselbe Route nur bis zur Rechtepruefung (401/400/
 * 415/413, ohne echte Discord-Sitzung); was dahinter liegt - dass die sechs
 * Aktionen wirklich etwas tun, dass kein Server an ein fremdes Bild kommt,
 * dass Traversal abgewiesen wird und dass ein interner Fehler keinen
 * Serverpfad verraet - war bis Task 8 ungeprueft. Wieder zwei eigene
 * Fake-Guild-IDs, aus demselben Grund.
 */

import path from "path";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import fastify from "fastify";
import GalleryService from "../services/GalleryService";
import BotClient from "../client/BotClient";
import RouteManager from "../handler/RouteManager";
import DashboardApiGalleryEdit from "../routes/DashboardApiGalleryEdit";
import { IGalleryEntry } from "../interfaces/services/gallery/IGalleryService";
import { GALLERY_ROOT, UPLOAD_TYPES } from "../constants/Gallery";
import { DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";

// Eine Snowflake, die es bei Discord nicht gibt.
const GUILD = "100000000000000001";
const ROOT = path.join(GALLERY_ROOT, GUILD);

// Zweite erfundene Snowflake, nur fuer den Overview()-Abschnitt weiter unten -
// eigener Fake-Ordner statt Wiederverwendung von ROOT, damit die Kategorien von
// oben (bilder, wettlauf, ...) die Overview()-Checks nicht verfaelschen.
const GUILD2 = "100000000000000002";
const ROOT2 = path.join(GALLERY_ROOT, GUILD2);

// Dritte und vierte erfundene Snowflake, nur fuer den Abschnitt "Schreib-Route"
// ganz unten - wieder eigene Fake-Ordner, damit sich keiner der drei Abschnitte
// mit einem anderen in die Quere kommt.
const ROUTE_GUILD = "200000000000000001";
const ROUTE_ROOT = path.join(GALLERY_ROOT, ROUTE_GUILD);
const ROUTE_OTHER_GUILD = "200000000000000002";
const ROUTE_OTHER_ROOT = path.join(GALLERY_ROOT, ROUTE_OTHER_GUILD);

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

async function FileExists(file: string): Promise<boolean> {
    return stat(file)
        .then(() => true)
        .catch(() => false);
}

// Der Cookie-Wert, den der gefakte dashboardService als "eingeloggt" erkennt -
// beliebig, denn Session() unten prueft nur auf Gleichheit, nicht auf ein
// echtes Siegel wie in DashboardService.Sign()/Session().
const ROUTE_SESSION_COOKIE = "gueltig";

// SessionOf() (utils/dashboard.ts) ruft nur Session() auf, DashboardApiGalleryEdit
// selbst nur noch CanManage() - mehr braucht der gefakte Dienst hier nicht.
// Secure liegt nur fuer den (hier nie genommenen) SessionExpired-Zweig bereit.
function FakeDashboardService(canManage: boolean) {
    return {
        Session: (cookie: string | undefined) =>
            cookie === ROUTE_SESSION_COOKIE
                ? {
                      id: "route-check",
                      userId: "1",
                      username: "check",
                      avatar: null,
                      accessToken: "x",
                      mfa: true as const,
                      expiresAt: Date.now() + 60_000,
                  }
                : null,
        CanManage: async () => canManage,
        Secure: false,
    };
}

// Wie FakeClient() oben, nur zusaetzlich mit einem dashboardService und einem
// galleryService - fuer Check 6 (Leck) laesst sich Letzterer durch einen Stub
// ersetzen, der eine Aktion mit einem systemnahen Fehler scheitern laesst.
function FakeRouteClient(dashboardService: unknown, galleryService?: unknown): BotClient {
    const client = {
        guilds: { cache: new Map() },
        server: { BaseURL: "http://127.0.0.1" },
        developerMode: false,
    } as unknown as BotClient;

    const mutable = client as unknown as Record<string, unknown>;
    mutable.dashboardService = dashboardService;
    mutable.galleryService = galleryService ?? new GalleryService(client);

    return client;
}

// Baut Fastify genauso auf wie Server.ts: derselbe Bild-Parser, dieselbe
// RouteManager-Klasse - nur mit genau einer registrierten Route, damit ihr
// bodyLimit ueber IRouteOptions.bodyLimit denselben Weg nimmt wie im echten
// Server statt an einem von Hand gebauten fastify.route() vorbei.
function BuildApp(dashboardService: unknown, galleryService?: unknown) {
    const client = FakeRouteClient(dashboardService, galleryService);
    const instance = fastify({ logger: false });

    instance.addContentTypeParser(UPLOAD_TYPES, { parseAs: "buffer" }, (_request, body, done) => done(null, body));

    const manager = new RouteManager(client);
    manager.Register(new DashboardApiGalleryEdit(client));
    manager.Apply(instance);

    return instance;
}

function GalleryURL(guildId: string, action: string): string {
    return `${DASHBOARD_PATH}/api/guild/${guildId}/gallery/${action}`;
}

function WithCookie(contentType: string): Record<string, string> {
    return { "content-type": contentType, cookie: `${SESSION_COOKIE}=${ROUTE_SESSION_COOKIE}` };
}

/**
 * ============================================================================
 * Schreib-Route: DashboardApiGalleryEdit Ende-zu-Ende, ohne Netz oder Discord
 * ============================================================================
 *
 * CheckDashboard.ts prueft dieselbe Route, kommt aber ohne echte Discord-Sitzung
 * nur bis zur Rechtepruefung (401 ohne Sitzung, 400 fuer unbekannte Aktionen,
 * 415 ohne JSON/Bild, 413 als Gegenprobe zum bodyLimit). Alles dahinter - dass
 * die sechs Aktionen wirklich etwas tun, dass ein Server nicht an ein fremdes
 * Bild kommt, dass Traversal abgewiesen wird und dass ein interner Fehler
 * keinen Serverpfad verraet - hatte bisher keine feste Absicherung. Das holt
 * dieser Abschnitt nach: ein bare fastify(), der Bild-Parser aus Server.ts und
 * eine RouteManager mit genau dieser einen Route, angesprochen ueber
 * instance.inject(). SessionOf()/CanManage() werden gefaked (siehe
 * FakeDashboardService oben), die Galerie-Aktionen selbst laufen ueber den
 * echten GalleryService.
 */
async function checkWriteRoute(): Promise<void> {
    console.log("\n🔐 Schreib-Route: DashboardApiGalleryEdit Ende-zu-Ende\n");

    // Ein abgestuerzter vorheriger Lauf darf diesen hier nicht vergiften.
    await rm(ROUTE_ROOT, { recursive: true, force: true });
    await rm(ROUTE_OTHER_ROOT, { recursive: true, force: true });

    try {
        console.log("\n  — Erlaubt: anlegen, hochladen, loeschen —");

        {
            const instance = BuildApp(FakeDashboardService(true));

            const created = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "category"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ category: "neu" }),
            });

            check(
                "Kategorie anlegen antwortet 200",
                created.statusCode === 200,
                `${created.statusCode} ${created.body}`
            );

            const uploaded = await instance.inject({
                method: "POST",
                url: `${GalleryURL(ROUTE_GUILD, "image")}?category=neu&name=upload`,
                headers: WithCookie("image/png"),
                payload: Sample(300, 200),
            });

            check(
                "Bild-Upload antwortet 200",
                uploaded.statusCode === 200,
                `${uploaded.statusCode} ${uploaded.body}`
            );

            const hochgeladen =
                uploaded.statusCode === 200 ? (uploaded.json() as { image: IGalleryEntry }).image : null;

            check(
                "Hochgeladenes Bild landet als .webp auf der Platte",
                hochgeladen !== null &&
                    hochgeladen.file.endsWith(".webp") &&
                    (await FileExists(path.join(ROUTE_ROOT, "neu", hochgeladen.file))),
                JSON.stringify(hochgeladen)
            );

            const deleted = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "image/delete"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ image: hochgeladen?.id }),
            });

            check(
                "Bild-Loeschen antwortet 200",
                deleted.statusCode === 200,
                `${deleted.statusCode} ${deleted.body}`
            );

            check(
                "Geloeschtes Bild liegt nicht mehr auf der Platte",
                hochgeladen !== null && !(await FileExists(path.join(ROUTE_ROOT, "neu", hochgeladen.file)))
            );

            await instance.close();
        }

        console.log("\n  — Verboten: CanManage antwortet false —");

        {
            const instance = BuildApp(FakeDashboardService(false));

            const response = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "category"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ category: "verboten" }),
            });

            check(
                "Ohne Verwaltungsrecht kommt 403",
                response.statusCode === 403,
                `${response.statusCode} ${response.body}`
            );

            check(
                "Ohne Verwaltungsrecht wird nichts angelegt",
                !(await FileExists(path.join(ROUTE_ROOT, "verboten")))
            );

            await instance.close();
        }

        console.log("\n  — Fremder Server: Bild-ID aus einer anderen Guild —");

        {
            // Direkt ueber den echten Dienst angelegt, nicht ueber die Route - das
            // Bild soll schon existieren, bevor der fragliche Aufruf ueberhaupt
            // startet.
            const seed = new GalleryService(FakeClient());
            const fremdesBild = await seed.AddUpload(
                { guildId: ROUTE_OTHER_GUILD, category: "fremd" },
                Sample(300, 200),
                "image/png",
                "fremd"
            );

            const instance = BuildApp(FakeDashboardService(true));

            const moved = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "image/move"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ image: fremdesBild.id, category: "neu" }),
            });

            check(
                "Verschieben eines fremden Bildes ist 400",
                moved.statusCode === 400,
                `${moved.statusCode} ${moved.body}`
            );

            const geloescht = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "image/delete"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ image: fremdesBild.id }),
            });

            check(
                "Loeschen eines fremden Bildes ist 400",
                geloescht.statusCode === 400,
                `${geloescht.statusCode} ${geloescht.body}`
            );

            check(
                "Das fremde Bild liegt weiterhin auf der Platte",
                await FileExists(path.join(ROUTE_OTHER_ROOT, "fremd", fremdesBild.file))
            );

            await instance.close();
        }

        console.log("\n  — Traversal: '..' in der Bild-ID —");

        {
            const seed = new GalleryService(FakeClient());
            const echtesBild = await seed.AddUpload(
                { guildId: ROUTE_GUILD, category: "echt" },
                Sample(300, 200),
                "image/png",
                "echt"
            );

            const instance = BuildApp(FakeDashboardService(true));

            // Faengt mit ".." an: das allein reicht, damit die ID nicht mehr mit
            // "${guildId}/" beginnt - derselbe Schutz wie beim fremden Server oben,
            // hier an einer ID erprobt, die einen echten Guild-Namen und Dateinamen
            // im Text traegt, um zu zeigen, wonach die Pruefung wirklich schaut.
            const traversal = `../${ROUTE_GUILD}/echt/${echtesBild.file}`;

            const response = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "image/delete"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ image: traversal }),
            });

            check(
                "Bild-ID mit '..' wird abgewiesen (400)",
                response.statusCode === 400,
                `${response.statusCode} ${response.body}`
            );

            check(
                "Das Bild liegt weiterhin auf der Platte",
                await FileExists(path.join(ROUTE_ROOT, "echt", echtesBild.file))
            );

            await instance.close();
        }

        console.log("\n  — Nur https: image/url mit http:// —");

        {
            const instance = BuildApp(FakeDashboardService(true));

            const response = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "image/url"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ url: "http://example.com/bild.png", category: "neu" }),
            });

            check(
                "http:// wird abgewiesen (400)",
                response.statusCode === 400,
                `${response.statusCode} ${response.body}`
            );

            check(
                "Fehlertext stammt vom Dienst (ParseSource)",
                (response.json() as { error?: string }).error === "Nur https-URLs werden akzeptiert.",
                response.body
            );

            await instance.close();
        }

        console.log("\n  — Kein Leck: interner Fehler mit code und Serverpfad —");

        {
            const geheimerPfad = "C:\\Users\\check\\geheim\\datenbank.sqlite";
            const systemFehler = Object.assign(new Error(`EACCES: permission denied, open '${geheimerPfad}'`), {
                code: "EACCES",
            });

            // Ein Stub statt des echten Dienstes: der Fehler soll deterministisch
            // kommen, nicht von einer echten, nur unter bestimmten Rechten
            // scheiternden Schreiboperation abhaengen.
            const stubGallery = {
                CreateCategory: async () => {
                    throw systemFehler;
                },
            };

            const instance = BuildApp(FakeDashboardService(true), stubGallery);

            const response = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "category"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ category: "leck" }),
            });

            check(
                "Interner Fehler kommt als 500 an",
                response.statusCode === 500,
                `${response.statusCode} ${response.body}`
            );

            // Ueber das geparste Feld statt den rohen Body-Text: JSON entschaerft
            // Rueckstriche im Pfad zu "\\\\", ein Vergleich am rohen Text faende den
            // Pfad deshalb nie, selbst wenn er drinsteckt.
            const geleckt = (response.json() as { error?: string }).error ?? "";

            check("Der Serverpfad steht nicht in der Antwort", !geleckt.includes(geheimerPfad), geleckt);

            await instance.close();
        }
    } finally {
        await rm(ROUTE_ROOT, { recursive: true, force: true });
        await rm(ROUTE_OTHER_ROOT, { recursive: true, force: true });
    }
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

    await checkWriteRoute();

    console.log(failures === 0 ? "\n✅ Alle Prüfungen bestanden.\n" : `\n❌ ${failures} Prüfung(en) fehlgeschlagen.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: Error) => {
    console.log(`\n❌ Unerwarteter Fehler: ${error.message}\n`);
    process.exit(1);
});
