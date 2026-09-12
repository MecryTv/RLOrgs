/**
 * Prüft die Datenbankschicht: Verbindung, Migrationen, jedes Model einmal durch
 * und den Cache. Beendet sich mit Exit-Code 1, sobald etwas nicht stimmt.
 *
 *   npm run check:db
 *
 * Absichtlich ohne Test-Framework - der Bot hat keins, und ein Durchlauf reicht,
 * um Schema, Models und Cache abzusichern.
 *
 * Alles, was hier geschrieben wird, hängt an einer erfundenen Guild-ID und wird
 * am Ende wieder entfernt. Zeigt die .env auf eine echte Datenbank, bleibt
 * danach nichts davon übrig.
 */
process.env.CLIENT_SECRET ||= "check-secret";
process.env.DEV_CLIENT_SECRET ||= "check-secret";

import BotClient from "../client/BotClient";
import { MIGRATIONS_TABLE, TABLES } from "../constants/Database";
import { DatabaseUnavailable } from "../services/DatabaseService";
import { TeamMMR, WTSI } from "../constants/WTSI";
import PlayerRanks from "../models/PlayerRanks";
import { DAY_MS, HOUR_MS, SplitSpan } from "../constants/Activity";
import { PERMANENT_MODULES } from "../constants/Modules";

// Eine Snowflake, die es bei Discord nicht gibt - Stand 2262.
const GUILD = "9007199254740991";
const USER_A = "9007199254740992";
const USER_B = "9007199254740993";

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

/**
 * Ohne Verbindung darf keine Abfrage still ins Leere laufen: sie muss mit einem
 * eigenen Fehlertyp abbrechen, damit Aufrufer den Fall erkennen können.
 */
async function checkOffline(client: BotClient): Promise<void> {
    console.log("\n  — Ohne Verbindung —");

    const service = client.databaseService;

    check("Ready ist aus, solange nichts verbunden ist", service.Ready === false);

    let thrown: unknown;

    try {
        await service.Query("SELECT 1");
    } catch (error) {
        thrown = error;
    }

    check("Abfrage ohne Verbindung wirft DatabaseUnavailable", thrown instanceof DatabaseUnavailable, String(thrown));
    check("Models melden sich als nicht bereit", client.teams.Ready === false);
}

async function checkSchema(client: BotClient): Promise<void> {
    console.log("\n  — Schema —");

    const service = client.databaseService;
    const wanted = [MIGRATIONS_TABLE, ...Object.values(TABLES)];

    const rows = await service.Query<{ name: string }>(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
    );

    const found = new Set(rows.map((row) => row.name));

    for (const table of wanted) check(`Tabelle ${table} steht`, found.has(table));

    const applied = await service.Query<{ name: string }>(`SELECT name FROM ${MIGRATIONS_TABLE}`);

    check("Mindestens eine Migration ist vermerkt", applied.length > 0, `${applied.length}`);

    // Der Klassiker: die Datenbank läuft in UTC, der Treiber liest die Ziffern
    // als Ortszeit - dann steht "gerade eben" plötzlich zwei Stunden zurück.
    const before = Date.now();
    const stamp = await service.One<{ now_ts: Date }>("SELECT CURRENT_TIMESTAMP AS now_ts");
    const drift = Math.abs(new Date(stamp?.now_ts ?? 0).getTime() - before);

    check("Zeitstempel kommen richtig zurück", drift < 60_000, `${Math.round(drift / 1000)} s Abweichung`);
    // Beide Dateien müssen vermerkt sein - sonst fehlt eine Tabelle, obwohl
    // information_schema sie aus einem älteren Lauf noch kennt.
    check(
        "Beide Migrationen sind durch",
        applied.some((row) => row.name.startsWith("001")) && applied.some((row) => row.name.startsWith("002")),
        applied.map((row) => row.name).join(", ")
    );

    // Zweiter Lauf: Connect() ist bereits durch, ein erneuter Aufruf darf die
    // Migrationen nicht noch einmal ausführen.
    await service.Connect();

    const again = await service.Query<{ name: string }>(`SELECT name FROM ${MIGRATIONS_TABLE}`);

    check("Migrationen laufen nicht doppelt", again.length === applied.length, `${applied.length} → ${again.length}`);
}

/**
 * Die Gruppen sind der Grund, warum es die Tabelle gibt: was hier schiefgeht,
 * entscheidet darüber, wer ins Admin-Dashboard kommt.
 */
