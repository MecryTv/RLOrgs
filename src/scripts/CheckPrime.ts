/**
 * Prüft die Anbindung an Prime (prime.rocketplanet.gg): Umrechnung, Transport,
 * Auflösung und Ränge. Beendet sich mit Exit-Code 1, sobald etwas nicht stimmt.
 *
 *   npm run check:prime -- MecryTv
 *
 * Ohne Namen wird nur gerechnet und geprüft, was ohne Netz geht. Mit Namen geht
 * eine echte Anfrage raus - dafür muss PRIME_API_TOKEN in der .env stehen.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import path from "path";
import { readdirSync, readFileSync } from "node:fs";
import BotClient from "../client/BotClient";
import { DivisionName, TierName, ToMMR, ToPlatform, ToPlayerID, TrackerURL, TRACKED_PLAYLISTS } from "../constants/Prime";
import PrimeService, { PrimeError } from "../services/PrimeService";
import { IPrimeProfile } from "../interfaces/services/prime/IPrimeService";
import { PRIME_CACHE_TTL } from "../constants/Prime";

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

/**
 * Die Adresse hinter dem Knopf unter der Karte.
 *
 * Ein Epic-Name darf Leerzeichen und Sonderzeichen enthalten. Unkodiert waere
 * die Adresse entweder kaputt oder - beim Doppelkreuz - stillschweigend
 * abgeschnitten, und der Knopf fuehrte auf ein leeres Profil.
 */
function checkTracker(): void {
    console.log("\n  — Tracker-Adresse —");

    check(
        "Einfacher Name",
        TrackerURL("MecryTv") === "https://rocketleague.tracker.network/rocket-league/profile/epic/MecryTv/overview",
        TrackerURL("MecryTv")
    );
    check("Leerzeichen werden kodiert", TrackerURL("Some Name").includes("Some%20Name"), TrackerURL("Some Name"));
    check("Ein Doppelkreuz auch", TrackerURL("A#1").includes("A%231"), TrackerURL("A#1"));
    check("  und schneidet die Adresse nicht ab", !TrackerURL("A#1").includes("#"), TrackerURL("A#1"));
    check("Umlaute werden kodiert", !/[äöü]/.test(TrackerURL("Grün")), TrackerURL("Grün"));
}

/**
 * Die Verknuepfung haengt an der Discord-ID, nicht an einer Guild.
 *
 * Genau darauf beruht, dass /rank auf jedem Server funktioniert, auf dem der Bot
 * ist. Es steht nirgends im Code, sondern im Schema - und ein spaeter
 * hinzugefuegtes guild_id waere ein stiller Rueckschritt, den niemand bemerkt,
 * bis sich jemand auf dem zweiten Server neu verknuepfen muss.
 */
function checkGuildFree(): void {
    console.log("\n  — Guild-unabhaengig —");

    const root = path.join(process.cwd(), "src", "database", "migrations");
    const sql = readdirSync(root)
        .filter((file) => file.endsWith(".sql"))
        .map((file) => readFileSync(path.join(root, file), "utf8"))
        .join("\n");

    for (const table of ["player_accounts", "player_ranks", "player_profiles"]) {
        // Von CREATE TABLE bis zur schliessenden Klammer der Definition.
        const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
        const body = start < 0 ? "" : sql.slice(start, sql.indexOf(") ENGINE", start));

        check(`${table} gibt es`, start >= 0);
        check(`  ohne guild_id`, start >= 0 && !/guild_id/.test(body), "sonst haengt die Verknuepfung am Server");
    }

    // Und keine spaetere Migration schiebt eine Spalte nach.
    const added = /ALTER TABLE\s+(player_accounts|player_ranks|player_profiles)[\s\S]{0,200}?guild_id/.test(sql);

    check("Auch spaeter kommt keine dazu", !added);
}

/**
 * Der Zwischenspeicher und was passiert, wenn Prime nicht antwortet.
 *
 * Beides ohne Netz: eine Unterklasse stellt Prime nach und zaehlt mit, wie oft
 * wirklich geladen wurde. Genau darum geht es - dass eben nicht bei jedem Aufruf
 * geladen wird, und dass ein Ausfall den letzten Stand nicht wegwirft.
 */
