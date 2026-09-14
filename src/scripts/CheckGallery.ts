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
 *
 * Seit dem SSRF-Fix zusaetzlich, ganz am Ende: checkDownloadGuard() - dass
 * AddImage nicht ins interne Netz verbindet, auch nicht ueber einen DNS-Namen
 * oder eine Weiterleitung. Ohne Netz: DNS wird dort, wo es noetig ist,
 * nachgestellt.
 */

import path from "path";
import dns, { LookupAddress, LookupOptions } from "node:dns";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import axios, { InternalAxiosRequestConfig } from "axios";
import fastify from "fastify";
import GalleryService from "../services/GalleryService";
import BotClient from "../client/BotClient";
import RouteManager from "../handler/RouteManager";
import DashboardApiGalleryEdit from "../routes/DashboardApiGalleryEdit";
import { IGalleryEntry } from "../interfaces/services/gallery/IGalleryService";
import {
    CheckRedirect,
    GALLERY_ROOT,
    IsInternalAddress,
    LookupPublic,
    SanitizeName,
    UPLOAD_TYPES,
} from "../constants/Gallery";
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

        // Finding 1 (Task-9-Review): CreateCategory/MoveImage/DeleteImage gaben
        // false zurueck, ohne zu werfen - die Route antwortete trotzdem 200
        // ({ok:true, created:false}), und keine der Seiten liest das Feld. Ab
        // jetzt wirft Run() bei false selbst, mit einem deutschen Text; der
        // bestehende catch in Handle() (oben, "error instanceof Error && !("code"
        // in error)") macht daraus 400 - kein zweiter Fehlerpfad noetig.
        console.log("\n  — Ehrlich bei false: Dublette, fehlendes Hauptalbum, verschwundene Bilder —");

        {
            const instance = BuildApp(FakeDashboardService(true));

            const ersteAnlage = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "category"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ category: "dublette" }),
            });

            check(
                "Erstes Anlegen von 'dublette' antwortet 200",
                ersteAnlage.statusCode === 200,
                `${ersteAnlage.statusCode} ${ersteAnlage.body}`
            );

            const zweiteAnlage = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "category"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ category: "dublette" }),
            });

            check(
                "Zweites Anlegen desselben Albums ist jetzt 400 statt 200",
                zweiteAnlage.statusCode === 400,
                `${zweiteAnlage.statusCode} ${zweiteAnlage.body}`
            );
            check(
                "  mit der deutschen Dubletten-Meldung",
                (zweiteAnlage.json() as { error?: string }).error === "Ein Album mit diesem Namen gibt es schon.",
                zweiteAnlage.body
            );

            const ohneHauptalbum = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "category"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ category: "kein-hauptalbum-hier", subcategory: "unter" }),
            });

            check(
                "Unteralbum unter einem nicht existierenden Hauptalbum ist 400",
                ohneHauptalbum.statusCode === 400,
                `${ohneHauptalbum.statusCode} ${ohneHauptalbum.body}`
            );
            check(
                "  mit der deutschen Meldung fuers fehlende Hauptalbum",
                (ohneHauptalbum.json() as { error?: string }).error ===
                    "Das Hauptalbum gibt es nicht, oder es gibt darin schon ein Unteralbum mit diesem Namen.",
                ohneHauptalbum.body
            );

            // Ein erfolgreiches Anlegen muss die gespeicherten Namen zurueckgeben,
            // nicht die Rohtexteingabe - gegen die echte SanitizeName geprueft
            // (Finding 3), nicht gegen einen von Hand hingeschriebenen String.
            const grossHauptalbum = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "category"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ category: "Team A" }),
            });

            check(
                "Anlegen mit Grossbuchstaben/Leerzeichen antwortet 200",
                grossHauptalbum.statusCode === 200,
                `${grossHauptalbum.statusCode} ${grossHauptalbum.body}`
            );

            const hauptalbumKoerper =
                grossHauptalbum.statusCode === 200
                    ? (grossHauptalbum.json() as { category?: string; subcategory?: string | null })
                    : null;

            check(
                `Die Antwort traegt den echten SanitizeName("Team A") = "${SanitizeName("Team A")}"`,
                hauptalbumKoerper?.category === SanitizeName("Team A") && hauptalbumKoerper.category === "teama",
                JSON.stringify(hauptalbumKoerper)
            );
            check(
                "  subcategory ist null, ohne Unteralbum",
                hauptalbumKoerper?.subcategory === null,
                JSON.stringify(hauptalbumKoerper)
            );

            const grossUnteralbum = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "category"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ category: "teama", subcategory: "Unter Album" }),
            });

            check(
                "Unteralbum darunter antwortet ebenfalls 200",
                grossUnteralbum.statusCode === 200,
                `${grossUnteralbum.statusCode} ${grossUnteralbum.body}`
            );

            const unteralbumKoerper =
                grossUnteralbum.statusCode === 200
                    ? (grossUnteralbum.json() as { category?: string; subcategory?: string | null })
                    : null;

            check(
                `  und die gespeicherten Namen fuer beide Ebenen (SanitizeName("Unter Album") = "${SanitizeName("Unter Album")}")`,
                unteralbumKoerper?.category === "teama" &&
                    unteralbumKoerper.subcategory === SanitizeName("Unter Album"),
                JSON.stringify(unteralbumKoerper)
            );

            // Ein Bild, dessen ID gueltig aussieht, das aber nie auf der Platte lag.
            // Ziel bewusst ein anderes Album als das in der ID selbst ("teama" statt
            // "dublette"): MoveImage gibt bei gleichem Ziel (from === to) frueh true
            // zurueck, ohne je Exists() zu pruefen - das waere sonst ein falscher
            // Treffer, der nichts ueber den zu pruefenden Zweig aussagt.
            const geisterbild = `${ROUTE_GUILD}/dublette/geist-${Date.now()}.webp`;

            const verschieben = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "image/move"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ image: geisterbild, category: "teama" }),
            });

            check(
                "Verschieben eines nie vorhandenen Bildes ist 400 statt 200",
                verschieben.statusCode === 400,
                `${verschieben.statusCode} ${verschieben.body}`
            );
            check(
                "  mit der deutschen 'gibt es nicht mehr'-Meldung",
                (verschieben.json() as { error?: string }).error === "Dieses Bild gibt es nicht mehr.",
                verschieben.body
            );

            const loeschen = await instance.inject({
                method: "POST",
                url: GalleryURL(ROUTE_GUILD, "image/delete"),
                headers: WithCookie("application/json"),
                payload: JSON.stringify({ image: geisterbild }),
            });

            check(
                "Loeschen eines nie vorhandenen Bildes ist 400 statt 200",
                loeschen.statusCode === 400,
                `${loeschen.statusCode} ${loeschen.body}`
            );
            check(
                "  mit derselben Meldung",
                (loeschen.json() as { error?: string }).error === "Dieses Bild gibt es nicht mehr.",
                loeschen.body
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

// LookupPublic als Promise, in beiden Formen, in denen Node ihn aufruft.
function Lookup(hostname: string, all: boolean): Promise<{ error: Error | null; address: string | LookupAddress[] }> {
    return new Promise((resolve) => LookupPublic(hostname, { all }, (error, address) => resolve({ error, address })));
}

// CheckRedirect mit den Feldern, die follow-redirects vor jedem Sprung setzt.
// Liefert den Fehlertext, oder null, wenn der Sprung durchgeht.
function RedirectError(href: string): string | null {
    const url = new URL(href);
    const hop = { protocol: url.protocol, hostname: url.hostname, href: url.href };

    try {
        CheckRedirect(hop);
        return null;
    } catch (error) {
        return (error as Error).message;
    }
}

/**
 * ============================================================================
 * Download-Schutz: AddImage verbindet nicht ins interne Netz (SSRF)
 * ============================================================================
 *
 * ParseSource prueft vorab nur den eingetippten Namen. Ein oeffentlicher Name,
 * dessen DNS auf 127.0.0.1 zeigt, und eine Weiterleitung auf eine interne Adresse
 * kamen daran vorbei - die Sperre sitzt deshalb jetzt beim Verbinden (LookupPublic
 * im https.Agent, CheckRedirect vor jedem Sprung; Begruendung in
 * constants/Gallery.ts). Geprueft wird ohne Netz: die Adress-Regel direkt, der
 * lookup mit "localhost" und mit einer gemischten Adressliste (oeffentlich vor
 * intern - das entlarvt eine Pruefung, die nur addresses[0] oder .every() statt
 * .some() anschaut), die Weiterleitung mit von Hand gebauten Sprung-Optionen,
 * dass AddImage diese Sperren ueberhaupt in seine axios-Konfiguration einsetzt
 * (per Interceptor abgefangen, bevor je ein Adapter laeuft) - und einmal der
 * ganze Weg durch AddImage und die Route, mit nachgestellter DNS-Antwort. Auf
 * die Platte kommt dabei nichts: jeder Download hier scheitert.
 */
async function checkDownloadGuard(): Promise<void> {
    console.log("\n🛡️  Download-Schutz: kein Weg ins interne Netz\n");

    console.log("\n  — Adress-Regel —");

    const intern = [
        "127.0.0.1",
        "10.1.2.3",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0", // "dieses Netz" - erreicht die eigene Maschine, siehe Gallery.ts
        "172.16.0.1",
        "192.168.1.1",
        "::1",
        "::ffff:127.0.0.1",
        "fd00::1",
        "fe80::1",
        "::",
        "::127.0.0.1", // veraltet IPv4-kompatibel - ["::", 96] in constants/Gallery.ts
    ];

    for (const address of intern) {
        check(`${address} gilt als intern`, IsInternalAddress(address), "wird als oeffentlich durchgelassen");
    }

    // 172.32.0.1 liegt direkt hinter 172.16.0.0/12 - zusammen mit 172.16.0.1 oben
    // ist damit die Grenze dieses Bereichs von beiden Seiten abgesteckt.
    for (const address of ["93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
        check(`${address} gilt als oeffentlich`, !IsInternalAddress(address), "wird als intern gesperrt");
    }

    console.log("\n  — lookup beim Verbinden —");

    // "localhost" direkt an den lookup, an ParseSource vorbei - so, wie ein
    // oeffentlicher Name ankaeme, dessen DNS gerade auf 127.0.0.1 zeigt.
    for (const all of [false, true]) {
        const { error, address } = await Lookup("localhost", all);

        check(
            `lookup fuer localhost endet mit Fehler (all: ${all})`,
            error?.message === "Diese Adresse liegt im internen Netz.",
            error ? error.message : `kein Fehler, Adresse ${JSON.stringify(address)}`
        );
    }

    // Gegenprobe, ebenfalls ohne Netz - eine IP beantwortet dns.lookup selbst. Node
    // braucht die Antwort in genau der Form zurueck, in der es gefragt hat.
    const einzeln = await Lookup("93.184.216.34", false);
    const alle = await Lookup("93.184.216.34", true);

    check(
        "Oeffentliche Adresse kommt in beiden Formen unveraendert durch",
        einzeln.error === null &&
            einzeln.address === "93.184.216.34" &&
            alle.error === null &&
            Array.isArray(alle.address) &&
            alle.address.length === 1 &&
            alle.address[0].address === "93.184.216.34",
        JSON.stringify({ einzeln: [einzeln.error?.message, einzeln.address], alle: [alle.error?.message, alle.address] })
    );

    // Der all:true-Fall oben loest mit "localhost" auf, wo jede Adresse intern ist -
    // das besteht auch eine Pruefung, die nur addresses[0] anschaut, oder eine mit
    // .every() statt .some(). Ein eigener, eng auf einen erfundenen Namen begrenzter
    // Stub (unten in einem eigenen finally wieder entfernt, unabhaengig vom Stub
    // fuer "rebind.invalid" weiter unten in "Der ganze Weg") antwortet stattdessen
    // mit einer gemischten Liste.
    const MIXED_HOST = "mixed.invalid";
    const originalMixedLookup = dns.lookup;

    Object.assign(dns, {
        lookup: (hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
            if (hostname !== MIXED_HOST) return originalMixedLookup(hostname, options, callback as never);

            // Oeffentlich zuerst, intern an zweiter Stelle: das entlarvt sowohl eine
            // Pruefung, die nur addresses[0] anschaut (saehe nur die oeffentliche
            // erste Adresse), als auch eine mit .every() statt .some() (saehe keine
            // durchgehend interne Liste) - LookupPublic muss mit all: true trotzdem
            // ablehnen, siehe die Begruendung dort.
            const addresses = [
                { address: "93.184.216.34", family: 4 },
                { address: "127.0.0.1", family: 4 },
            ];

            process.nextTick(() =>
                options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)
            );
        },
    });

    try {
        const gemischt = await Lookup(MIXED_HOST, true);

        check(
            "lookup mit gemischter Adressliste (oeffentlich vor intern) schlaegt bei all: true fehl",
            gemischt.error?.message === "Diese Adresse liegt im internen Netz.",
            gemischt.error ? gemischt.error.message : `kein Fehler, Adresse ${JSON.stringify(gemischt.address)}`
        );
    } finally {
        Object.assign(dns, { lookup: originalMixedLookup });
    }

    console.log("\n  — Weiterleitungen —");

    const nachHttp = RedirectError("http://example.com/bild.png");

    check(
        "Weiterleitung auf http: wird abgewiesen",
        nachHttp === "Nur https-URLs werden akzeptiert.",
        nachHttp ?? "geht durch"
    );

    const nachHttps = RedirectError("https://example.com/bild.png");

    check("Weiterleitung auf https: geht durch", nachHttps === null, nachHttps ?? "");

    // Eine nackte IP fragt kein DNS, Node verbindet ohne lookup - hier bleibt nur
    // CheckRedirect. Die URL macht aus der Schreibweise ausserdem [::ffff:7f00:1].
    const nachIp = RedirectError("https://[::ffff:127.0.0.1]/bild.png");

    check(
        "Weiterleitung auf eine interne IP ohne DNS wird abgewiesen",
        nachIp === "Diese Adresse liegt im internen Netz.",
        nachIp ?? "geht durch"
    );

    console.log("\n  — Verdrahtung: die Sperren stecken wirklich im axios-Request —");

    // Alles oben prueft die Bausteine fuer sich. Hier geht es nur darum, ob
    // AddImage sie tatsaechlich einsetzt - ein geloeschtes beforeRedirect oder
    // proxy: false faellt sonst nirgends auf, haelt check:gallery aber gruen und
    // reisst die Sperre wieder auf. Ein Request-Interceptor auf axios'
    // Standardinstanz (GalleryService.ts importiert dieselbe: "import axios from
    // axios", ein einziges axios im node_modules-Baum) zeichnet die Konfiguration
    // auf, die AddImage baut, und wirft danach selbst - so laeuft nie ein Adapter,
    // es geht nichts ins Netz, und Store() wird nie erreicht. Der Fehler wird
    // unten aufgefangen, der Interceptor in einem finally wieder entfernt, sonst
    // finge er auch die Downloads der anderen Abschnitte ab.
    // Ein Objekt statt einer blossen Variable: die Zuweisung passiert im
    // Interceptor, gelesen wird erst danach - ueber eine Objekteigenschaft bleibt
    // der Typ dabei InternalAxiosRequestConfig | null statt sich auf den Stand vor
    // dem Interceptor-Aufruf zu versteifen.
    const aufgezeichnet: { config: InternalAxiosRequestConfig | null } = { config: null };
    const abbruch = new Error("Nur die Konfiguration wird geprueft, kein echter Download.");

    const interceptorId = axios.interceptors.request.use((config) => {
        aufgezeichnet.config = config;
        throw abbruch;
    });

    try {
        await new GalleryService(FakeClient())
            .AddImage({ guildId: ROUTE_GUILD, category: "wiring" }, "https://config-check.example/bild.png")
            .then(
                () => null,
                (error: unknown) => error
            );

        const konfiguration = aufgezeichnet.config;

        check(
            "AddImage setzt beforeRedirect auf CheckRedirect",
            konfiguration?.beforeRedirect === CheckRedirect,
            "beforeRedirect fehlt oder zeigt auf einen anderen Handler"
        );

        check(
            "AddImage setzt proxy fest auf false",
            konfiguration?.proxy === false,
            `proxy ist ${JSON.stringify(konfiguration?.proxy)} statt false`
        );

        check(
            "AddImage erzwingt den http-Adapter",
            konfiguration?.adapter === "http",
            `adapter ist ${JSON.stringify(konfiguration?.adapter)} statt "http"`
        );

        check(
            "Der httpsAgent im Request traegt LookupPublic als lookup",
            konfiguration?.httpsAgent?.options?.lookup === LookupPublic,
            "httpsAgent fehlt, oder sein lookup ist nicht LookupPublic"
        );
    } finally {
        axios.interceptors.request.eject(interceptorId);
    }

    console.log("\n  — Der ganze Weg: AddImage und die Route —");

    // DNS-Rebinding offline nachgestellt: dns.lookup antwortet fuer diesen
    // erfundenen Namen mit 127.0.0.1. ParseSource laesst ihn durch, er sieht
    // oeffentlich aus - aufhalten muss ihn der lookup im Agent von AddImage, der
    // dns.lookup erst beim Aufruf nachschlaegt. Fehlt dieser Agent, verbindet Node
    // zu 127.0.0.1:1, und der Fehler heisst ECONNREFUSED statt der Sperre.
    const rebind = "https://rebind.invalid:1/bild.png";
    const original = dns.lookup;

    Object.assign(dns, {
        lookup: (hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
            if (hostname !== "rebind.invalid") return original(hostname, options, callback as never);

            process.nextTick(() =>
                options.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4)
            );
        },
    });

    try {
        const fehler = await new GalleryService(FakeClient())
            .AddImage({ guildId: ROUTE_GUILD, category: "rebind" }, rebind)
            .then(
                () => null,
                (error: unknown) => error
            );

        check(
            "AddImage bricht beim Verbinden ab, als axios-Fehler mit der Sperre als Text",
            axios.isAxiosError(fehler) && fehler.message === "Diese Adresse liegt im internen Netz.",
            fehler instanceof Error ? fehler.message : "kein Fehler"
        );

        const instance = BuildApp(FakeDashboardService(true));

        const response = await instance.inject({
            method: "POST",
            url: GalleryURL(ROUTE_GUILD, "image/url"),
            headers: WithCookie("application/json"),
            payload: JSON.stringify({ url: rebind, category: "rebind" }),
        });

        check(
            "Die Route antwortet darauf 400 mit festem Text, nicht 500",
            response.statusCode === 400 &&
                (response.json() as { error?: string }).error === "Das Bild ließ sich von dieser Adresse nicht laden.",
            `${response.statusCode} ${response.body}`
        );

        await instance.close();
    } finally {
        Object.assign(dns, { lookup: original });
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
    await checkDownloadGuard();

    console.log(failures === 0 ? "\n✅ Alle Prüfungen bestanden.\n" : `\n❌ ${failures} Prüfung(en) fehlgeschlagen.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: Error) => {
    console.log(`\n❌ Unerwarteter Fehler: ${error.message}\n`);
    process.exit(1);
});
