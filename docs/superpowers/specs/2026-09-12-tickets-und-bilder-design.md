# Ticket System, Bildauswahl und Modul-Commands

Stand: 12.09.2026

Fünf Teile, in dieser Reihenfolge gebaut. Jeder läuft für sich und lässt sich
einzeln ausliefern; wer später kommt, baut auf dem auf, was vorher steht.

| # | Teil | Baut auf |
|---|---|---|
| 1 | Sidebar-Kategorien, Gallery als festes Modul | — |
| 2 | Gallery im Dashboard, Custom Images, Komprimierung | — |
| 3 | Message-Editor mit Live-Vorschau | 2 |
| 4 | Ticket-Kern | 3 |
| 5 | Discord-Commands (`/module`, `/ticket`) | 4 |

Transcripts und Live Chat stehen ausdrücklich **nicht** in diesem Dokument. Sie
kommen später und bekommen ein eigenes Spec.

---

## Fundament

### Migration `011_tickets.sql`

Drei Tabellen.

```sql
ticket_settings
  guild_id   VARCHAR(20) PRIMARY KEY
  config     JSON NOT NULL        -- Kontakt, Oberfläche, Rolle, Optionen,
                                  -- Aktionen, alle sechs Nachrichten
  created_at, updated_at

tickets
  id           BIGINT AUTO_INCREMENT PRIMARY KEY
  guild_id     VARCHAR(20)
  number       INT                -- fortlaufend je Server
  option_id    VARCHAR(32)
  opener_id    VARCHAR(20)
  channel_id   VARCHAR(20)        -- Team-Seite: Kanal oder Forum-Post
  dm_channel_id VARCHAR(20) NULL  -- nur bei ModMail
  claimed_by   VARCHAR(20) NULL
  status       ENUM('open','frozen','closed')
  priority     ENUM('low','normal','high') NULL
  members      JSON               -- nachträglich hinzugefügte User
  notes        JSON               -- Team-Notizen
  messages     INT DEFAULT 0
  reminder_at  DATETIME NULL
  created_at, closed_at
  UNIQUE (guild_id, number)
  INDEX (guild_id, opener_id, status)

ticket_blacklist
  guild_id, user_id  PRIMARY KEY (beide)
  reason, by, created_at
```

Mitglieder, Notizen und der Termin sind Spalten am Ticket, keine eigenen
Tabellen: sie werden immer zusammen mit dem Ticket gelesen und nie ohne es.
Drei Joins für Daten, die nie getrennt auftreten, wären reine Buchhaltung.

Der Medien-Tresor speichert nichts. Er liest die Anhänge beim Öffnen aus dem
Kanalverlauf.

`TABLES` in `src/constants/Database.ts` bekommt die drei Namen dazu.

### Termin-Erinnerung

`runnables/TicketReminders.ts` läuft minütlich und holt
`WHERE reminder_at <= NOW() AND status = 'open'`, meldet sich im Ticket und
setzt `reminder_at` auf `NULL`. Das `RunnableService`-Gerüst steht schon,
es kommt nur eine Datei dazu.

---

## Teil 1 — Sidebar-Kategorien

### Kategorien

Fünf Gruppen, in dieser Reihenfolge:

| Gruppe | Module |
|---|---|
| Rocket League | `rl-6mans` `lft` `teams` `clips` `matchups` |
| Community | `welcome` `apply` `reaction-roles` `levels` `giveaways` `polls` `voice-hub` |
| Support | `tickets` (mit `live-tickets`, `transcriptions`) |
| Moderation | `moderation` `automod` `logging` |
| Inhalte & Meldungen | `custom-message` `gallery` `twitch-notifier` `youtube-notifier` |

### Änderungen

`src/dashboard/client/constants/Modules.ts`

- `CATEGORIES: { id, name }[]` als neue Konstante, Reihenfolge = Anzeige
- `IModule` bekommt `category: string`
- `IModule` bekommt `always?: true` — trägt aktuell nur `gallery`

`src/dashboard/client/pages/Guild.ts`, `bindModules()`