async function checkCache(client: BotClient): Promise<void> {
    console.log("\n  — Zwischenspeicher —");

    const profile = (name: string): IPrimeProfile =>
        ({
            name,
            platform: "Epic Games",
            accountId: "abc",
            playerId: "Epic|abc|0",
            linked: [],
            seasonLevel: 5,
            seasonWins: 7,
            ranks: [],
            stats: [],
            club: null,
            fetchedAt: new Date().toISOString(),
        }) as IPrimeProfile;

    class FakePrime extends PrimeService {
        public loads = 0;
        public down = false;

        protected override async Load(name: string): Promise<IPrimeProfile | null> {
            this.loads += 1;

            if (this.down) throw new PrimeError("Prime antwortet nicht", "Network");

            return profile(name);
        }

        // Ohne Token wuerde Profile() gar nicht erst laden.
        public override get IsConfigured(): boolean {
            return true;
        }
    }

    const prime = new FakePrime(client);

    const first = await prime.Profile("Spieler");
    const second = await prime.Profile("Spieler");
    const otherCase = await prime.Profile("SPIELER");

    check("Der erste Aufruf laedt", prime.loads === 1, `${prime.loads} Ladevorgaenge`);
    check("Der zweite kommt aus dem Speicher", prime.loads === 1, `${prime.loads} Ladevorgaenge`);
    check("  Gross- und Kleinschreibung egal", prime.loads === 1 && otherCase?.name === first?.name);
    check("Der Stand ist nicht als alt markiert", second?.stale === undefined);

    // Jetzt faellt Prime aus. Der Eintrag ist noch da, gilt aber als nicht
    // mehr frisch - also wird geladen, und das schlaegt fehl.
    prime.Forget();
    prime.down = true;

    let threw = false;

    try {
        await prime.Profile("Unbekannt");
    } catch {
        threw = true;
    }

    check("Ohne alten Stand meldet ein Ausfall einen Fehler", threw);

    // Und mit altem Stand: der kommt zurueck, markiert.
    prime.down = false;
    prime.Forget();
    await prime.Profile("Spieler");

    const loadsBefore = prime.loads;

    prime.down = true;

    // Den Eintrag kuenstlich altern lassen, damit er neu geholt werden muss.
    const entry = (prime as unknown as { cache: Map<string, { at: number }> }).cache.get("spieler");

    if (entry) entry.at = Date.now() - PRIME_CACHE_TTL - 1000;

    const rescued = await prime.Profile("Spieler");

    check("Bei Ausfall wird es noch einmal versucht", prime.loads === loadsBefore + 1);
    check("  und der alte Stand kommt zurueck", rescued?.name === "Spieler", String(rescued?.name));
    check("  als alt markiert", rescued?.stale === true, String(rescued?.stale));

    prime.Close();
}


/**
 * Die Umrechnung ist der Kern: steht sie falsch, sieht jede Zahl im Dashboard
 * plausibel aus und ist trotzdem daneben. Die Werte stammen aus einer echten
 * Antwort von Prime.
 */
function checkMath(): void {
    console.log("\n  — Umrechnung —");

    check("MMR ist Wert * 20 + 100", ToMMR(62.4867) === 1350, String(ToMMR(62.4867)));
    check("  1v1-Beispiel stimmt", ToMMR(33.9633) === 779, String(ToMMR(33.9633)));
    check("  3v3-Beispiel stimmt", ToMMR(53.9804) === 1180, String(ToMMR(53.9804)));
    check("Es wird gerundet, nicht abgeschnitten", ToMMR(0.024) === 100 && ToMMR(0.026) === 101);
    check("Ein Wert von 0 ergibt 100", ToMMR(0) === 100, String(ToMMR(0)));

    console.log("\n  — Ränge —");

    check("Rang 0 ist Unranked", TierName(0) === "Unranked");
    check("Rang 12 ist Platin III", TierName(12) === "Platin III", TierName(12));
    check("Rang 18 ist Champion III", TierName(18) === "Champion III", TierName(18));
    check("Rang 22 ist Supersonic Legend", TierName(22) === "Supersonic Legend", TierName(22));
    check("Unbekannter Rang fällt auf Unranked", TierName(99) === "Unranked", TierName(99));

    check("Division 0 heißt I", DivisionName(0) === "I");
    check("Division 3 heißt IV", DivisionName(3) === "IV");
    check("Division 4 gibt es nicht", DivisionName(4) === null);

    console.log("\n  — PlayerID —");

    check("Epic wird übersetzt", ToPlayerID("Epic Games", "abc") === "Epic|abc|0", String(ToPlayerID("Epic Games", "abc")));
    check("PlayStation heißt PS4", ToPlayerID("PlayStation", "1") === "PS4|1|0", String(ToPlayerID("PlayStation", "1")));
    check("Xbox heißt XboxOne", ToPlayerID("Xbox", "1") === "XboxOne|1|0", String(ToPlayerID("Xbox", "1")));
    check("Nintendo heißt Switch", ToPlayerID("Nintendo", "1") === "Switch|1|0", String(ToPlayerID("Nintendo", "1")));
    check("Unbekannte Plattform ergibt null", ToPlayerID("Facebook", "1") === null);

    check("Drei Playlists werden verfolgt", TRACKED_PLAYLISTS.length === 3);
    check(
        "  und zwar 1v1, 2v2, 3v3",
        TRACKED_PLAYLISTS.map((entry) => `${entry.key}:${entry.id}`).join(" ") === "1v1:10 2v2:11 3v3:13",
        TRACKED_PLAYLISTS.map((entry) => `${entry.key}:${entry.id}`).join(" ")
    );
}