async function checkGroups(client: BotClient): Promise<void> {
    console.log("\n  — Dashboard-Gruppen —");

    const model = client.groups;
    const service = client.dashboardService;
    const savedDevs = client.config.DEV_USER_IDs;

    client.config.DEV_USER_IDs = [USER_B];

    try {
        check("Ohne Eintrag gibt es keine Gruppe", (await model.Of(USER_A)) === null);
        check("Ohne Eintrag ist man in der Testphase", (await service.GroupOf(USER_A)) === "testphase");

        await model.Grant(USER_A, "premium", USER_B, "Prüflauf");

        check("Vergebene Gruppe kommt zurück", (await model.Of(USER_A)) === "premium");
        check("GroupOf liest aus der Datenbank", (await service.GroupOf(USER_A)) === "premium");
        check("Premium ist kein Staff", (await service.IsStaff(USER_A)) === false);

        // Zweites Vergeben ist ein Wechsel, keine zweite Zeile.
        await model.Grant(USER_A, "administrator", USER_B);

        check("Gruppe lässt sich wechseln", (await service.GroupOf(USER_A)) === "administrator");
        check("Es bleibt bei einer Zeile", (await model.Count({ user_id: USER_A })) === 1);
        check("Administrator ist Staff", await service.IsStaff(USER_A));

        // Developer kommt aus der .env - und Administrator steht darüber.
        check("Developer kommt weiter aus der .env", (await service.GroupOf(USER_B)) === "developer");
        check("Developer ist Staff", await service.IsStaff(USER_B));

        await model.Grant(USER_B, "administrator", USER_A);
        check("Administrator sticht Developer", (await service.GroupOf(USER_B)) === "administrator");

        const alle = await model.All();
        check("Übersicht listet beide", alle.length === 2, `${alle.length}`);
        check("Vergeber wird vermerkt", alle.some((row) => row.granted_by === USER_B));

        // Der Wechsel oben kam ohne Notiz - die alte muss trotzdem noch da sein.
        check(
            "Wechsel ohne Notiz lässt die alte stehen",
            alle.find((row) => row.user_id === USER_A)?.note === "Prüflauf",
            String(alle.find((row) => row.user_id === USER_A)?.note)
        );

        await model.Grant(USER_A, "administrator", USER_B, "");
        check("Leere Notiz löscht sie", (await model.Find(USER_A))?.note === null);

        const counts = await model.Counts();
        check("Zählung je Gruppe stimmt", counts.administrator === 2 && counts.premium === 0, JSON.stringify(counts));

        check("Entzug meldet Erfolg", await model.Revoke(USER_A));
        check("Danach wieder Testphase", (await service.GroupOf(USER_A)) === "testphase");
        check("Zweiter Entzug meldet ehrlich false", (await model.Revoke(USER_A)) === false);

        await model.Revoke(USER_B);
        check("Nach dem Entzug bleibt der Developer", (await service.GroupOf(USER_B)) === "developer");
    } finally {
        client.config.DEV_USER_IDs = savedDevs;

        await model.Revoke(USER_A).catch(() => undefined);
        await model.Revoke(USER_B).catch(() => undefined);
    }
}

async function checkSettings(client: BotClient): Promise<void> {
    console.log("\n  — Guild-Einstellungen —");

    const model = client.settings;

    // Seit Task 3 mischt Of() PERMANENT_MODULES immer mit ein - ein unbekannter
    // Server bekommt also nicht "gar nichts", sondern genau die festen Module.
    // Verglichen wird gegen die Konstante statt gegen ["gallery"], damit dieser
    // Check nicht veraltet, sobald dort ein weiteres Modul dazukommt.
    const fresh = await model.Of(GUILD);
    const permanent = [...PERMANENT_MODULES].sort();

    check(
        "Unbekannter Server bekommt Standardwerte plus die festen Module",
        fresh.modules.length === permanent.length &&
            permanent.every((id) => fresh.modules.includes(id)) &&
            fresh.matchChannel === null,
        fresh.modules.join(",")
    );

    await model.Save({
        guildId: GUILD,
        modules: ["queues"],
        rankRoles: { gc: "123" },
        matchChannel: "456",
        queueChannel: null,
    });

    const saved = await model.Of(GUILD);
    check("Gespeichertes kommt zurück", saved.matchChannel === "456", String(saved.matchChannel));
    check("JSON-Spalte wird ausgepackt", Array.isArray(saved.modules) && saved.modules[0] === "queues");
    check("Verschachteltes JSON überlebt", saved.rankRoles.gc === "123", JSON.stringify(saved.rankRoles));

    // Zweites Save auf denselben Schlüssel: Upsert, kein doppelter Datensatz.
    await model.Save({ ...saved, matchChannel: "789" });

    const updated = await model.Of(GUILD);
    check("Zweites Speichern ändert statt anzulegen", updated.matchChannel === "789", String(updated.matchChannel));
    check("Es bleibt bei einer Zeile", (await model.Count({ guild_id: GUILD })) === 1);

    const toggled = await model.Toggle(GUILD, "leaderboard", true);
    check("Modul lässt sich zuschalten", toggled.includes("leaderboard") && toggled.includes("queues"), toggled.join(","));

    const off = await model.Toggle(GUILD, "queues", false);
    check("Modul lässt sich abschalten", !off.includes("queues"), off.join(","));

    const many = await model.ModulesOf([GUILD, "1"]);
    check("Sammelabfrage findet den Server", many.get(GUILD)?.includes("leaderboard") === true);
    check("Sammelabfrage erfindet nichts", many.has("1") === false);
}

