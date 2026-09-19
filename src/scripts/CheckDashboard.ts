/**
 * Prüft die Dashboard-Routen ohne Discord-Login: startet nur den Fastify-Server,
 * klopft jede Route ab und beendet sich mit Exit-Code 1, sobald etwas nicht stimmt.
 *
 *   npm run check:dashboard
 *
 * Absichtlich ohne Test-Framework - der Bot hat keins, und ein Durchlauf reicht,
 * um Login-Weiche, Pfadschutz und State-Prüfung abzusichern.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import path from "path";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import BotClient from "../client/BotClient";
import { SNOWFLAKE } from "../constants/Discord";
import { MAX_IMAGE_BYTES } from "../constants/Gallery";
import { PLACEHOLDER_KEYS } from "../constants/Placeholders";
import { MODULE_IDS } from "../constants/Modules";
import { DASHBOARD_HOME, DASHBOARD_PATH, DISCORD_EPOCH, OAUTH_SCOPES, SESSION_COOKIE } from "../constants/Dashboard";
import IDashboardSession from "../interfaces/services/dashboard/IDashboardSession";
import DashboardService, { MfaRequired } from "../services/DashboardService";
import { Open, Seal } from "../utils/seal";

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Der Pfad, unter dem das Dashboard haengt.
 *
 * Der Check startet den Server im eigenen Prozess und nimmt damit denselben
 * Pfad wie er: ohne Schalter die Wurzel (so laeuft es auf
 * dashboard.nexus-emb.de), mit "--dev" das Praefix /dashboard. Beides ist
 * pruefenswert, deshalb steht hier eine Variable und keine feste Zeichenkette.
 *
 *   npm run check:dashboard
 *   npm run check:dashboard -- --dev
 */
const P = DASHBOARD_PATH;
const HOME = DASHBOARD_HOME;
const MANUAL = { redirect: "manual" as const };

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

/**
 * Schickt eine originalgetreue Antwort von /users/@me/guilds?with_counts=true durch
 * den produktiven Mapping-Code. Das sind keine Anzeigedaten, sondern die Form, die
 * Discord wirklich liefert - geprüft wird, was DashboardService daraus macht:
 * Rechte-Bits, Erstelldatum aus der Snowflake, Mitgliederzahl und die Filterung.
 */
async function checkMapping(client: BotClient): Promise<void> {
    console.log("\n  — Abbildung der Discord-Antwort —");

    const made = Date.UTC(2021, 2, 15, 12, 0, 0);
    const snowflake = ((BigInt(made) - BigInt(DISCORD_EPOCH)) << 22n).toString();

    // permissions kommt bei Discord immer als Dezimal-String.
    const response = [
        { id: snowflake, name: "Owner Server", icon: "a_abc123", owner: true, permissions: "1071698660929", approximate_member_count: 18420 },
        { id: "934857203948572034", name: "Admin Server", icon: "def456", owner: false, permissions: "8", approximate_member_count: 9310 },
        { id: "712394857203948573", name: "Manage Server", icon: null, owner: false, permissions: "32", approximate_member_count: 120 },
        { id: "645738291047562930", name: "Nur Mitglied", icon: null, owner: false, permissions: "3072", approximate_member_count: 5 },
    ];

    // So sieht die Antwort von /users/@me/guilds/{id}/member aus (Scope guilds.members.read).
    const member = { nick: "Mecry", joined_at: "2022-06-01T10:15:00.000000+00:00", roles: ["1", "2", "3"] };

    const original = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (body: unknown) =>
            new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

        if (url.includes("/member")) return json(member);
        if (url.includes("/users/@me/guilds")) return json(response);

        return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const session: IDashboardSession = {
        id: "check-session",
        userId: "1059621019947634739",
        username: "Check",
        avatar: null,
        accessToken: "check-token",
        mfa: true,
        expiresAt: Date.now() + 60_000,
    };

    let payload;
    let detail;
    let fremd;

    try {
        payload = await client.dashboardService.Payload(session);
        detail = await client.dashboardService.Detail(session, snowflake);
        fremd = await client.dashboardService.Detail(session, "645738291047562930");
    } finally {
        globalThis.fetch = original;
    }

    if (!payload) {
        check("Payload wurde gebaut", false, "null");
        return;
    }

    const cards = payload.guilds;
    const owner = cards.find((guild) => guild.name === "Owner Server");

    check("Server ohne Rechte fliegt raus", cards.length === 3 && !cards.some((g) => g.name === "Nur Mitglied"), `${cards.length} Karten: ${cards.map((g) => g.name).join(", ")}`);
    check("Owner wird als Owner erkannt", owner?.role === "Owner", String(owner?.role));
    check("ADMINISTRATOR zählt als Admin", cards.find((g) => g.name === "Admin Server")?.role === "Admin");
    check("MANAGE_GUILD zählt als Admin", cards.find((g) => g.name === "Manage Server")?.role === "Admin");
    check("Alle gelisteten dürfen bearbeiten", cards.every((guild) => guild.canManage));
    check("Mitgliederzahl kommt aus der Antwort", owner?.members === 18420, String(owner?.members));
    check("Erstelldatum stammt aus der Snowflake", owner?.created === new Date(made).toISOString(), String(owner?.created));
    check("Animiertes Icon wird als .gif verlinkt", owner?.icon?.includes("/a_abc123.gif") === true, String(owner?.icon));
    check("Statisches Icon wird als .png verlinkt", cards.find((g) => g.name === "Admin Server")?.icon?.includes("/def456.png") === true);
    check("Server ohne Icon hat kein Bild", cards.find((g) => g.name === "Manage Server")?.icon === null);
    check("Initialen werden gebildet", owner?.tag === "OS", String(owner?.tag));
    check("Ohne Bot ist kein Server aktiv", cards.every((guild) => !guild.active));
    // Ohne Mitgliederliste darf keine Aufteilung in Menschen und Bots entstehen.
    check("Ohne Mitgliederliste bleibt die Bot-Zahl leer", cards.every((guild) => guild.bots === null));
    check("Teams und Module bleiben leer", cards.every((guild) => guild.teams === 0 && guild.modules.length === 0));
    check("Nach Mitgliedern sortiert", cards[0].members >= cards[1].members && cards[1].members >= cards[2].members, cards.map((g) => g.members).join(" > "));

    console.log("\n  — Detailseite (guilds.members.read) —");

    check("Detail liefert den Server", detail?.guild.name === "Owner Server", String(detail?.guild.name));
    check("Nickname kommt aus dem Member-Objekt", detail?.member?.nick === "Mecry", String(detail?.member?.nick));
    check("Beitrittsdatum wird übernommen", detail?.member?.joinedAt?.startsWith("2022-06-01") === true, String(detail?.member?.joinedAt));
    check("Rollen werden gezählt", detail?.member?.roles === 3, String(detail?.member?.roles));
    check("Ohne Bot gibt es keine Serverzahlen", detail?.server === null, JSON.stringify(detail?.server));
    check("Fremder Server bleibt verborgen", fremd === null, JSON.stringify(fremd));
}

