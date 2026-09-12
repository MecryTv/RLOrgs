# Datenbank

**MariaDB**, angebunden über den offiziellen Connector `mariadb` mit Verbindungspool. Darüber liegen ein Basis-Model mit CRUD, ein Cache und ein Migrationslauf, der beim Start selbst nachzieht, was noch fehlt.

**Der Bot läuft auch ohne Datenbank.** Ist sie nicht eingerichtet oder nicht erreichbar, steht das im Log, `databaseService.Ready` bleibt `false`, und alles, was Daten braucht, sagt das — statt dass der Start scheitert.

---

## Einrichten

Am einfachsten über Docker — MariaDB und phpMyAdmin stehen dann mit einem Befehl, siehe [Docker.md](Docker.md):

```bash
docker compose up -d
```

Der Container legt Datenbank und Nutzer beim ersten Start selbst aus der `.env` an. Die folgenden Schritte braucht nur, wer eine eigene MariaDB betreibt.

### 1. Datenbank und Nutzer anlegen

```sql
CREATE DATABASE rlnexus CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'rlnexus'@'localhost' IDENTIFIED BY 'DEIN_PASSWORT';
GRANT ALL PRIVILEGES ON rlnexus.* TO 'rlnexus'@'localhost';
FLUSH PRIVILEGES;
```

`ALL PRIVILEGES` auf **diese eine** Datenbank, nicht auf `*.*` — der Bot legt Tabellen an, hat aber außerhalb seines Schemas nichts zu suchen.

### 2. Zugangsdaten eintragen

Alles in die `.env` — eine `config.json` gibt es nicht mehr:

```bash
DATABASE_HOST="localhost"
DATABASE_PORT="3306"
DATABASE_NAME="rlnexus"
DATABASE_POOL_LIMIT="5"
DATABASE_USER="rlnexus"
DATABASE_PASSWORD="DEIN_PASSWORT"
```

Fehlt `DATABASE_HOST`, `DATABASE_NAME` oder `DATABASE_USER`, wird gar nicht erst verbunden.

### 3. Prüfen

```bash
npm run check:db
```

Verbindet, führt die Migrationen aus, geht jedes Model einmal durch (anlegen, lesen, ändern, löschen), prüft den Cache und räumt hinter sich auf. Ohne eingerichtete Datenbank laufen nur die Prüfungen, die ohne sie auskommen; ist sie eingerichtet, aber nicht erreichbar, endet der Lauf mit Exit-Code `1`.

---

## Schema

Angelegt wird es beim Start aus `src/database/migrations/*.sql`, in der Reihenfolge der Dateinamen.

| Tabelle | Wofür | Schlüssel |
|---|---|---|
| `dashboard_groups` | Wer im Dashboard Administrator, Partner oder Premium ist | `user_id` |
| `notifications` | Meldungen, die einen Nutzer betreffen | `id` |
| `player_ranks` | Letzter Rang je Spieler und Playlist, samt Peak | `user_id` + `playlist` |
| `player_profiles` | Reward-Level, Karriere-Werte und der Ingame-Club je Spieler | `user_id` |
| `clubs` | Eigene Clubs des Bots — **nicht** die aus dem Spiel, siehe [Prime.md](Prime.md) | `id` |
| `club_members` | Wer in welchem Club ist. Ein Spieler, ein Club | `user_id` |
| `guild_settings` | Aktive Module, Rang-Rollen, Kanäle je Server | `guild_id` |
| `teams` | Teams eines Servers, `active = 0` heißt stillgelegt | `id` |
| `team_members` | Wer in welchem Team ist, mit Rolle | `team_id` + `user_id` |
| `player_accounts` | Discord-Nutzer ↔ Epic-Konto, mit Sperrfrist. Das ENUM kennt weiterhin fünf Plattformen, benutzt wird nur `epic` (Migration 007) | `user_id` + `platform` |
| `matches` | Partien mit Ergebnis, Playlist und Zustand | `id` |
| `guild_activity` | Nachrichten, Voice-Minuten, Beitritte und Abgänge je Server und Stunde — nur Zahlen, siehe [Activity.md](Activity.md) | `guild_id` + `hour` |
| `channel_activity` | Nachrichten je Kanal und Tag | `guild_id` + `day` + `channel_id` |
| `member_activity` | Nachrichten und Voice-Minuten je Mitglied und Tag — nach 14 Tagen gelöscht | `guild_id` + `day` + `user_id` |
| `schema_migrations` | Welche Migration schon gelaufen ist | `name` |