async function checkTeams(client: BotClient): Promise<number> {
    console.log("\n  — Teams und Mitglieder —");

    const model = client.teams;

    const id = await model.Create(GUILD, "Prüfteam", "PRF");
    check("Team wird angelegt und liefert seine ID", id > 0, String(id));

    const found = await model.ByName(GUILD, "Prüfteam");
    check("Team ist über den Namen zu finden", found?.id === id);
    check("Umlaute überstehen die Runde", found?.name === "Prüfteam", String(found?.name));

    let duplicate: unknown;

    try {
        await model.Create(GUILD, "Prüfteam");
    } catch (error) {
        duplicate = error;
    }

    check("Zwei Teams gleichen Namens sind ausgeschlossen", duplicate !== undefined);

    await model.AddMember(id, USER_A, "captain");
    await model.AddMember(id, USER_B, "player");

    const members = await model.Members(id);
    check("Beide Mitglieder stehen im Team", members.length === 2, String(members.length));
    check("Der Kapitän steht oben", members[0]?.role === "captain", String(members[0]?.role));

    // Nochmal derselbe Nutzer: das darf ihn nicht verdoppeln, sondern nur seine Rolle ändern.
    await model.AddMember(id, USER_B, "coach");

    const again = await model.Members(id);
    check("Derselbe Nutzer wird nicht doppelt geführt", again.length === 2, String(again.length));
    check("Seine Rolle ist aktualisiert", again.find((m) => m.user_id === USER_B)?.role === "coach");

    const mine = await model.TeamsOf(GUILD, USER_A);
    check("Team ist über den Spieler zu finden", mine.some((team) => team.id === id));

    check("Mitglied lässt sich entfernen", await model.RemoveMember(id, USER_B));
    check("Danach ist er weg", (await model.Members(id)).length === 1);

    const counts = await model.CountsOf([GUILD]);
    check("Zählung je Server stimmt", counts.get(GUILD) === 1, String(counts.get(GUILD)));

    await model.Archive(id);
    check("Stillgelegtes Team zählt nicht mehr mit", (await model.CountsOf([GUILD])).get(GUILD) === undefined);
    check("Es ist aber noch da", (await model.Find(id)) !== null);

    await model.Update([id], { active: 1 });

    return id;
}

/**
 * Postfach und Sperrfrist. Die Sperre ist der Teil, der wirklich schiefgehen
 * kann: zu streng sperrt sie das erste Verbinden aus, zu lasch ist sie wirkungslos.
 */
/**
 * Die WTSI-Rechnung. Sie entscheidet über das Seeding ganzer Turniere - eine
 * falsche Zahl sieht hier trotzdem plausibel aus. Deshalb wird sie gegen von
 * Hand nachgerechnete Werte geprüft und nicht nur gegen sich selbst.
 */
function checkWTSI(): void {
    console.log("\n  — WTSI-Rechnung —");

    // Voll in Form: Current gleich Peak, also K = 1 und WTSI = gewichteter Peak.
    const fit = WTSI({ current2s: 1400, peak2s: 1400, current3s: 1200, peak3s: 1200 });
    const expected = 1400 * (1400 / 2600) + 1200 * (1200 / 2600);

    check("In Bestform ist WTSI der gewichtete Peak", Math.abs(fit - expected) < 0.01, `${fit.toFixed(2)} statt ${expected.toFixed(2)}`);
    check("  und liegt zwischen beiden Werten", fit > 1200 && fit < 1400, fit.toFixed(2));

    // Der Modus mit dem höheren Peak wiegt schwerer - hier 2v2.
    check("Der stärkere Modus wiegt schwerer", fit > (1400 + 1200) / 2, `${fit.toFixed(2)} > 1300`);

    // Wurzel-Dämpfung: 80 % vom Peak kosten laut Vorlage nur 10,6 %.
    const dip = WTSI({ current2s: 800, peak2s: 1000, current3s: 800, peak3s: 1000 });

    check("Einbruch auf 80 % kostet rund 10,6 %", Math.abs(dip - 1000 * Math.sqrt(0.8)) < 0.01, dip.toFixed(2));
    check("  also deutlich weniger als 20 %", dip > 880 && dip < 900, dip.toFixed(2));

    // Deranking darf nicht helfen: wer absichtlich fällt, verliert nur gedämpft.
    const derank = WTSI({ current2s: 100, peak2s: 1400, current3s: 100, peak3s: 1400 });

    check("Deranking drückt den Wert nur gedämpft", derank > 300, derank.toFixed(2));

    // Ein neuer Höchststand darf keinen Faktor über 1 erzeugen.
    const over = WTSI({ current2s: 1600, peak2s: 1400, current3s: 1600, peak3s: 1400 });

    check("Current über Peak ergibt höchstens den Peak", Math.abs(over - 1400) < 0.01, over.toFixed(2));

    // Fehlende Playlist: die andere trägt allein, kein NaN durch Teilen durch null.
    const only3s = WTSI({ current2s: 0, peak2s: 0, current3s: 1200, peak3s: 1200 });

    check("Fehlt 2v2, trägt 3v3 allein", Math.abs(only3s - 1200) < 0.01, only3s.toFixed(2));
    check("Ganz ohne Daten ist es 0", WTSI({ current2s: 0, peak2s: 0, current3s: 0, peak3s: 0 }) === 0);
    check("Nirgends entsteht NaN", Number.isFinite(only3s) && Number.isFinite(derank) && Number.isFinite(over));

    console.log("\n  — Team-MMR —");

    const team = TeamMMR([
        { current2s: 1400, peak2s: 1400, current3s: 1400, peak3s: 1400 },
        { current2s: 1200, peak2s: 1200, current3s: 1200, peak3s: 1200 },
        { current2s: 1000, peak2s: 1000, current3s: 1000, peak3s: 1000 },
    ]);

    check("Drei Spieler ergeben den echten Durchschnitt", team === 1200, String(team));

    // Wer keine Daten hat, zieht den Schnitt nicht nach unten.
    const withEmpty = TeamMMR([
        { current2s: 1400, peak2s: 1400, current3s: 1400, peak3s: 1400 },
        { current2s: 0, peak2s: 0, current3s: 0, peak3s: 0 },
    ]);

    check("Spieler ohne Daten zählen nicht mit", withEmpty === 1400, String(withEmpty));
    check("Ohne jeden Spieler gibt es keinen Wert", TeamMMR([]) === null);
}