async function checkLive(client: BotClient, player: string): Promise<void> {
    console.log(`\n  — Echte Abfrage: ${player} —`);

    const service = client.primeService;
    const started = Date.now();

    const profile = await service.Profile(player);

    if (!profile) {
        check("Spieler wurde gefunden", false, "Prime kennt den Namen nicht");
        return;
    }

    check("Spieler wurde gefunden", true, `${Date.now() - started} ms`);
    check("Anzeigename kommt zurück", profile.name.length > 0, profile.name);
    check("Plattform ist bekannt", profile.platform.length > 0, profile.platform);
    check("PlayerID hat drei Teile", profile.playerId.split("|").length === 3, profile.playerId);
    check("Zeitstempel ist gesetzt", !Number.isNaN(Date.parse(profile.fetchedAt)));

    check("Ränge kommen an", profile.ranks.length > 0, `${profile.ranks.length} Playlists`);

    for (const rank of profile.ranks) {
        // Eine MMR unter 100 wäre rechnerisch unmöglich: der interne Wert ist nie negativ.
        check(
            `  ${rank.key}: ${rank.mmr} MMR, ${rank.tierName}${rank.divisionName ? ` Div ${rank.divisionName}` : ""}`,
            rank.mmr >= 100 && rank.tier >= 0 && rank.tier <= 22,
            JSON.stringify(rank)
        );
    }


    // Die Plattformen, die Epic am Konto haengen sieht. Sie sind der Grund,
    // warum ein einziger Login fuer alle fuenf reicht - deshalb hier geprueft.
    console.log("\n  — Verknüpfte Plattformen —");

    if (profile.linked.length === 0) {
        console.log("  --   Dieses Konto hängt an keiner weiteren Plattform.");
    }

    for (const account of profile.linked) {
        check(
            `  ${account.platform}: ${account.name}`,
            ToPlatform(account.platform) !== null,
            `unbekannte Plattform: ${account.platform}`
        );
    }

    // Der Ingame-Club. Kein Club ist der Normalfall und kein Fehler - gemeckert
    // wird nur, wenn einer da ist und dann unvollstaendig ankommt.
    console.log("\n  — Ingame-Club —");

    if (!profile.club) {
        console.log("  --   Dieser Spieler ist in keinem Club.");
    } else {
        const club = profile.club;

        check(`  ${club.name} [${club.tag}]`, club.name.length > 0 && club.tag.length > 0);
        check("  Mitglieder kommen an", club.members.length > 0, `${club.members.length}`);
        check("  Genau ein Owner", club.members.filter((member) => member.owner).length === 1);
        check(
            "  Club-MMR ist plausibel",
            club.averageMMR === null || club.averageMMR >= 100,
            String(club.averageMMR)
        );
    }

    // Zweiter Aufruf: derselbe Name darf nicht erneut über die Leitung gehen.
    const again = Date.now();
    await service.Profile(player);

    check("Zweite Abfrage kommt aus dem Cache", Date.now() - again < 50, `${Date.now() - again} ms`);

    service.Forget(player);
    check("Cache lässt sich leeren", service.Stats().size === 0);

    // Der Weg, den die echte Anmeldung geht: Epic gibt nur die Konto-ID zurück,
    // Prime muss damit dasselbe Profil finden wie mit dem Namen. Bricht das,
    // funktioniert der Epic-Login nicht mehr - ohne dass es sonst auffiele.
    // Steht am Ende, weil es den eben geleerten Cache wieder füllt.
    console.log("\n  — Anmeldung über die Konto-ID —");

    const byId = await service.Profile(profile.accountId);

    check("Konto-ID findet dasselbe Profil", byId?.accountId === profile.accountId, String(byId?.accountId));
    check("  und denselben Namen", byId?.name === profile.name, String(byId?.name));

    service.Forget(profile.accountId);
}

async function main(): Promise<void> {
    const client = new BotClient();
    const player = process.argv[2]?.trim();

    console.log(`\nPrime-Token: ${client.primeService.IsConfigured ? "gesetzt" : "fehlt"}\n`);

    checkMath();
    checkTracker();
    checkGuildFree();

    // Braucht kein Netz: der Zwischenspeicher wird mit einer nachgestellten
    // Prime-Anbindung geprueft.
    await checkCache(client);

    if (!player) {
        console.log("\n⏭️  Kein Spielername übergeben - die echte Abfrage bleibt aus.\n   npm run check:prime -- DEIN_EPIC_NAME\n");
    } else if (!client.primeService.IsConfigured) {
        console.log("\n⏭️  PRIME_API_TOKEN fehlt in der .env - die echte Abfrage bleibt aus.\n");
    } else {
        try {
            await checkLive(client, player);
        } catch (error) {
            const prime = error instanceof PrimeError ? error : null;

            check("Echte Abfrage lief durch", false, prime ? `${prime.type}: ${prime.message}` : String(error));
        }
    }

    client.primeService.Close();

    console.log(failures === 0 ? "\n✅ Alle Prüfungen bestanden.\n" : `\n❌ ${failures} Prüfung(en) fehlgeschlagen.\n`);

    process.exit(failures > 0 ? 1 : 0);
}

void main();