- vor der Schleife je Kategorie eine Überschrift in `#setNav` hängen
- `paint()` blendet eine Überschrift aus, solange kein Modul darunter an ist
- ein `always`-Modul: Schalter bleibt an und gesperrt, Beschriftung „Immer an"

Die Modulübersicht unter *Module* bleibt flach — dort sind die Kategorien
ausdrücklich nicht gewünscht.

### Gallery als festes Modul

`src/constants/Modules.ts`

```ts
export const PERMANENT_MODULES = new Set<ModuleId>(["gallery"]);
```

`src/models/GuildSettings.ts`

- `Of()` mischt `PERMANENT_MODULES` immer in die zurückgegebene Liste
- `Toggle()` ignoriert ein Ausschalten eines festen Moduls

Damit muss keine andere Stelle davon wissen: wer `Of()` fragt, bekommt die
Galerie immer mitgeliefert. `DashboardApiModules` lehnt das Ausschalten
zusätzlich mit 400 ab, damit die Antwort erklärt, was passiert ist.

`npm run check:dashboard` prüft zusätzlich, dass jedes Modul eine Kategorie hat
und jede Kategorie mindestens ein Modul.

---

## Teil 2 — Gallery im Dashboard, Custom Images, Komprimierung

### Verkleinern

Neu: `src/utils/image.ts`

```ts
Shrink(buffer: Buffer, mime: string): Promise<{ buffer: Buffer; extension: string }>
```

- `image/gif` kommt unverändert zurück (Animation bleibt erhalten)
- alles andere: längste Kante auf **1920px**, `canvas.encode("webp", 80)`,
  Endung `.webp`
- Bilder, die schon kleiner als 1920px sind, werden trotzdem neu kodiert —
  WebP q80 ist fast immer kleiner als das Original
- schlägt das Dekodieren fehl, fliegt ein Fehler mit lesbarem Text

`@napi-rs/canvas` ist schon Dependency und kann WebP — kein neues Paket.

### GalleryService

- neu: `AddUpload(target, buffer, mime, fileName): Promise<IGalleryEntry>` — der Typ
  muss mit, `Shrink()` entscheidet daran über GIF oder WebP
- `AddImage(target, url, fileName)` bleibt wie es ist
- beide gehen durch ein privates `Store()`, das `Shrink()` aufruft

Dadurch werden auch Bilder aus dem Discord-Panel verkleinert, nicht nur die aus
dem Dashboard. `IGalleryService` bekommt `AddUpload` dazu.

### Routen

Alle unter `/dashboard/api/guild/:id/gallery`, dieselbe Rechteprüfung wie
`DashboardApiModules` (Session, `canManage`, Snowflake-Prüfung).

Zwei Dateien statt sieben: eine Lese-Route und eine Schreib-Route mit
Wildcard. Die Rechteprüfung steht damit einmal da statt siebenmal — und eine
Galerie-ID ist ein Pfad (`<guild>/<kategorie>/<datei>`), passt also ohnehin in
keinen Pfad-Parameter.

| Methode | Pfad | Body | Zweck |
|---|---|---|---|
| GET | `/gallery` | — | Kategorien, Unterkategorien, Bilder |
| POST | `/gallery/category` | `{ category, subcategory? }` | anlegen |
| POST | `/gallery/category/delete` | `{ category, subcategory? }` | löschen |
| POST | `/gallery/image` | rohe Bytes, Query `?category=&subcategory=&name=` | hochladen |
| POST | `/gallery/image/url` | `{ url, category, subcategory? }` | von https holen |
| POST | `/gallery/image/move` | `{ image, category, subcategory? }` | verschieben |
| POST | `/gallery/image/delete` | `{ image }` | löschen |

Der Upload kommt roh: der Browser schickt das `File`-Objekt als Body, Ziel und
Name stehen in der Query. Fastify bekommt dafür einen Content-Type-Parser für
`image/*`, der einen Buffer zurückgibt, Grenze 8 MB wie bisher. Ein
Multipart-Paket wäre eine Dependency für fünf Zeilen.