async function checkRanksAndClubs(client: BotClient): Promise<void> {
    console.log("\n  — Ränge speichern —");

    const model = client.ranks;

    check("Ohne Stand gibt es kein Alter", (await model.AgeOf(USER_A)) === null);

    await model.Snapshot(USER_A, [
        { key: "2v2", label: "2v2", mmr: 1400, tier: 18, tierName: "x", division: 1, divisionName: "II", matches: 40, streak: 2, placement: false, placementMatches: 10 },
        { key: "3v3", label: "3v3", mmr: 1200, tier: 16, tierName: "x", division: 0, divisionName: "I", matches: 90, streak: -1, placement: false, placementMatches: 10 },
    ]);

    const rows = await model.Of(USER_A);

    check("Beide Playlists sind gespeichert", rows.length === 2, `${rows.length}`);
    check("Der Peak startet auf dem aktuellen Wert", rows.every((row) => row.peak_mmr === row.mmr));

    const age = await model.AgeOf(USER_A);
    check("Das Alter ist frisch", age !== null && age < 60_000, `${age} ms`);

    // Absturz: die MMR fällt, der Peak bleibt oben - das trägt den Schutz gegen Deranking.
    await model.Snapshot(USER_A, [
        { key: "2v2", label: "2v2", mmr: 900, tier: 13, tierName: "x", division: 0, divisionName: "I", matches: 45, streak: -3, placement: false, placementMatches: 10 },
    ]);

    const after = (await model.Of(USER_A)).find((row) => row.playlist === 11);

    check("Die aktuelle MMR fällt mit", after?.mmr === 900, String(after?.mmr));
    check("Der Peak bleibt stehen", after?.peak_mmr === 1400, String(after?.peak_mmr));

    // Neuer Höchststand: jetzt zieht der Peak nach.
    await model.Snapshot(USER_A, [
        { key: "2v2", label: "2v2", mmr: 1500, tier: 19, tierName: "x", division: 0, divisionName: "I", matches: 50, streak: 4, placement: false, placementMatches: 10 },
    ]);

    const peak = (await model.Of(USER_A)).find((row) => row.playlist === 11);
    check("Ein neuer Höchststand hebt den Peak", peak?.peak_mmr === 1500, String(peak?.peak_mmr));

    const input = PlayerRanks.ToWTSI(await model.Of(USER_A));
    check("Die WTSI-Eingabe nimmt Current und Peak", input.current2s === 1500 && input.peak2s === 1500, JSON.stringify(input));

    await model.SaveProfile(USER_A, 5, 7, [{ key: "wins", label: "Siege", value: 2350 }], {
        id: 12345,
        name: "Prüfclub",
        tag: "PRF",
        ownerPlayerId: "Epic|abc|0",
        members: [{ playerId: "Epic|abc|0", name: "Eins", epicName: null, owner: true, mmr: 1400 }],
        verified: false,
        createdAt: null,
        averageMMR: 1400,
    });

    const saved = await model.ProfileOf(USER_A);
    check("Reward-Level wird gespeichert", saved?.level === 5 && saved?.wins === 7, JSON.stringify(saved));
    check("Karriere-Werte überleben als JSON", saved?.stats[0]?.value === 2350, JSON.stringify(saved?.stats));
    check("Der Ingame-Club überlebt als JSON", saved?.club?.tag === "PRF", JSON.stringify(saved?.club));

    // Ohne Club steht dort null - nicht ein leeres Objekt, das die Seite als
    // "Club vorhanden" lesen würde.
    await model.SaveProfile(USER_A, 5, 7, [{ key: "wins", label: "Siege", value: 2350 }], null);
    check("Kein Club heißt null", (await model.ProfileOf(USER_A))?.club === null);

    console.log("\n  — Clubs —");

    const clubs = client.clubs;

    check("Ohne Club gibt es keinen", (await clubs.Of(USER_A)) === null);

    const id = await clubs.Create("Prüfclub", "PRF", USER_A);

    check("Club wird angelegt", id > 0, String(id));
    check("Der Gründer ist gleich Mitglied", (await clubs.Of(USER_A))?.id === id);
    check("Und zwar als Leader", (await clubs.Members(id))[0]?.role === "leader");

    let duplicate: unknown;

    try {
        await clubs.Create("Anderer Name", "PRF", USER_B);
    } catch (error) {
        duplicate = error;
    }

    check("Zwei Clubs mit demselben Tag sind ausgeschlossen", duplicate !== undefined);

    await clubs.AddMember(id, USER_B);
    check("Mitglied kommt dazu", (await clubs.Members(id)).length === 2);

    const view = await clubs.View(USER_A, model);

    check("Die Ansicht bringt Name und Tag", view?.name === "Prüfclub" && view?.tag === "PRF");
    check("  und die Mitgliederzahl", view?.memberCount === 2, String(view?.memberCount));
    check("  und den Leader", view?.leaderId === USER_A);

    // Nur USER_A hat Ränge - der Schnitt ist also sein WTSI-Wert.
    const solo = WTSI(PlayerRanks.ToWTSI(await model.Of(USER_A)));

    check(
        "Durchschnitts-MMR rechnet nur mit bekannten Spielern",
        view?.averageMMR === Math.round(solo),
        `${view?.averageMMR} statt ${Math.round(solo)}`
    );

    check("Mitglied lässt sich entfernen", await clubs.RemoveMember(USER_B));
    check("Danach ist er raus", (await clubs.Members(id)).length === 1);

    await clubs.RemoveMember(USER_A);
    await clubs.Delete(id);

    check("Gelöschter Club ist weg", (await clubs.Find(id)) === null);
}