/**
 * Eine Seite fragt mehrere Routen auf einmal ab, und jede braucht die Serverliste.
 * Discord antwortet auf den zweiten gleichzeitigen Abruf mit 429 - also teilen sich
 * alle einen Abruf, und nach einem 429 wartet der Bot die genannte Zeit ab.
 */
async function checkRateLimit(client: BotClient): Promise<void> {
    console.log("\n  — Serverliste: ein Abruf für alle, 429 abwarten —");

    const original = globalThis.fetch;
    let calls = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);

        if (!url.includes("/users/@me/guilds")) return new Response("{}", { status: 404 });

        calls++;

        // Der erste Abruf läuft in die Bremse, der zweite klappt.
        if (calls === 1) return new Response(JSON.stringify({ message: "You are being rate limited.", retry_after: 0.05, global: false }), { status: 429 });

        return new Response(JSON.stringify([{ id: "934857203948572034", name: "Admin Server", icon: null, owner: true, permissions: "8" }]), {
            headers: { "Content-Type": "application/json" },
        });
    }) as typeof fetch;

    const session: IDashboardSession = {
        id: "check-session-rate",
        userId: "1059621019947634739",
        username: "Check",
        avatar: null,
        accessToken: "check-token",
        mfa: true,
        expiresAt: Date.now() + 60_000,
    };

    try {
        const pages = await Promise.all(Array.from({ length: 5 }, () => client.dashboardService.Payload(session)));

        check("Fünf gleichzeitige Anfragen, alle mit Serverliste", pages.every((page) => page.guilds.length === 1), pages.map((page) => page.guilds.length).join(","));
        check("Discord wurde nur einmal gefragt - plus einmal nach dem 429", calls === 2, `${calls} Abrufe`);
    } catch (error) {
        check("Nach einem kurzen 429 klappt es beim zweiten Versuch", false, String(error));
    } finally {
        globalThis.fetch = original;
    }
}

/**
 * Gruppen kommen jetzt aus der Datenbank - hier laeuft der Check ohne sie. Was
 * ohne Datenbank uebrig bleibt, muss trotzdem stimmen: Developer aus DEV_USER_IDs
 * und sonst Testphase. Die Gruppen mit Datenbank prueft npm run check:db.
 */
async function checkGroups(client: BotClient): Promise<void> {
    console.log("\n  — Gruppen ohne Datenbank —");

    const service = client.dashboardService;
    const saved = client.config.DEV_USER_IDs;

    client.config.DEV_USER_IDs = ["2"];

    try {
        check("Developer kommt aus DEV_USER_IDs", (await service.GroupOf("2")) === "developer");
        check("Unbekannte ID landet in der Testphase", (await service.GroupOf("999")) === "testphase");
        check("Ohne Datenbank ist nur der Developer Staff", (await service.IsStaff("2")) && !(await service.IsStaff("999")));
    } finally {
        client.config.DEV_USER_IDs = saved;
    }
}

/**
 * Ein falsch geschriebener Scope fällt sonst nirgends auf: der Bot baut die URL
 * klaglos, und erst Discord antwortet dem Nutzer mit "Invalid scope". Genau so ist
 * "guilds.member.read" statt "guilds.members.read" durchgerutscht.
 */
const DISCORD_SCOPES = new Set([
    "activities.read",
    "activities.write",
    "applications.builds.read",
    "applications.builds.upload",
    "applications.commands",
    "applications.commands.permissions.update",
    "applications.commands.update",
    "applications.entitlements",
    "applications.store.update",
    "bot",
    "connections",
    "dm_channels.read",
    "email",
    "gdm.join",
    "guilds",
    "guilds.join",
    "guilds.members.read",
    "identify",
    "messages.read",
    "relationships.read",
    "role_connections.write",
    "rpc",
    "rpc.activities.write",
    "rpc.notifications.read",
    "rpc.voice.read",
    "rpc.voice.write",
    "voice",
    "webhook.incoming",
]);

function checkScopes(): void {
    const unknown = OAUTH_SCOPES.filter((scope) => !DISCORD_SCOPES.has(scope));

    check(
        "Alle Scopes kennt Discord wirklich",
        unknown.length === 0,
        unknown.length > 0 ? `${unknown.join(", ")} — Discord antwortet darauf mit "Invalid scope"` : ""
    );
}