### Dashboard

Neu: `src/dashboard/client/pages/GuildGallery.ts` — die Verwaltungsansicht mit
denselben Funktionen wie `/gallery` in Discord: durchblättern, hochladen,
verschieben, löschen, Kategorien anlegen und löschen.

In **Teil 3** (nicht hier): `src/dashboard/client/layout/ImagePicker.ts` —
Bildauswahl mit drei Reitern. Sie entsteht erst dort, weil sie in Teil 2 keinen
Aufrufer hätte; die Routen und das Bildraster aus Teil 2 tragen sie dann schon.

- **Galerie** — Kategorien des Servers plus die Default-Bilder
- **Hochladen** — Datei wählen, wird verkleinert und in der Galerie abgelegt
- **URL** — https-Adresse, wird heruntergeladen, geprüft und abgelegt

Was Teil 2 dafür liefert: die Galerie-Routen und das Raster `.galgrid` / `.galtile`.

**Custom Images** landen in derselben Galerie, in der Kategorie `custom` des
Servers. Kein zweiter Bilderspeicher, und was ein Panel benutzt, steht sichtbar
in der Galerie statt versteckt daneben.

Die Karte in `guild.html` bekommt die Sektion `gallery`; die Leiste zeigt sie
immer, weil das Modul nicht abschaltbar ist.

---

## Teil 3 — Message-Editor mit Live-Vorschau

### Ein Datenformat

```ts
interface IMessageDoc {
    accent?: string;          // Akzentfarbe des Containers
    blocks: IMessageBlock[];
}

type IMessageBlock =
    | { type: "text";      body: string }
    | { type: "image";     images: string[] }      // Galerie-ID oder https-URL
    | { type: "separator"; big?: boolean; line?: boolean }
    | { type: "section";   body: string; thumbnail: string };
```

Genau das, was `ComponentV2Builder` kann, nichts darüber hinaus.

### Zwei Renderer

- `src/builder/MessageDoc.ts` — Dokument → `ComponentV2Builder` → Discord
- `src/dashboard/client/layout/MessagePreview.ts` — Dokument → HTML in
  Dashboard-Optik

Ein zweiter Renderer ist unvermeidbar: die Vorschau darf nicht bei jedem
Tastendruck den Bot fragen. Geteilt wird das Dokument, nicht die Darstellung.

### Platzhalter

`src/constants/Placeholders.ts` (Bot) und gespiegelt
`src/dashboard/client/constants/Placeholders.ts`. `npm run check:dashboard`
vergleicht beide Listen — dasselbe Verfahren, das schon für die Modulliste
läuft. Der Dashboard-Client kompiliert eigenständig (`rootDir: "client"`,
`types: []`) und kann nicht aus `src/` importieren; deshalb dieser Weg.

```
{user} {user.name} {user.id} {user.avatar}
{guild} {guild.id} {guild.icon} {guild.members}
{ticket.id} {ticket.option} {ticket.priority} {ticket.opened} {ticket.claimer}
{support.role}
{closer} {reason}
```

`src/utils/placeholders.ts` füllt sie bot-seitig, die Vorschau füllt sie aus
`/api/me` und den Server-Daten. `{ticket.id}` zeigt in der Vorschau `0042`.

Unbekannte Platzhalter bleiben unverändert stehen, statt zu verschwinden — ein
Tippfehler soll sichtbar sein.

### Die sechs Nachrichten

| Schlüssel | Wo sie landet |
|---|---|
| `panel` | im Server-Kanal, mit Buttons oder SelectMenu |
| `opened` | Eröffnung auf der Team-Seite |
| `dm` | Bestätigung an den User bei ModMail |
| `closed` | beim Schließen |
| `frozen` | beim Einfrieren |
| `blacklisted` | Absage bei gesperrtem User |

Jede Öffnungs-Option darf `opened` überschreiben. Fehlt die eigene Fassung,
gilt die allgemeine.

### Vorschau