async function checkNotifications(client: BotClient): Promise<void> {
    console.log("\n  — Benachrichtigungen —");

    const model = client.notifications;

    check("Neues Postfach ist leer", (await model.Of(USER_A)).length === 0);
    check("Und hat nichts Ungelesenes", (await model.Unread(USER_A)) === 0);

    const id = await model.Push(USER_A, "group", "Gruppe geändert", "Du bist jetzt premium.", "/dashboard/admins");

    check("Meldung wird angelegt", typeof id === "number" && id > 0, String(id));

    const list = await model.Of(USER_A);

    check("Sie steht im Postfach", list.length === 1, `${list.length}`);
    check("Titel und Ziel kommen zurück", list[0]?.title === "Gruppe geändert" && list[0]?.link === "/dashboard/admins");
    check("Sie ist zunächst ungelesen", list[0]?.read_at === null);
    check("Der Zähler stimmt", (await model.Unread(USER_A)) === 1);

    await model.Push(USER_B, "info", "Für jemand anderen", "Nicht deine Meldung.");
    check("Fremde Meldung landet nicht im eigenen Postfach", (await model.Of(USER_A)).length === 1);

    check("Als gelesen markieren meldet die Anzahl", (await model.MarkRead(USER_A)) === 1);
    check("Danach ist nichts mehr ungelesen", (await model.Unread(USER_A)) === 0);
    check("Die Meldung selbst bleibt stehen", (await model.Of(USER_A)).length === 1);
    check("Zweites Markieren ändert nichts mehr", (await model.MarkRead(USER_A)) === 0);

    // Zu lange Texte dürfen nicht die Abfrage sprengen.
    await model.Push(USER_A, "info", "x".repeat(400), "y".repeat(900));
    check("Zu lange Texte werden gekürzt statt abzubrechen", (await model.Of(USER_A)).length === 2);

    check("Aufräumen entfernt nur das eigene Postfach", (await model.Clear(USER_A)) === 2);
    check("Das fremde bleibt", (await model.Of(USER_B)).length === 1);

    await model.Clear(USER_B);
}