/**
 * Die Zwei-Faktor-Pflicht am Tor selbst: Exchange() tauscht den Code gegen einen
 * Token und holt das Konto. Genau dort faellt die Entscheidung.
 *
 * Discord wird dafuer nachgestellt - eine echte Anmeldung laesst sich in einem
 * Pruefskript nicht durchspielen, die Bedingung dahinter schon.
 */
async function checkMfa(client: BotClient): Promise<void> {
    console.log("\n  — Zwei-Faktor-Pflicht —");

    const original = globalThis.fetch;

    /** Stellt Discord nach: Token-Tausch und /users/@me mit dem gegebenen Konto. */
    function fakeDiscord(user: Record<string, unknown>): void {
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            const json = (body: unknown) =>
                new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

            if (url.includes("/oauth2/token")) return json({ access_token: "token", expires_in: 604800 });
            if (url.includes("/users/@me")) return json(user);

            return new Response("{}", { status: 404 });
        }) as typeof fetch;
    }

    const konto = { id: "1059621019947634739", username: "check", global_name: "Check", avatar: null };

    async function versuch(mfa: unknown): Promise<string> {
        fakeDiscord(mfa === undefined ? konto : { ...konto, mfa_enabled: mfa });

        try {
            const session = await client.dashboardService.Exchange("code");

            return session.mfa === true ? "angemeldet" : "angemeldet ohne Merkmal";
        } catch (error) {
            return error instanceof MfaRequired ? "abgewiesen" : `Fehler: ${String(error)}`;
        }
    }

    try {
        check("Konto mit Zwei-Faktor kommt herein", (await versuch(true)) === "angemeldet");
        check("Konto ohne Zwei-Faktor wird abgewiesen", (await versuch(false)) === "abgewiesen");
        check(
            "Fehlendes Feld gilt als 'nicht bestätigt'",
            (await versuch(undefined)) === "abgewiesen",
            "bei einer Regel, die Zugang gewährt, ist die vorsichtige Auslegung die richtige"
        );
        check("Ein 'true' als Text zählt nicht", (await versuch("true")) === "abgewiesen");
    } finally {
        globalThis.fetch = original;
    }
}

/**
 * Der Kern der Sache: die Sitzung steckt verschlüsselt im Cookie, nicht in einem
 * Speicher im Prozess. Genau das wird hier nachgestellt - ein zweiter, frischer
 * DashboardService ist dasselbe wie ein neu gestarteter Bot.
 */
function checkSessions(client: BotClient): void {
    console.log("\n  — Sitzung im Cookie —");

    const service = client.dashboardService;
    const secret = client.config.SERVER_JWT_SECRET;

    const session: IDashboardSession = {
        id: "sitzung-1",
        userId: "1059621019947634739",
        username: "Check",
        avatar: null,
        accessToken: "geheimer-discord-token",
        mfa: true,
        expiresAt: Date.now() + 60_000,
    };

    const cookie = service.Sign(session);

    check("Cookie enthält den Token nicht im Klartext", !cookie.includes(session.accessToken), cookie.slice(0, 40));
    check("Cookie passt in ein Cookie (< 4096 Byte)", Buffer.byteLength(cookie) < 4096, `${Buffer.byteLength(cookie)} Byte`);

    const wieder = service.Session(cookie);
    check("Eigene Sitzung wird gelesen", wieder?.userId === session.userId && wieder?.accessToken === session.accessToken);

    // Ein frischer Service hat leere Caches - genau wie der Bot nach dem Neustart.
    const nachNeustart = new DashboardService(client).Session(cookie);
    check("Sitzung überlebt einen Neustart", nachNeustart?.userId === session.userId, JSON.stringify(nachNeustart));

    // Ein Byte im Chiffrat kippen: GCM muss das bemerken.
    const raw = Buffer.from(cookie, "base64url");
    raw[raw.length - 1] ^= 0x01;
    check("Verändertes Cookie wird abgewiesen", service.Session(raw.toString("base64url")) === null);

    check("Fremdes Secret öffnet nichts", Open(cookie, `${secret}-anders`) === null);
    check("Müll im Cookie ergibt keine Sitzung", service.Session("nicht-mal-base64!!") === null);
    check("Leeres Cookie ergibt keine Sitzung", service.Session("") === null && service.Session(undefined) === null);

    const abgelaufen = Seal({ ...session, expiresAt: Date.now() - 1000 }, secret);
    check("Abgelaufene Sitzung wird abgewiesen", service.Session(abgelaufen) === null);

    // Zwei-Faktor-Pflicht. Das Merkmal steht in der Sitzung, weil sonst jeder
    // Seitenaufruf Discord danach fragen muesste - hier wird geprueft, dass es
    // auch wirklich verlangt wird und nicht nur mitgeschrieben.
    const ohneMfa = Seal({ ...session, mfa: false }, secret);
    check("Sitzung ohne Zwei-Faktor wird abgewiesen", service.Session(ohneMfa) === null);

    const { mfa: _mfa, ...ohneMerkmal } = session;
    check(
        "Cookie von vor der Pflicht wird abgewiesen",
        service.Session(Seal(ohneMerkmal, secret)) === null,
        "sonst liefe die Regel sieben Tage an allen Angemeldeten vorbei"
    );

    const luecke = Seal({ id: "x", userId: "y" }, secret);
    check("Unvollständige Sitzung wird abgewiesen", service.Session(luecke) === null);

    // Cookies von vor dem "email"-Scope tragen weder handle noch email. Die
    // dürfen weiterlaufen, sonst fliegt beim Ausrollen jeder Angemeldete raus.
    const alt = Seal({ ...session, handle: undefined, email: undefined }, secret);
    check("Sitzung ohne handle und email bleibt gültig", service.Session(alt)?.userId === session.userId);
}