Rechts neben dem Editor, im Dashboard-Stil (nicht als Discord-Nachbau), mit
echten Daten. Bei `opened` steht das Aktions-Menü darunter, gefüllt mit genau
den Aktionen, die gerade aktiviert sind — ein Schalter in der Aktionsliste
ändert die Vorschau sofort.

---

## Teil 4 — Ticket-Kern

### Zwei Schalter statt drei Modi

- **Kontakt**: `direkt` (User sitzt im Ticket) oder `modmail` (User in der DM,
  Bot leitet weiter)
- **Oberfläche**: `kanal` (Textkanal in einer Kategorie) oder `forum` (Post in
  einem Forum-Kanal)

Vier Kombinationen statt drei Sonderfällen. Der Code für „wo entsteht das
Ticket" steht damit einmal da statt zweimal, und ModMail bekommt die Forum-Tags
gratis mit.

### Öffnungs-Optionen

Serverweit dazu: **Limit offener Tickets je User** (Standard 1, 0 = ohne
Grenze) und **Löschfrist nach dem Schließen** (Standard aus; gesetzt, löscht
ein Lauf des Runnables den Kanal nach Ablauf).

Je Option: `id`, Name, Beschreibung, Emoji (Standard oder Server-Emoji),
Ziel (Kanal-Kategorie oder Forum-Tag), optional eigene Support-Rolle, optional
eigene `opened`-Nachricht.

Die Abbildung hängt an der Oberfläche:

- **Kanal**: jede Option bekommt ihre eigene Kanal-Kategorie
- **Forum**: alle Optionen teilen sich **ein** Forum, jede Option ist ein Tag

Das ist keine Bequemlichkeit. Discord kann Forum-Posts nicht zwischen Foren
verschieben, und „Ticket verschieben" muss funktionieren. Als Tag-Wechsel tut
es das.

### Öffnen

```
direkt:  Panel-Klick → Option (Button oder SelectMenu) → Ticket entsteht
         → opened-Nachricht + Aktions-Menü
modmail: DM an den Bot → Bot fragt per DM nach der Option → Team-Seite entsteht
         → dm-Nachricht an den User
```

Vor beidem dieselbe Prüfung, in dieser Reihenfolge:

1. Modul `tickets` an?
2. User auf der Blacklist? → `blacklisted`-Nachricht
3. offenes Ticket schon vorhanden? → Verweis darauf
4. Limit pro User erreicht?

### Die 15 Aktionen

Alle in **einem** SelectMenu unter der `opened`-Nachricht, gefiltert auf das,
was aktiviert ist. `close`, `claim`/`unclaim` und `add_user`/`remove_user`
lassen sich nicht abschalten. Ein Blättern braucht das Menü nie: 15 Aktionen
passen unter Discords Grenze von 25 Einträgen.

| Aktion | Kanal | Forum | Bei ModMail zusätzlich |
|---|---|---|---|
| `close` | Rechte weg, `closed-` davor, optional Löschfrist | Post schließen + sperren, Tag *Geschlossen* | Abschluss-DM an den User |
| `claim` / `unclaim` | `claimed_by`, Name in den Kanalnamen | dito + Tag | — |
| `add_user` / `remove_user` | Rechte-Overwrite | Thread-Mitglied | wirkt auf die Team-Seite; der User bleibt in der DM |
| `transfer` | Kanal in die Kategorie der Ziel-Option | Tag tauschen | — |
| `priority` | Zeichen vor den Kanalnamen: 🟢 niedrig · 🟡 normal · 🔴 hoch | Forum-Tag je Stufe | — |
| `anonymous_mode` | Webhook mit Team-Alias | Webhook im Post | Relay zeigt den Alias statt des Staff-Namens |
| `media_vault` | Anhänge aus dem Verlauf als Galerie | dito | Anhänge beider Seiten |
| `slowmode` | `setRateLimitPerUser` | dito | bremst den Relay-Takt |
| `tldr_summary` | Faktenkarte aus der Datenbank | dito | — |
| `staff_note` | Modal → `notes` JSON, nur fürs Team | dito | geht nie ins Relay |
| `freeze` | `SendMessages` für den Ersteller weg | Post sperren | Relay stoppt, User bekommt einen Hinweis |
| `blacklist` | Eintrag + Ticket schließen | dito | Absage-DM |
| `schedule_meeting` | `reminder_at`, Runnable meldet sich | dito | Erinnerung auch per DM |