async function checkCooldown(client: BotClient): Promise<void> {
    console.log("\n  — Sperrfrist auf Verknüpfungen —");

    const model = client.accounts;
    const window = 60_000;

    // Ohne Verknüpfung darf nichts sperren - sonst käme man nie zum ersten Mal rein.
    const before = await model.Cooldown(USER_A, "epic", window);
    check("Ohne Verknüpfung ist der Weg frei", before.open && before.until === null);

    await model.Link(USER_A, "epic", "acc-1", "MecryTv", true);

    const after = await model.Cooldown(USER_A, "epic", window);
    check("Direkt nach dem Verknüpfen gesperrt", !after.open, JSON.stringify(after));
    check("  mit Restzeit", after.waitMs > 0 && after.waitMs <= window, `${after.waitMs} ms`);
    check("  und einem Zeitpunkt", after.until !== null && !Number.isNaN(Date.parse(after.until)));

    const row = await model.On(USER_A, "epic");
    check("Anzeigename wird gespeichert", row?.display_name === "MecryTv", String(row?.display_name));
    check("Geprüftes Konto ist als geprüft vermerkt", row?.verified === 1, String(row?.verified));

    // Ein Fenster von 0 ist immer offen - so verhält sich der Entwicklungsmodus.
    const open = await model.Cooldown(USER_A, "epic", 0);
    check("Ohne Fenster ist immer offen", open.open);

    // Andere Plattform, andere Sperre.
    const steam = await model.Cooldown(USER_A, "steam", window);
    check("Die Sperre gilt je Plattform", steam.open);

    await model.Unlink(USER_A, "epic");
}

async function checkAccounts(client: BotClient): Promise<void> {
    console.log("\n  — Spieler-Accounts —");

    const model = client.accounts;

    await model.Link(USER_A, "epic", "MecryTv");
    await model.Link(USER_A, "steam", "76561198000000000");

    const linked = await model.Of(USER_A);
    check("Beide Plattformen sind verknüpft", linked.length === 2, String(linked.length));
    check("Neue Verknüpfung ist zunächst ungeprüft", linked.every((row) => row.verified === 0));

    // Dieselbe Plattform erneut: das ist ein Wechsel, keine zweite Zeile.
    await model.Link(USER_A, "epic", "MecryTv2");

    const after = await model.Of(USER_A);
    check("Eine Plattform bleibt eine Zeile", after.length === 2, String(after.length));
    check("Der Name ist ausgetauscht", after.find((row) => row.platform === "epic")?.account_id === "MecryTv2");

    check("Rückwärtssuche findet den Nutzer", (await model.Owner("steam", "76561198000000000")) === USER_A);
    check("Unbekannter Name findet niemanden", (await model.Owner("psn", "gibtsnicht")) === null);

    check("Verknüpfung lässt sich lösen", await model.Unlink(USER_A, "epic"));
    check("Zweites Lösen meldet ehrlich false", (await model.Unlink(USER_A, "epic")) === false);

}

async function checkMatches(client: BotClient, teamId: number): Promise<void> {
    console.log("\n  — Matches —");

    const model = client.matches;
    const other = await client.teams.Create(GUILD, "Gegner", "GGN");

    const first = await model.Schedule(GUILD, teamId, other, "3v3");
    check("Partie wird angesetzt", first > 0, String(first));
    check("Sie steht bei den anstehenden", (await model.Upcoming(GUILD)).some((row) => row.id === first));

    await model.Report(first, 3, 1);

    const done = await model.Find(first);
    check("Ergebnis ist eingetragen", done?.home_score === 3 && done?.away_score === 1);
    check("Zustand steht auf finished", done?.state === "finished", String(done?.state));
    check("Sie steht nicht mehr bei den anstehenden", !(await model.Upcoming(GUILD)).some((row) => row.id === first));
    check("Sie steht bei den gespielten", (await model.Recent(GUILD)).some((row) => row.id === first));

    const second = await model.Schedule(GUILD, other, teamId, "2v2");
    await model.Report(second, 2, 2);

    const third = await model.Schedule(GUILD, other, teamId, "3v3");
    await model.Report(third, 0, 4);

    const record = await model.RecordOf(teamId);
    check("Siege werden gezählt", record.wins === 2, JSON.stringify(record));
    check("Unentschieden wird gezählt", record.draws === 1, JSON.stringify(record));
    check("Niederlagen bleiben bei null", record.losses === 0, JSON.stringify(record));
    check("Tore stimmen", record.goalsFor === 9 && record.goalsAgainst === 3, JSON.stringify(record));

    const clean = await model.RecordOf(999999);
    check("Team ohne Partien hat eine Bilanz aus Nullen", clean.wins === 0 && clean.goalsFor === 0);
}

/**
 * Der Kern des Caches: gelesen wird höchstens einmal, und ein Schreibvorgang
 * macht das Gelesene ungültig. Beides wird hier nachgestellt, ohne auf die
 * Uhr zu warten.
 */