**Discord-IDs stehen als `VARCHAR(20)` da, nicht als `BIGINT`.** Gerechnet wird mit ihnen nie, durch JSON gereicht ständig — und dort verliert eine 64-Bit-Zahl in JavaScript die letzten Stellen. `ascii_bin`, weil eine Snowflake nur Ziffern enthält und der Vergleich exakt sein soll.

Ein gelöschtes Team nimmt seine Mitglieder mit (`ON DELETE CASCADE`), seine Partien aber nicht (`ON DELETE SET NULL`) — das Ergebnis bleibt, es steht dann nur ohne Team da. Deshalb legt `Team.Archive()` ein Team still, statt es zu löschen.

### Eine Migration hinzufügen

Neue Datei mit fortlaufender Nummer, etwa `002_seasons.sql`. Beim nächsten Start läuft sie einmal und wird in `schema_migrations` vermerkt.

> **MariaDB committet bei DDL sofort.** Eine Migration lässt sich nicht zurückrollen: bricht sie in der Mitte ab, ist der erste Teil schon da und die Datei gilt als *nicht* gelaufen. Deshalb gehört in eine Datei eine zusammenhängende Änderung — und `CREATE TABLE IF NOT EXISTS` statt `CREATE TABLE`, damit ein zweiter Anlauf durchkommt.

> **Eine ausgeführte Migration wird nie mehr angefasst.** Wer eine Tabelle nachträglich in eine bereits gelaufene Datei schreibt, hat sie in seiner eigenen Datenbank — überall sonst gilt die Datei als „durch" und die Tabelle fehlt. Nachträge kommen in eine **neue** Datei. (Genau das ist hier einmal passiert, daher `005_player_profiles.sql`.)

Der Migrationslauf benutzt eine eigene Verbindung mit `multipleStatements`. Der Pool im Betrieb bleibt bewusst ohne diese Option, damit dort niemals zwei Anweisungen in einem Aufruf landen können.

---

## Models

Ein Model je Tabelle, alle hängen am `BotClient` — Befehle, Events und Routen benutzen also dieselbe Instanz und damit denselben Cache.

```ts
client.groups        // DashboardGroups
client.notifications // Notifications
client.ranks         // PlayerRanks
client.clubs         // Clubs
client.settings   // GuildSettings
client.teams      // Team (samt Mitgliedern)
client.accounts   // PlayerAccount
client.matches    // Match
client.activity   // Activity (zählt die Server-Aktivität mit)
```

Alle erben von `Model<TRow>` (`src/structures/Model.ts`):

| Methode | Was sie tut |
|---|---|
| `Find(...id)` | Eine Zeile am Primärschlüssel, über den Cache |
| `Where(match, order?)` | Alle Zeilen zu einer Bedingung, über den Cache |
| `Count(match?)` | Anzahl, über den Cache |
| `Insert(row)` | Anlegen, gibt `insertId` zurück |
| `Upsert(row, update)` | Anlegen oder ändern, je nachdem ob es die Zeile gibt |
| `Update(id, patch)` | Ändern |
| `Delete(...id)` | Löschen |
| `Forget()` | Cache dieser Tabelle wegwerfen |

**Tabellen- und Spaltennamen kommen ausschließlich aus dem Code, Werte ausschließlich als Parameter.** Es wird nirgends SQL aus einer Eingabe zusammengesetzt.

Darüber hinaus haben die Models das, was ihre Tabelle wirklich braucht:

```ts
// Gruppen - vergeben wird das sonst unter /dashboard/admins
await client.groups.Grant(userId, "premium", vonWem, "Frühbucher");
const gruppe = await client.groups.Of(userId);   // "premium" | null
await client.groups.Revoke(userId);

// Einstellungen: fehlt die Zeile, kommen Standardwerte - nie null.
const settings = await client.settings.Of(guildId);
await client.settings.Toggle(guildId, "queues", true);

// Teams samt Mitgliedern
const id = await client.teams.Create(guildId, "Ascension", "ASC");
await client.teams.AddMember(id, userId, "captain");
const meine = await client.teams.TeamsOf(guildId, userId);

// Benachrichtigungen - Push wirft nie, eine Meldung ist Beiwerk
await client.notifications.Push(userId, "group", "Titel", "Text", "/dashboard");
const offen = await client.notifications.Unread(userId);

// Ränge: gespeichert wird der letzte Stand, der Peak wächst mit
await client.ranks.Snapshot(userId, profile.ranks);
const alter = await client.ranks.AgeOf(userId);   // ms seit dem letzten Stand

// Clubs samt Durchschnitts-MMR nach WTSI
const club = await client.clubs.View(userId, client.ranks);

// Konten samt Sperrfrist
await client.accounts.Link(userId, "epic", accountId, "MecryTv", true);
const sperre = await client.accounts.Cooldown(userId, "epic", LINK_COOLDOWN);
const wer = await client.accounts.Owner("steam", "76561198000000000");

// Partien und Bilanz - die Bilanz rechnet SQL, nicht der Bot
const match = await client.matches.Schedule(guildId, heim, gast, "3v3");
await client.matches.Report(match, 3, 1);
const bilanz = await client.matches.RecordOf(heim);
```

`ModulesOf()` und `CountsOf()` nehmen **mehrere** Server auf einmal — das Dashboard baut damit seine ganze Serverliste aus zwei Abfragen statt aus einer je Karte.

---

## Cache

Ein `LRUCache` vor allen lesenden Model-Methoden. 5000 Einträge, 60 Sekunden.

**Ungültig gemacht wird über eine Version je Tabelle.** Jeder Cache-Schlüssel trägt sie:

```
teams:3:where:guild_id:1162553851187040326:`name` ASC
      ↑ Version der Tabelle
```

Ein Schreibvorgang zählt die Version hoch. Damit sind alle alten Einträge auf einen Schlag unerreichbar, ohne dass jemand sie einzeln suchen und löschen müsste — die verwaisten wirft der LRU von selbst raus.

> **Was das kostet:** ein Schreibvorgang wirft auch die Einträge anderer Server weg. Bei diesem Aufkommen ist das billiger als die Buchhaltung, die nötig wäre, um es genauer zu treffen. Wird viel geschrieben, führt man die Version pro Server statt pro Tabelle — das ist die eine Zeile in `DatabaseService.Bump()`.

Der Cache ist eine **Abkürzung, kein Speicher**: er darf jederzeit leer sein, und nichts hängt davon ab, dass ein Eintrag noch da ist. `Stats()` gibt Treffer, Fehlgriffe und Größe zurück.

Wer an den Models vorbei schreibt (rohes `Write()`), muss selbst `Bump()` aufrufen — sonst steht bis zu 60 Sekunden lang der alte Stand da.

---

## Ohne Datenbank

| Was | Verhalten |
|---|---|
| Bot-Start | Läuft durch. Im Log steht, was fehlt |
| `databaseService.Ready` | `false` |
| `Query`, `Write`, `Transaction` | Werfen `DatabaseUnavailable` |
| Dashboard-Karten | Zeigen `0` Teams und keine Module, die Seite bleibt heil |

`DatabaseUnavailable` ist ein eigener Fehlertyp, damit Aufrufer den Fall von einem echten SQL-Fehler unterscheiden können.

Ein Ausfall **im Betrieb** ist damit nicht abgedeckt: `Ready` bleibt dann `true` und die Abfragen laufen in Treiberfehler. Der Pool baut die Verbindung von selbst wieder auf, sobald die Datenbank zurück ist.

---

## Aufbau

```
src/database/migrations/001_init.sql   Schema
src/services/DatabaseService.ts        Pool, Abfragen, Transaktionen, Migrationen, Cache
src/structures/Model.ts                Basis-Model mit CRUD über den Cache
src/models/DashboardGroups.ts          Dashboard-Gruppen
src/models/Notifications.ts            Postfach je Nutzer
src/models/GuildSettings.ts            Einstellungen je Server
src/models/Team.ts                     Teams und ihre Mitglieder
src/models/PlayerAccount.ts            Verknüpfte Spielerkonten
src/models/Match.ts                    Partien und Bilanz
src/constants/Database.ts              Tabellennamen, Plattformen, Playlists, Cache-Grenzen
src/scripts/CheckDatabase.ts           npm run check:db
```