Die Zusammenfassung (`tldr_summary`) ist eine Faktenkarte aus der Datenbank:
Ersteller, Option, Priorität, offen seit, wer geclaimt hat, Anzahl Nachrichten,
beteiligte User, Team-Notizen. Kein Sprachmodell, keine Ticket-Inhalte, die den
Server verlassen.

### ModMail-Relay

`events/tickets/ModMailRelay.ts` hängt an `messageCreate`:

- DM an den Bot, offenes Ticket vorhanden → in die Team-Seite spiegeln
- Nachricht auf der Team-Seite, kein Bot, keine Notiz → in die DM spiegeln
- Anhänge gehen mit, Absender steht dabei (oder der Alias bei `anonymous_mode`)
- eingefroren → Relay stoppt in Richtung Team
- DM ohne offenes Ticket → Öffnungs-Weg starten

### Neue Dateien

```
models/           Tickets.ts · TicketSettings.ts · TicketBlacklist.ts
services/         TicketService.ts          ← jede Aktion genau einmal
builder/          TicketPanel.ts            ← Panel, Eröffnung, Aktions-Menü
events/tickets/   TicketHandler.ts          ← Buttons, Menüs, Modals
                  ModMailRelay.ts
runnables/        TicketReminders.ts
database/migrations/011_tickets.sql
```

Dashboard-Routen und Discord-Wizard rufen beide `TicketService` auf. Die
Aktionen stehen einmal da, nicht zweimal.

### Dashboard-Seite

`src/dashboard/client/pages/GuildTickets.ts` — Kontakt und Oberfläche,
Support-Rolle, Ziel-Kanäle, Öffnungs-Optionen (anlegen, sortieren, löschen),
Aktionen an/aus, die sechs Nachrichten im Editor aus Teil 3, „Panel senden" mit
Kanalauswahl. Rechts durchgehend die Live-Vorschau.

---

## Teil 5 — Discord-Commands

### `/module`

```
/module an     <modul>    Autocomplete über MODULE_IDS
/module aus    <modul>
/module liste             alle mit Häkchen
```

`ManageGuild` vorausgesetzt, dieselbe Prüfung wie im Dashboard. Feste Module
(`gallery`) lehnen `aus` mit einem Hinweis ab.

### `/ticket`

```
/ticket setup          öffnet den Wizard
/ticket panel senden   [kanal]
```

Der Wizard ist ein Components-V2-Panel (`builder/TicketSetupPanel.ts`) mit
denselben Schritten wie die Dashboard-Seite: Kontakt, Oberfläche, Support-Rolle,
Ziel-Kategorie oder Forum, Öffnungs-Optionen anlegen, Aktionen an/aus, Panel
senden. Nachrichten-Text nur als Kurzform per Modal — der volle Editor mit
Blöcken und Bildern bleibt im Dashboard.

Beide Wege schreiben über `TicketSettings` in dieselbe Zeile.

---

## Was bewusst fehlt

- **Transcripts** — `close` speichert kein Protokoll. Eigenes Spec.
- **Live Chat** — eigenes Spec.
- **KI-Zusammenfassung** — die Faktenkarte steht, der Platz daneben ist frei.
- **Tests** — das Projekt hat kein Framework, nur `npm run check:*`-Skripte.
  Teil 1 und 2 erweitern `check:dashboard`, Teil 4 bekommt ein
  `check:tickets`, das Öffnen, Claim, Transfer und Schließen gegen eine
  Testdatenbank durchspielt.

## Offene Punkte

Keine. Alle Entscheidungen sind im Gespräch vom 12.09.2026 gefallen.