async function checkCache(client: BotClient): Promise<void> {
    console.log("\n  — Cache —");

    const service = client.databaseService;
    let loads = 0;

    const load = async (): Promise<number> => {
        loads++;

        return loads;
    };

    await service.Cached(TABLES.teams, "probe", load);
    await service.Cached(TABLES.teams, "probe", load);
    await service.Cached(TABLES.teams, "probe", load);

    check("Derselbe Schlüssel lädt nur einmal", loads === 1, `${loads} Ladevorgänge`);

    service.Bump(TABLES.teams);
    await service.Cached(TABLES.teams, "probe", load);

    check("Nach einem Schreibvorgang wird neu geladen", loads === 2, `${loads} Ladevorgänge`);

    // Eine andere Tabelle darf davon unberührt bleiben.
    let foreign = 0;

    await service.Cached(TABLES.accounts, "probe", async () => ++foreign);
    service.Bump(TABLES.teams);
    await service.Cached(TABLES.accounts, "probe", async () => ++foreign);

    check("Fremde Tabelle bleibt im Cache", foreign === 1, `${foreign} Ladevorgänge`);

    // null muss sich im Cache halten lassen, sonst fragt jede Abfrage nach einer
    // fehlenden Zeile die Datenbank erneut.
    let empty = 0;

    const nothing = async (): Promise<null> => {
        empty++;

        return null;
    };

    await service.Cached(TABLES.matches, "leer", nothing);
    const second = await service.Cached(TABLES.matches, "leer", nothing);

    check("Auch null bleibt im Cache", empty === 1 && second === null, `${empty} Ladevorgänge`);

    const stats = service.Stats();
    check("Trefferzähler läuft mit", stats.hits > 0 && stats.misses > 0, JSON.stringify(stats));

    // Und der Weg durch ein echtes Model: zweimal lesen, dann schreiben.
    const before = service.Stats().hits;

    await client.teams.OfGuild(GUILD);
    await client.teams.OfGuild(GUILD);

    check("Model liest beim zweiten Mal aus dem Cache", service.Stats().hits > before);

    const hits = service.Stats().hits;
    await client.teams.Create(GUILD, "Cache-Test");
    await client.teams.OfGuild(GUILD);

    check("Nach dem Anlegen wird wieder geladen", service.Stats().hits === hits, "es kam ein Treffer zu viel");
}

/**
 * Das Zeitraster der Aktivität. Eine Sprachsitzung über eine Stundengrenze
 * gehört anteilig in beide Stunden - rechnet das falsch, landen die Minuten in
 * der falschen Spalte der Heatmap. Braucht keine Datenbank.
 */
function checkSplit(): void {
    console.log("\n  — Aktivität: Zeitraster —");

    const over = SplitSpan(10 * HOUR_MS + 30 * 60_000, 11 * HOUR_MS + 30 * 60_000, HOUR_MS);

    check(
        "Eine Stunde über die volle Stunde teilt sich in zwei Hälften",
        over.length === 2 &&
            over[0]?.slot === 10 &&
            over[1]?.slot === 11 &&
            over.every((part) => part.ms === 30 * 60_000),
        JSON.stringify(over)
    );

    const inside = SplitSpan(5 * HOUR_MS + 1000, 5 * HOUR_MS + 61_000, HOUR_MS);

    check(
        "Innerhalb einer Stunde bleibt es ein Stück",
        inside.length === 1 && inside[0]?.ms === 60_000,
        JSON.stringify(inside)
    );

    const days = SplitSpan(0, 3 * DAY_MS, DAY_MS);

    check(
        "Drei Tage ergeben drei ganze Tage",
        days.length === 3 && days.every((part) => part.ms === DAY_MS),
        JSON.stringify(days)
    );
    check("Eine leere Spanne ergibt nichts", SplitSpan(100, 100, HOUR_MS).length === 0);
}

/**
 * Der Weg der Aktivität durch die Datenbank: zweimal schreiben muss addieren
 * statt überschreiben, und die Bestenlisten müssen nach der richtigen Spalte
 * sortieren.
 *
 * Die Prüfstunde liegt weit in der Vergangenheit - Stunde 400.000 ist im Jahr
 * 2015. So räumt das Prune am Ende garantiert nur Prüfdaten weg und fasst
 * echte Zahlen nicht an.
 */
async function checkActivity(client: BotClient): Promise<void> {
    console.log("\n  — Aktivität —");

    const model = client.activity;
    const hour = 400_000;
    const day = Math.floor(hour / 24);

    await model.Add(
        [{ guildId: GUILD, hour, messages: 3, voice: 10, joins: 1, leaves: 0 }],
        [{ guildId: GUILD, channelId: "111", day, messages: 3 }],
        [{ guildId: GUILD, userId: USER_A, day, messages: 3, voice: 10 }]
    );
    await model.Add(
        [{ guildId: GUILD, hour, messages: 2, voice: 5, joins: 0, leaves: 1 }],
        [{ guildId: GUILD, channelId: "111", day, messages: 2 }],
        [{ guildId: GUILD, userId: USER_B, day, messages: 1, voice: 30 }]
    );

    const rows = await model.Hours(GUILD, hour);
    const first = rows[0];

    check(
        "Zweimal schreiben addiert, statt zu überschreiben",
        rows.length === 1 && first?.messages === 5 && first?.voice === 15 && first?.joins === 1 && first?.leaves === 1,
        JSON.stringify(rows)
    );
    check("Die älteste Stunde sagt, seit wann gezählt wird", (await model.Since(GUILD)) === hour);

    const channels = await model.TopChannels(GUILD, day, 5);

    check(
        "Kanäle summieren über beide Schreibvorgänge",
        channels.length === 1 && channels[0]?.channel_id === "111" && Number(channels[0]?.messages) === 5,
        JSON.stringify(channels)
    );

    const chat = await model.TopMembers(GUILD, day, "messages", 5);
    const voice = await model.TopMembers(GUILD, day, "voice", 5);

    check(
        "Bestenliste Chat sortiert nach Nachrichten",
        chat.length === 2 && chat[0]?.user_id === USER_A,
        JSON.stringify(chat)
    );
    check("Bestenliste Voice sortiert nach Minuten", voice[0]?.user_id === USER_B, JSON.stringify(voice));

    const removed = await model.Prune(hour + 1, day + 1, day + 1);

    check("Aufräumen löscht die alten Zeilen", removed >= 4, String(removed));
    check("Danach ist nichts mehr da", (await model.Hours(GUILD, 0)).length === 0);
}