async function main(): Promise<void> {
    const client = new BotClient();

    client.server.Port = PORT;
    await client.server.Start();

    const service = client.dashboardService;

    console.log(`\nRedirect URI: ${service.RedirectURI}`);
    console.log(`Invite URL:   ${service.InviteURL()}\n`);

    checkScopes();
    await checkGroups(client);
    checkSessions(client);

    const admins = await fetch(`${BASE}${P}/admins`, MANUAL);
    check(`${P}/admins leitet ohne Sitzung zum Login`, admins.status === 302, `${admins.status}`);
    check(
        "  merkt sich den Rückweg",
        (admins.headers.get("location") ?? "").includes(`return=${encodeURIComponent(`${P}/admins`)}`),
        String(admins.headers.get("location"))
    );

    const adminApi = await fetch(`${BASE}${P}/api/admin`, MANUAL);
    check(`${P}/api/admin ohne Sitzung ist 401`, adminApi.status === 401, `${adminApi.status}`);

    const groupApi = await fetch(`${BASE}${P}/api/admin/group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "1", group: "administrator" }),
    });
    check("Gruppen-Endpunkt ohne Sitzung ist 401", groupApi.status === 401, `${groupApi.status}`);

    const track = await fetch(`${BASE}${P}/api/tracking/1059621019947634739`, MANUAL);
    check(`${P}/api/tracking ohne Sitzung ist 401`, track.status === 401, `${track.status}`);

    const page = await fetch(`${BASE}${P}/user/1059621019947634739/tracking`, MANUAL);
    check("Tracking-Seite leitet ohne Sitzung zum Login", page.status === 302, `${page.status}`);

    // Der alte Pfad steht noch in Postfach-Meldungen von vor der Umstellung.
    const oldPage = await fetch(`${BASE}${P}/1059621019947634739/tracking`, MANUAL);
    check(
        "Alter Tracking-Pfad leitet dauerhaft um",
        oldPage.status === 301 &&
            oldPage.headers.get("location") === `${P}/user/1059621019947634739/tracking`,
        `${oldPage.status} ${oldPage.headers.get("location")}`
    );

    const settings = await fetch(`${BASE}${P}/user/1059621019947634739/settings`, MANUAL);
    check("Einstellungen leiten ohne Sitzung zum Login", settings.status === 302, `${settings.status}`);

    const docu = await fetch(`${BASE}${P}/docu`, MANUAL);
    check(
        "Dokumentation ist ohne Sitzung lesbar",
        docu.status === 200 && (docu.headers.get("content-type") ?? "").startsWith("text/html"),
        `${docu.status}`
    );

    const wtsi = await fetch(`${BASE}${P}/wtsi`, MANUAL);
    check(
        "Alter WTSI-Pfad leitet auf die Dokumentation",
        wtsi.status === 301 && wtsi.headers.get("location") === `${P}/docu#wtsi`,
        `${wtsi.status} ${wtsi.headers.get("location")}`
    );

    const notes = await fetch(`${BASE}${P}/api/notifications`, MANUAL);
    check("Postfach ohne Sitzung ist 401", notes.status === 401, `${notes.status}`);

    const epic = await fetch(`${BASE}${P}/api/account/epic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "MecryTv" }),
    });
    check("Epic-Verknüpfung ohne Sitzung ist 401", epic.status === 401, `${epic.status}`);

    const logo = await fetch(`${BASE}${P}/assets/images/RL%20Nexus%20N%20Logo.png`);
    check("Logo wird ausgeliefert", logo.status === 200, `${logo.status}`);

    const escape = await fetch(`${BASE}${P}/assets/images/..%2F..%2F..%2F..%2F.env`);
    check("Pfad aus images heraus ist 403", escape.status === 403, `${escape.status}`);

    const root = await fetch(`${BASE}${HOME}`, MANUAL);
    check(`${HOME} leitet ohne Sitzung zum Login`, root.status === 302, `${root.status}`);
    check(`  Ziel ist ${P}/login`, root.headers.get("location") === `${P}/login`);

    const login = await fetch(`${BASE}${P}/login`, MANUAL);
    const target = new URL(login.headers.get("location") ?? "https://invalid.example");
    const cookie = login.headers.get("set-cookie") ?? "";

    check(`${P}/login leitet zu Discord`, target.host === "discord.com", target.href);
    check("  redirect_uri passt zur RedirectURI", target.searchParams.get("redirect_uri") === service.RedirectURI);
    check(`  scope ist ${OAUTH_SCOPES.join(" + ")}`, target.searchParams.get("scope") === OAUTH_SCOPES.join(" "), String(target.searchParams.get("scope")));
    check("  state ist gesetzt", (target.searchParams.get("state") ?? "").length > 20);
    check("  state-Cookie ist HttpOnly und SameSite=Lax", cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax"), cookie);

    const evil = await fetch(`${BASE}${P}/login?return=//evil.example`, MANUAL);
    const evilCookie = evil.headers.get("set-cookie") ?? "";
    check("Fremder return-Pfad wird verworfen", !evilCookie.includes("evil"), evilCookie);

    const me = await fetch(`${BASE}${P}/api/me`);
    check(`${P}/api/me ohne Sitzung ist 401`, me.status === 401, `${me.status}`);

    const css = await fetch(`${BASE}${P}/assets/style.css`);
    check("style.css wird ausgeliefert", css.status === 200 && (css.headers.get("content-type") ?? "").startsWith("text/css"), `${css.status}`);

    // Die Hausfarbe steht in style.css selbst, eine zweite Farbdatei gibt es
    // nicht mehr. Fehlt sie dort, sind Knoepfe, Marken und Fokusringe farblos.
    check("style.css traegt die Hausfarbe #ff1e2d", (await css.text()).includes("--brand:#ff1e2d"));

    const js = await fetch(`${BASE}${P}/assets/app.js`);
    check("app.js wird ausgeliefert (Frontend gebaut?)", js.status === 200, `${js.status} - npm run build:dashboard`);

    // Ladezeit: gepackt, mit Stand (ETag), und was sich nie aendert, darf der
    // Browser ein Jahr behalten. Ohne das lud jede Seite alles bei jedem Aufruf neu.
    const packed = await fetch(`${BASE}${P}/assets/app.js`, { headers: { "Accept-Encoding": "br, gzip" } });
    const etag = packed.headers.get("etag") ?? "";
    const again = await fetch(`${BASE}${P}/assets/app.js`, { headers: { "If-None-Match": etag } });

    check("app.js kommt gepackt (Brotli)", packed.headers.get("content-encoding") === "br", String(packed.headers.get("content-encoding")));
    check("Gleicher Stand: 304 ohne Inhalt", etag !== "" && again.status === 304, `${again.status}`);

    const chunkNames = existsSync(path.join(process.cwd(), "src", "dashboard", "public", "assets", "chunks"))
        ? await readdir(path.join(process.cwd(), "src", "dashboard", "public", "assets", "chunks"))
        : [];
    const piece = chunkNames[0] ? await fetch(`${BASE}${P}/assets/chunks/${chunkNames[0]}`) : null;

    check("Stücke mit Prüfsumme: ein Jahr Cache", (piece?.headers.get("cache-control") ?? "").includes("immutable"), String(piece?.headers.get("cache-control")));

    const versioned = await fetch(`${BASE}${P}/assets/style.css?v=abc123def0`);
    const unversioned = await fetch(`${BASE}${P}/assets/style.css`);

    check("style.css mit ?v=: ein Jahr Cache", (versioned.headers.get("cache-control") ?? "").includes("immutable"));
    check("style.css ohne ?v=: der Browser fragt nach", unversioned.headers.get("cache-control") === "no-cache");

    const docuPage = await (await fetch(`${BASE}${P}/docu`)).text();

    check(
        "Seiten hängen die Prüfsumme an app.js und style.css",
        /assets\/app\.js\?v=[0-9a-f]{10}"/.test(docuPage) && /assets\/style\.css\?v=[0-9a-f]{10}"/.test(docuPage)
    );
    check("Kein 1,4-MB-Logo mehr in den Seiten", !docuPage.includes("RL Nexus N Logo.png"));

    // ------------------------------------------------------------------
    // Der Modulbaum des Frontends.
    //
    // Seit das Dashboard aus vielen kleinen Dateien besteht, laedt der Browser
    // sie selbst nach. Ein Import ohne .js-Endung oder ein Tippfehler im Pfad
    // faellt beim Bauen nicht auf - TypeScript laesst den Pfad stehen, wie er
    // dasteht. Bemerkt wuerde es erst an einer weissen Seite. Also hier.
    // ------------------------------------------------------------------
    const ASSETS = path.join(process.cwd(), "src", "dashboard", "public", "assets");
    // Gebündelt und verkleinert: from"./x.js", import"./x.js" und import("./x.js").
    const IMPORT = /(?:from\s*|import\s*\(\s*|import\s*)"([^"]+\.js)"/g;

    const gesehen = new Set<string>();
    const kaputt: string[] = [];
    const offen = ["app.js"];

    while (offen.length > 0) {
        const rel = offen.pop() as string;

        if (gesehen.has(rel)) continue;

        gesehen.add(rel);

        const file = path.join(ASSETS, rel);

        if (!existsSync(file)) {
            kaputt.push(rel);
            continue;
        }

        const code = await readFile(file, "utf8");

        for (const found of code.matchAll(IMPORT)) {
            const spec = found[1] as string;

            if (!spec.startsWith(".")) {
                kaputt.push(`${rel} → ${spec}`);
                continue;
            }

            offen.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
        }
    }

    // Einstieg, geteilte Stücke und je Seite eins - alle muessen erreichbar sein.
    const pages = ["Servers", "Guild", "Tracking", "Settings", "Admin", "Docu"];
    const reached = [...gesehen].join(" ");

    check(
        `Frontend-Bündel lädt vollständig (${gesehen.size} Dateien)`,
        kaputt.length === 0 && pages.every((name) => reached.includes(`chunks/${name}-`)),
        kaputt.join(", ") || pages.filter((name) => !reached.includes(`chunks/${name}-`)).join(", ")
    );

    // Die Seitenleiste der Serverseite: jedes Modul zeigt ein Symbol aus dem
    // Sprite in guild.html, und seine ID wird dort Anker und Selektor
    // (#tickets). Ein fehlendes Symbol bliebe stumm leer, eine doppelte oder
    // mit einer Ziffer beginnende ID bricht die Reiter - beides fiele sonst
    // erst im Browser auf.
    // Geladen wird die gebaute Datei selbst, nicht ihr Text: nur so ist zu sehen,
    // was ein Modul ist und was ein Teil davon. Teile haben keinen Schalter und
    // stehen nie in guild_settings.modules - der Bot kennt sie deshalb nicht.
    type ModuleEntry = {
        id: string;
        icon: string;
        category?: string;
        always?: true;
        parts?: { id: string; icon: string }[];
    };
    type CategoryEntry = { id: string; name: string };

    const { pathToFileURL } = await import("node:url");
    // Die Quelle, nicht das Bündel - dort stehen die Module nicht mehr als eigene Datei.
    const moduleFile = path.join(process.cwd(), "src", "dashboard", "client", "constants", "Modules.ts");
    const guildPage = await readFile(path.join(ASSETS, "..", "guild.html"), "utf8");
    const loaded = existsSync(moduleFile)
        ? ((await import(pathToFileURL(moduleFile).href)) as {
              MODULES?: ModuleEntry[];
              CATEGORIES?: CategoryEntry[];
          })
        : {};

    const modules = loaded.MODULES ?? [];
    const categories = loaded.CATEGORIES ?? [];
    const anchors = [...modules, ...modules.flatMap((module) => module.parts ?? [])];
    const symbols = anchors.map((entry) => entry.icon.replace("#", ""));
    const missing = symbols.filter((symbol) => !guildPage.includes(`id="${symbol}"`));
    const ids = anchors.map((entry) => entry.id);

    check(
        `Modul-Symbole stehen im Sprite von guild.html (${symbols.length})`,
        symbols.length > 0 && missing.length === 0,
        missing.join(", ")
    );
    // Eine Modul-ID darf in guild.html gar nicht vorkommen (das Modul ist noch
    // nicht gebaut, card() setzt spaeter eine Platzkarte) oder genau einmal -
    // und dann nur als die Karte dieses Moduls. Zaehlen statt "kommt sie vor":
    // ein zweites, falsches Element mit derselben ID kaeme an einer reinen
    // Praesenzpruefung vorbei, sobald die echte Karte schon existiert - includes()
    // ist dann fuer beide Seiten schon true, und das Falsche faellt nie auf.
    const misplaced = ids.filter((id) => {
        if (!/^[a-z][a-z0-9-]*$/.test(id)) return true;

        const count = guildPage.split(`id="${id}"`).length - 1;

        if (count === 0) return false;

        return count !== 1 || !guildPage.includes(`<section class="setcard" id="${id}"`);
    });

    check(
        `Modul-Anker sind eindeutig und brauchbar (${ids.length})`,
        ids.length > 0 && new Set(ids).size === ids.length && misplaced.length === 0,
        misplaced.join(", ")
    );

    // Jedes Modul steht unter einer Ueberschrift der Leiste. Ohne Kategorie
    // fiele es aus der Leiste heraus, ohne dass jemand es merkt.
    const known = new Set(categories.map((entry) => entry.id));
    const homeless = modules.filter((entry) => !entry.category || !known.has(entry.category));

    check(
        `Jedes Modul haengt an einer Kategorie (${modules.length})`,
        categories.length > 0 && homeless.length === 0,
        homeless.map((entry) => entry.id).join(", ")
    );

    const empty = categories.filter((entry) => !modules.some((module) => module.category === entry.id));

    check(
        `Jede Kategorie traegt mindestens ein Modul (${categories.length})`,
        empty.length === 0,
        empty.map((entry) => entry.id).join(", ")
    );

    // Die Galerie gehoert fest dazu. Faellt die Markierung weg, stuende im
    // Dashboard ein Schalter, den der Bot nicht annimmt.
    check(
        "Galerie ist als festes Modul markiert",
        modules.find((entry) => entry.id === "gallery")?.always === true
    );

    // Das Dashboard weist zu grosse Bilder ab, bevor sie durchs Netz gehen.
    // Es kann MAX_IMAGE_BYTES nicht importieren und traegt die Zahl selbst -
    // laufen beide auseinander, nennt die Kachel eine falsche Grenze.
    const CLIENT = path.join(process.cwd(), "src", "dashboard", "client");
    const galleryCore = await readFile(path.join(CLIENT, "core", "Gallery.ts"), "utf8");
    const clientLimit = Number(/MAX_UPLOAD_BYTES = (\d+)/.exec(galleryCore)?.[1]);

    check(
        "Upload-Grenze im Dashboard und im Bot stimmen ueberein",
        clientLimit === MAX_IMAGE_BYTES,
        `Dashboard: ${clientLimit} | Bot: ${MAX_IMAGE_BYTES}`
    );

    // Die Platzhalter der Ticket-Nachrichten kennt der Bot; das Dashboard fuehrt
    // dieselbe Liste mit Beschriftung und Beispiel. Fehlt dort einer, bietet der
    // Editor ihn nie an - steht dort einer zu viel, ersetzt ihn niemand.
    const placeholderFile = path.join(CLIENT, "constants", "Placeholders.ts");
    const placeholders = existsSync(placeholderFile)
        ? ((await import(pathToFileURL(placeholderFile).href)) as { PLACEHOLDERS?: { key: string }[] })
        : {};
    const clientKeys = (placeholders.PLACEHOLDERS ?? []).map((entry) => entry.key);

    check(
        `Platzhalter im Dashboard und im Bot stimmen ueberein (${PLACEHOLDER_KEYS.length})`,
        clientKeys.length === PLACEHOLDER_KEYS.length && PLACEHOLDER_KEYS.every((key) => clientKeys.includes(key)),
        `Dashboard: ${clientKeys.join(", ")} | Bot: ${PLACEHOLDER_KEYS.join(", ")}`
    );

    const up = await fetch(`${BASE}${P}/assets/..%2Findex.html`);
    check("Pfad aus assets heraus ist 403", up.status === 403, `${up.status}`);

    const env = await fetch(`${BASE}${P}/assets/..%2F..%2F..%2F..%2F.env`);
    check("Zugriff auf .env ist 403", env.status === 403, `${env.status}`);

    const forged = await fetch(`${BASE}${P}/callback?code=x&state=gefaelscht`, MANUAL);
    check("Callback mit falschem state ist 400", forged.status === 400, `${forged.status}`);

    const denied = await fetch(`${BASE}${P}/callback?error=access_denied`, MANUAL);
    check("Abgebrochener Login zeigt eine Seite", denied.status === 403 && (denied.headers.get("content-type") ?? "").startsWith("text/html"), `${denied.status}`);

    const nonsense = await fetch(`${BASE}${P}/guild/keine-id`, MANUAL);
    check("Guild-Seite mit kaputter ID ist 404", nonsense.status === 404, `${nonsense.status}`);

    const id = "123456789012345678";
    check("  Testdaten sind eine gültige Snowflake", SNOWFLAKE.test(id));

    const guild = await fetch(`${BASE}${P}/guild/${id}/tickets`, MANUAL);
    const back = guild.headers.get("location") ?? "";
    check("Guild-Seite ohne Sitzung leitet zum Login", guild.status === 302, `${guild.status}`);
    check("  merkt sich den Rückweg samt Abschnitt", back.includes(encodeURIComponent(`${P}/guild/${id}/tickets`)), back);

    // Der Abschnitt steht im Pfad. Was kein Abschnitt sein kann, ist auch keine
    // eigene Seite - sonst wäre jeder Tippfehler eine.
    const wrong = await fetch(`${BASE}${P}/guild/${id}/NichtKlein`, MANUAL);
    check("Guild-Seite mit unmöglichem Abschnitt ist 404", wrong.status === 404, `${wrong.status}`);

    // Alte Lesezeichen und Links in Discord-Nachrichten sollen weiter ankommen.
    const legacy = await fetch(`${BASE}${P}/g/${id}`, MANUAL);
    check(
        "Alter Link /g/<id> leitet auf die neue Adresse",
        legacy.status === 302 && (legacy.headers.get("location") ?? "").endsWith(`${P}/guild/${id}/uebersicht`),
        `${legacy.status} → ${legacy.headers.get("location")}`
    );

    // Beweis über HTTP: mit gültigem Cookie kommt die Seite, ohne kommt der Login.
    const sitzungsCookie = service.Sign({
        id: "http-sitzung",
        userId: "1059621019947634739",
        username: "Check",
        avatar: null,
        accessToken: "egal",
        mfa: true,
        expiresAt: Date.now() + 60_000,
    });

    const mitCookie = await fetch(`${BASE}${HOME}`, {
        ...MANUAL,
        headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(sitzungsCookie)}` },
    });

    check(
        "Mit Sitzungs-Cookie kommt die Seite statt des Logins",
        mitCookie.status === 200 && (mitCookie.headers.get("content-type") ?? "").startsWith("text/html"),
        `${mitCookie.status}`
    );

    // Module schalten. Geprüft wird, was vor Discord und Datenbank abgewiesen
    // wird - weiter kommt eine Test-Sitzung ohne echten Token ohnehin nicht.
    const modulesApi = `${BASE}${P}/api/guild/${id}/modules`;
    const mitSitzung = { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(sitzungsCookie)}` };

    const ohneSitzung = await fetch(modulesApi, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: "tickets", on: true }),
    });
    check("Modul-Schalter ohne Sitzung ist 401", ohneSitzung.status === 401, `${ohneSitzung.status}`);

    const alsText = await fetch(modulesApi, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "text/plain" },
        body: "tickets",
    });
    check("Modul-Schalter nimmt nur JSON (CSRF)", alsText.status === 415, `${alsText.status}`);

    const erfunden = await fetch(modulesApi, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "application/json" },
        body: JSON.stringify({ module: "gibt-es-nicht", on: true }),
    });
    check("Modul-Schalter weist unbekannte Module ab", erfunden.status === 400, `${erfunden.status}`);

    // Die Galerie gehoert fest dazu. Der Schalter muss vor Datenbank und Discord
    // abweisen, sonst haengt die Antwort an Dingen, die der Check nicht hat.
    const festesAus = await fetch(modulesApi, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "application/json" },
        body: JSON.stringify({ module: "gallery", on: false }),
    });
    check("Festes Modul laesst sich nicht ausschalten", festesAus.status === 400, `${festesAus.status}`);

    // Der Bilder-Parser aus Server.ts haengt am ganzen Server, nicht nur an der
    // kuenftigen Galerie-Route. Ohne eigenes bodyLimit auf dieser Route muss ein
    // Bild-Body wieder beim Fastify-Standard (1 MiB) kappen, nicht bei den 8 MiB,
    // die eigentlich nur fuer Uploads gedacht sind.
    const zuGrossesBild = await fetch(modulesApi, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "image/png" },
        body: Buffer.alloc(1024 * 1024 + 1),
    });
    check("Modul-Schalter kappt Bild-Body ueber 1 MiB (413, kein eigenes bodyLimit)", zuGrossesBild.status === 413, `${zuGrossesBild.status}`);

    // Das Dashboard zeigt die Namen, der Bot entscheidet, was gespeichert wird.
    // Fehlt ein Modul im Bot, ließe es sich anklicken, aber nie einschalten.
    // Verglichen werden nur die Module: Teile eines Moduls haben keinen Schalter.
    const switchable = modules.map((entry) => entry.id);

    check(
        "Modul-Liste im Dashboard und im Bot stimmen überein",
        switchable.length === MODULE_IDS.length && MODULE_IDS.every((known) => switchable.includes(known)),
        `Dashboard: ${switchable.join(", ")} | Bot: ${MODULE_IDS.join(", ")}`
    );

    const ticketsApi = await fetch(`${BASE}${P}/api/guild/${id}/tickets`, MANUAL);
    check("Tickets ohne Sitzung ist 401", ticketsApi.status === 401, `${ticketsApi.status}`);

    const ticketsAlsText = await fetch(`${BASE}${P}/api/guild/${id}/tickets`, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "save" }),
    });
    check("Tickets-Schreiben nimmt nur JSON (CSRF)", ticketsAlsText.status === 415, `${ticketsAlsText.status}`);

    // Transcripts: die Seite schickt ohne Sitzung zum Login und wieder zurück,
    // ihre Anhänge und die Liste sagen 401 - nichts davon ist öffentlich.
    const transcriptPage = await fetch(`${BASE}${P}/transcript/1`, MANUAL);
    const transcriptBack = transcriptPage.headers.get("location") ?? "";
    check("Transcript ohne Sitzung leitet zum Login", transcriptPage.status === 302, `${transcriptPage.status}`);
    check("  und kommt danach zum Transcript zurück", transcriptBack.includes(encodeURIComponent(`${P}/transcript/1`)), transcriptBack);

    const transcriptFile = await fetch(`${BASE}${P}/transcript/1/0.png`, MANUAL);
    check("Transcript-Anhang ohne Sitzung ist 401", transcriptFile.status === 401, `${transcriptFile.status}`);

    const transcriptOdd = await fetch(`${BASE}${P}/transcript/1/geheim.env`, MANUAL);
    check("Nur Anhang-Namen, die der Bot vergibt", transcriptOdd.status === 404, `${transcriptOdd.status}`);

    const transcriptsApi = await fetch(`${BASE}${P}/api/guild/${id}/transcripts`, MANUAL);
    check("Transcript-Liste ohne Sitzung ist 401", transcriptsApi.status === 401, `${transcriptsApi.status}`);

    const transcriptsAlsText = await fetch(`${BASE}${P}/api/guild/${id}/transcripts`, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "delete", id: 1 }),
    });
    check("Transcript-Löschen nimmt nur JSON (CSRF)", transcriptsAlsText.status === 415, `${transcriptsAlsText.status}`);

    // Live Tickets: nichts ohne Sitzung, auch nicht der Stream; schreiben nur als JSON bzw. roh.
    for (const [was, pfad] of [
        ["Live-Liste", "live"],
        ["Live-Stream", "live/stream"],
        ["Live-Verlauf", "live/1"],
    ]) {
        const antwort = await fetch(`${BASE}${P}/api/guild/${id}/${pfad}`, MANUAL);
        check(`${was} ohne Sitzung ist 401`, antwort.status === 401, `${antwort.status}`);
    }

    const liveAlsText = await fetch(`${BASE}${P}/api/guild/${id}/live/1`, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "send", content: "hallo" }),
    });
    check("Live-Schreiben nimmt nur JSON (CSRF)", liveAlsText.status === 415, `${liveAlsText.status}`);

    const liveDateiAlsText = await fetch(`${BASE}${P}/api/guild/${id}/live/1/file?name=a.txt`, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "text/plain" },
        body: "hallo",
    });
    check("Live-Datei nimmt nur rohe Daten", liveDateiAlsText.status === 415, `${liveDateiAlsText.status}`);

    const activityApi = await fetch(`${BASE}${P}/api/guild/${id}/activity`, MANUAL);
    check("Aktivität ohne Sitzung ist 401", activityApi.status === 401, `${activityApi.status}`);

    const galerieApi = await fetch(`${BASE}${P}/api/guild/${id}/gallery`, MANUAL);
    check("Galerie ohne Sitzung ist 401", galerieApi.status === 401, `${galerieApi.status}`);

    const galerieSchreiben = `${BASE}${P}/api/guild/${id}/gallery/image/delete`;

    const galerieOhneSitzung = await fetch(galerieSchreiben, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: `${id}/test/bild.webp` }),
    });
    check("Galerie-Schreiben ohne Sitzung ist 401", galerieOhneSitzung.status === 401, `${galerieOhneSitzung.status}`);

    const galerieErfunden = await fetch(`${BASE}${P}/api/guild/${id}/gallery/gibt-es-nicht`, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "application/json" },
        body: "{}",
    });
    check("Galerie weist unbekannte Aktionen ab", galerieErfunden.status === 400, `${galerieErfunden.status}`);

    const galerieAlsText = await fetch(`${BASE}${P}/api/guild/${id}/gallery/category`, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "text/plain" },
        body: JSON.stringify({ category: "csrf" }),
    });
    check("Galerie-Schreiben nimmt nur JSON (CSRF)", galerieAlsText.status === 415, `${galerieAlsText.status}`);

    const uploadAlsJson = await fetch(`${BASE}${P}/api/guild/${id}/gallery/image?category=test&name=x`, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "application/json" },
        body: "{}",
    });
    check("Galerie-Upload nimmt nur Bilder", uploadAlsJson.status === 415, `${uploadAlsJson.status}`);

    // Gegenstueck zum 413 auf der Modul-Route: hier muss ein Bild ueber 1 MiB
    // durchkommen. Welcher Status danach folgt, haengt an der Test-Sitzung -
    // nur 413 waere falsch, dann fehlt der Route ihr bodyLimit.
    const grossesBild = await fetch(`${BASE}${P}/api/guild/${id}/gallery/image?category=test&name=gross`, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "image/png" },
        body: new Uint8Array(1024 * 1024 + 1),
    });
    check("Galerie nimmt Bilder ueber 1 MiB an", grossesBild.status !== 413, `${grossesBild.status}`);

    const health = await fetch(`${BASE}/dcapi/health`);
    check("Bestehende API bleibt tokenpflichtig", health.status === 401, `${health.status}`);

    await checkMapping(client);
    await checkRateLimit(client);
    await checkMfa(client);

    await client.server.Stop();

    console.log(failures === 0 ? "\n✅ Alle Prüfungen bestanden.\n" : `\n❌ ${failures} Prüfung(en) fehlgeschlagen.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

void main();