async function cleanup(client: BotClient): Promise<void> {
    const service = client.databaseService;

    // Reihenfolge zählt: matches zeigt auf teams, team_members hängt daran.
    await service.Write(`DELETE FROM \`${TABLES.matches}\` WHERE guild_id = ?`, [GUILD]);
    await service.Write(`DELETE FROM \`${TABLES.teams}\` WHERE guild_id = ?`, [GUILD]);
    await service.Write(`DELETE FROM \`${TABLES.settings}\` WHERE guild_id = ?`, [GUILD]);
    await service.Write(`DELETE FROM \`${TABLES.activity}\` WHERE guild_id = ?`, [GUILD]);
    await service.Write(`DELETE FROM \`${TABLES.channelActivity}\` WHERE guild_id = ?`, [GUILD]);
    await service.Write(`DELETE FROM \`${TABLES.memberActivity}\` WHERE guild_id = ?`, [GUILD]);
    await service.Write(`DELETE FROM \`${TABLES.accounts}\` WHERE user_id IN (?, ?)`, [USER_A, USER_B]);
    await service.Write(`DELETE FROM \`${TABLES.groups}\` WHERE user_id IN (?, ?)`, [USER_A, USER_B]);
    await service.Write(`DELETE FROM \`${TABLES.notifications}\` WHERE user_id IN (?, ?)`, [USER_A, USER_B]);
    await service.Write(`DELETE FROM \`${TABLES.clubMembers}\` WHERE user_id IN (?, ?)`, [USER_A, USER_B]);
    await service.Write(`DELETE FROM \`${TABLES.clubs}\` WHERE tag = ?`, ["PRF"]);
    await service.Write(`DELETE FROM \`${TABLES.ranks}\` WHERE user_id IN (?, ?)`, [USER_A, USER_B]);
    await service.Write(`DELETE FROM \`${TABLES.profiles}\` WHERE user_id IN (?, ?)`, [USER_A, USER_B]);

    const left = await service.One<{ total: number }>(
        `SELECT COUNT(*) AS total FROM \`${TABLES.teams}\` WHERE guild_id = ?`,
        [GUILD]
    );

    check("Prüfdaten sind wieder weg", Number(left?.total ?? 0) === 0, JSON.stringify(left));
}

async function main(): Promise<void> {
    const client = new BotClient();
    const service = client.databaseService;
    const { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER } = client.config;

    console.log(`\nZiel: ${DATABASE_USER}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}\n`);

    await checkOffline(client);
    checkSplit();

    if (!service.IsConfigured) {
        console.log(
            "\n⏭️  Keine Datenbank in der .env - die Prüfungen am lebenden Schema bleiben aus.\n" +
                "   DATABASE_HOST, DATABASE_NAME und DATABASE_USER setzen, Passwort in die .env.\n"
        );

        process.exit(failures > 0 ? 1 : 0);
    }

    if (!(await service.Connect())) {
        console.log("\n❌ Datenbank ist eingerichtet, aber nicht erreichbar - siehe Meldung oben.\n");

        process.exit(1);
    }

    try {
        await checkSchema(client);
        await checkGroups(client);
        await checkSettings(client);

        const teamId = await checkTeams(client);

        checkWTSI();
        await checkRanksAndClubs(client);
        await checkNotifications(client);
        await checkCooldown(client);
        await checkAccounts(client);
        await checkMatches(client, teamId);
        await checkCache(client);
        await checkActivity(client);
    } finally {
        console.log("\n  — Aufräumen —");

        await cleanup(client).catch((error) => check("Aufräumen lief durch", false, String(error)));
        await service.Close();
    }

    console.log(failures === 0 ? "\n✅ Alle Prüfungen bestanden.\n" : `\n❌ ${failures} Prüfung(en) fehlgeschlagen.\n`);

    process.exit(failures > 0 ? 1 : 0);
}

void main();
