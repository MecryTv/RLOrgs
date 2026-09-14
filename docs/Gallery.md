# Gallery

Bildverwaltung für den Bot: Dateien liegen auf der Platte, ein Fastify-Server liefert sie unter einer öffentlichen URL aus.

Zugriff überall über den Client: `this.client.galleryService` (in Commands und Events), bzw. `client.galleryService`.

---

## Die Bausteine

| Datei | Aufgabe |
|---|---|
| `src/commands/admin/Gallery.ts` | Der einzige Command — öffnet das Panel |
| `src/services/GalleryService.ts` | Kategorien und Bilder lesen, anlegen, verschieben, löschen |
| `src/Server.ts` + `src/routes/Images.ts` | Liefert `src/images` unter `/images/*` aus |
| `src/builder/GalleryPanel.ts` | Zeichnet das `/gallery`-Panel, hält dessen Zustand |
| `src/events/gallery/GalleryHandler.ts` | Bedient das Panel (Buttons, Selects, Modal) |
| `src/constants/Gallery.ts` | Pfad-Auflösung, Sanitizing, Host-Filter, `MAX_IMAGE_BYTES` — ohne Abhängigkeiten |
| `src/utils/image.ts` | `Shrink()` — verkleinert jedes neue Bild, bevor es auf die Platte kommt |
| `src/routes/DashboardApiGallery.ts` + `DashboardApiGalleryEdit.ts` | Lesen und Schreiben fürs Dashboard |
| `src/dashboard/client/pages/GuildGallery.ts` | Die Galerie-Seite im Dashboard |

---

## Ablauf beim Start

1. `BotClient.Init()` startet den `Server` sofort.
2. `galleryService.Initialize()` legt `src/images/default` und `src/images/privacy` an, falls sie fehlen.

Mehr passiert beim Start nicht. **Der Ordner ist der Bestand** — jeder Lesezugriff geht direkt auf die Platte, für die mitgelieferten Bilder genauso wie für Guild-Uploads. Deshalb gibt es keinen zweiten Codepfad für Default gegen Custom und nichts, was mit dem Dateisystem auseinanderlaufen könnte.

---

## Wo die Bilder liegen

```
src/images/
├── default/                    ← kommt mit dem Repo, schreibgeschützt
│   └── rocketleague/
│       ├── logo.png
│       └── ranks/
│           └── gc.png
├── privacy/                    ← kommt mit dem Repo, für die Commands unsichtbar
│   └── Welcome_Card.png
└── 1162553851187040326/        ← eine Guild-ID, per Upload gefüllt
    └── memes/
        └── katze.png
```

Genau **zwei Ebenen**: Kategorie und optional eine Unterkategorie. Tiefer wird nicht gescannt.

`privacy/` fällt aus diesem Schema heraus: der Ordner wird **nicht** gescannt und taucht im Panel nicht auf.
Er ist für feste Bot-Bilder da, die kein Nutzer über die Gallery-Commands sehen oder löschen soll.

Die `.gitignore` hält es so, dass die mitgelieferten Bilder im Repo landen und Guild-Uploads nicht:

```
/src/images/*
!/src/images/default
!/src/images/privacy
```

`GALLERY_ROOT` wird über `process.cwd()` aufgelöst, nicht über `__dirname` — sonst zeigte der Pfad im Build nach `dist`. Der Bot muss also aus dem Projekt-Root gestartet werden (`npm run dev` / `npm start`), und beim Deploy muss `src/images` mit auf den Server.

### Die ID eines Bildes

Die ID ist der Pfad unterhalb von `src/images`:

```
1162553851187040326/memes/katze.png
1162553851187040326/memes/katzen/grau.png
default/rocketleague/ranks/gc.png
```

Sie ist damit ohne Index eindeutig und lässt sich aus dem Panel zurückgeben. `ParseId()` prüft sie beim Zurücklesen gegen dieselben Regeln wie ein Upload: gültiger Scope, erlaubte Endung, kein `..`.

`guildId` ist entweder eine Snowflake oder `"default"`.

Eine **leere** Kategorie ist einfach ein leerer Ordner — deshalb braucht es keine eigene Kategorien-Liste neben den Bildern.

---

## Der Command

Genau einer: **`/gallery`** in `src/commands/admin/Gallery.ts`, `Administrator` vorausgesetzt. Er öffnet das Panel, alles Weitere passiert dort — ansehen, blättern, hochladen, verschieben, löschen, Kategorien anlegen und entfernen.

Ein Panel statt sechs Commands, weil die Optionen ohnehin voneinander abhingen: erst die Kategorie, dann der Unterordner, dann das Bild. Ein Slash-Command muss dafür jedes Mal komplett neu ausgefüllt werden, das Panel behält den Ort einfach bei.

---

## Das Panel

`/gallery` schickt eine ephemere ComponentV2-Nachricht, die sich bei jedem Klick selbst neu zeichnet.

```
🖼️ | Galerie
⭐ Server › rocketleague › ranks
✅ 4 Bild(er) hochgeladen
────────────────────────────
[ Media-Galerie: bis zu 10 Bilder ]
12 Bild(er) · Seite 1 von 2
────────────────────────────
📁 Kategorie wählen...        ▾
📂 Unterordner wählen...      ▾
[◀️ Zurück] [▶️ Weiter]
[⬆️ Hochladen] [🗑️ Bilder löschen] [📦 Verschieben] [🔄 Aktualisieren]
[➕ Kategorie anlegen] [➖ Kategorie löschen]
```

### Zustand

Der Zustand liegt **im Speicher**, nicht in der customId — die ist auf 100 Zeichen begrenzt und liefe mit Guild-ID, Kategorie, Unterordner und Seite über.

```ts
import { PanelStates, NewPanelState, RenderPanel } from "../builder/GalleryPanel";

const state = NewPanelState(interaction.guildId);
const view = await RenderPanel(client, state);

// Der Schlüssel ist die Nachrichten-ID - nur so findet der Handler den Zustand wieder
PanelStates.set(message.id, state);
```

`PanelStates` ist eine `LRUCache` mit 200 Einträgen und 30 Minuten TTL. Ein vergessenes Panel verfällt von selbst, ein aktives wird bei jeder Interaktion neu geschrieben. Nach einem Neustart oder Ablauf antwortet der Handler mit „Panel abgelaufen".

### Modi

| Modus | Was passiert |
|---|---|
| `browse` | Blättern, navigieren, Aktionen starten |
| `delete` | Multi-Select über bis zu 25 Bilder, dann Bestätigen |
| `move` | Erst Bild wählen, dann zum Zielordner navigieren und „📥 Hierher verschieben" |

Verschieben nutzt bewusst die normale Navigation als Zielauswahl, statt ein eigenes Menü zu bauen.

### Multi-Upload

**⬆️ Hochladen** setzt das Panel auf Warten und sammelt **eine** Nachricht aus dem Kanal (90 Sekunden). Es zählt beides: Anhänge (Discord erlaubt 10 pro Nachricht) und `https://`-Links im Text, beliebig gemischt. Jede Quelle läuft einzeln durch `AddImage()` — eine kaputte bricht den Rest nicht ab, sie landet in der Übersprungen-Zählung. Die Upload-Nachricht wird danach gelöscht.

### customIds

Alles unter dem Präfix `gallery:panel`:

```
gallery:panel:cat | :sub | :pick          Select-Menüs
gallery:panel:prev | :next                Blättern
gallery:panel:upload | :delete | :move    Aktion starten
gallery:panel:confirm | :cancel           Aktion abschliessen
gallery:panel:movehere                    Ziel bestätigen
gallery:panel:newcat | :delcat            Kategorien
gallery:panel:refresh                     Neu zeichnen
gallery:panel:newcat:<messageId>          Modal
```

Der `GalleryHandler` reagiert **nur** auf dieses Präfix. Eigene Buttons brauchen ein anderes — sonst beantwortet der Handler sie mit, und Discord meldet `40060 Interaction has already been acknowledged`.

---

## Der Service

| Methode | Gibt zurück |
|---|---|
| `GetCategories(guildId, { requireImages })` | Hauptkategorien der Guild **und** aus `default` |
| `GetSubcategories(guildId, category, { requireImages })` | Unterordner einer Kategorie |
| `GetImages(target)` | Alle Bilder eines Ordners, nach Dateiname sortiert |
| `GetImage(id)` | Ein Bild über seine ID, oder `null` |
| `Attach(images)` | `{ media, files }` für eine Nachricht (siehe unten) |
| `CreateCategory(target)` | `boolean` — `false`, wenn es sie schon gibt |
| `DeleteCategory(target)` | Anzahl gelöschter Bilder |
| `AddImage(target, url, fileName?)` | Den fertigen `IGalleryEntry`, **wirft** bei Problemen |
| `AddUpload(target, buffer, mime, fileName)` | Dasselbe für rohe Bytes aus dem Dashboard |
| `Overview(guildId)` | `{ categories, images }` — alles auf einmal, auch leere Alben |
| `MoveImage(id, folder)` | `boolean` |
| `DeleteImage(id)` | `boolean` |

`requireImages` ist standardmäßig `true` und blendet leere Ordner aus. Für Upload- und Verwaltungs-UIs auf `false` setzen, sonst siehst du den Ordner nicht, den du gerade angelegt hast.

### Verkleinern

`AddImage` und `AddUpload` laufen beide durch ein privates `Store()`, und das ruft `Shrink()` — jedes neue Bild wird verkleinert, egal ob es aus Discord oder dem Dashboard kommt:

- längste Kante höchstens **1920 px**, gespeichert als **WebP** (Qualität 80)
- ein echtes **GIF** (Bytes beginnen mit `GIF8`) bleibt unverändert, damit die Animation erhalten bleibt
- Obergrenze **8 MB** (`MAX_IMAGE_BYTES`) vor dem Verkleinern

Ein zweites Bild mit demselben Namen überschreibt nichts: `Store()` schreibt mit `flag: "wx"` und hängt bei einem vergebenen Namen `-2`, `-3` … an.

### Ein Bild

```ts
interface IGalleryEntry {
    guildId: string;          // Snowflake oder "default"
    category: string;
    subcategory: string | null;
    file: string;             // "gc.png"

    id: string;               // "default/rocketleague/ranks/gc.png"
    url: string;              // https://dashboard.nexus-emb.de/images/…/gc.png
    path: string;             // "Ascension/rocketleague/ranks/gc.png"  (mit Guild-Namen)
    shortPath: string;        // "rocketleague/ranks/gc.png"            (ohne Scope)
}
```

Als **Select-Wert** taugt die `id` nicht — Discord begrenzt Werte auf 100 Zeichen, und Scope, Kategorie, Unterordner und Dateiname zusammen kommen darüber. Die Auswahlmenüs schicken deshalb nur den Dateinamen; `GalleryHandler.IdFor()` setzt daraus wieder die volle ID zusammen, solange der State noch auf den Quellordner zeigt.

### Beispiele

```ts
// Alle Bilder eines Ordners
const images = await this.client.galleryService.GetImages({
    guildId: interaction.guildId,
    category: "rocketleague",
    subcategory: "ranks",
});
```

```ts
// Hochladen - wirft mit einer Meldung, die direkt an den Nutzer gehen kann
try {
    const image = await this.client.galleryService.AddImage(
        { guildId: interaction.guildId, category: "memes", subcategory: null },
        attachment.url,
        attachment.name
    );
} catch (error) {
    // "Nur https-URLs werden akzeptiert." / "Bild ist größer als 8 MB." / …
}
```

```ts
// Kategorie anlegen (nur in der eigenen Guild, nie in "default")
const created = await this.client.galleryService.CreateCategory({
    guildId: interaction.guildId,
    category: "memes",
    subcategory: "katzen",
});
```

---

## Bilder in eine Nachricht bekommen

**Nicht** `image.url` direkt in `.gallery()` stecken. Im Dev-Modus zeigt die URL auf `localhost`, und das kann Discord nicht laden — die Galerie bliebe leer.

```ts
const { media, files } = this.client.galleryService.Attach(images);

await interaction.reply({
    ...new ComponentV2Builder()
        .title("🖼️ | Galerie")
        .separator()
        .gallery(...media)
        .toMessage({ ephemeral: true }),
    files,
});
```

`Attach()` liefert in Produktion die echten URLs und `files: []`, im Dev-Modus `attachment://`-URLs plus die passenden `AttachmentBuilder`. Der aufrufende Code merkt davon nichts.

Beim **Bearbeiten** einer Nachricht zusätzlich `attachments: []` mitgeben, sonst sammeln sich die Anhänge der vorherigen Seite an:

```ts
await interaction.update({ ...view, flags: MessageFlags.IsComponentsV2, attachments: [] });
```

---

## Das Dashboard

Die Sektion `#gallery` auf der Serverseite (`/guild/<id>/gallery`) kann dasselbe wie das Panel: Alben und Unteralben anlegen und löschen, Bilder hochladen, von einer URL holen, verschieben und löschen. Das Modul ist fest (`PERMANENT_MODULES`) und steht deshalb immer in der Leiste.

| Methode | Pfad unter `/api/guild/:id/gallery` | Body |
|---|---|---|
| GET | — | — liefert `Overview()` |
| POST | `/category` · `/category/delete` | `{ category, subcategory? }` |
| POST | `/image` | rohe Bytes, `Content-Type: image/*`, Ziel und Name in der Query |
| POST | `/image/url` | `{ url, category, subcategory? }` |
| POST | `/image/move` | `{ image, category, subcategory? }` |
| POST | `/image/delete` | `{ image }` |

Beide Routen prüfen Sitzung und „Server verwalten". Schreibende Anfragen nehmen nur `application/json` bzw. `image/*` an (CSRF), und nur `/image` darf 8 MB Body tragen — der Bild-Parser in `Server.ts` hat absichtlich kein eigenes Limit.

**Hochladen im Browser:** Knopf, leeres Album oder Ziehen auf das Raster. Die Seite schickt jede Datei einzeln per `XMLHttpRequest` (nur der meldet Upload-Fortschritt) und zeigt je Datei eine Kachel mit dem Bild aus dem Browser: *Wartet* → Prozent und Balken beim Senden → *Wird verkleinert* → das fertige Bild, kurz hervorgehoben. Zu große Dateien und fremde Formate scheitern sofort auf ihrer Kachel, ohne Netz. Die Grenze trägt der Client als `MAX_UPLOAD_BYTES` selbst; `check:dashboard` vergleicht sie mit `MAX_IMAGE_BYTES`.

---

## Der Server

| Route | Antwort |
|---|---|
| `GET /dcapi/health` | `{ status: "ok", uptime }` |
| `GET /images/*` | Die Datei, oder 403 / 404 |

Lauscht auf `0.0.0.0:SERVER_PORT`. `/images/*` ist bewusst ohne Token erreichbar, alle anderen Routen verlangen einen - Details in [Server.md](Server.md). Die Basis-URL kommt aus `Server.BaseURL`:

- Dev (`--dev`): `http://localhost:<SERVER_PORT>`
- Produktion: `SERVER_PUBLIC_URL` aus der `.env`

```json
"SERVER_PORT": 3000,
"SERVER_PUBLIC_URL": "https://dashboard.nexus-emb.de"
```

Damit Discord die Bilder rendern kann, muss ein Reverse Proxy die Domain auf den Port legen. Testen mit `https://dashboard.nexus-emb.de/health`.

Kein `@fastify/static` — der Handler sind 20 Zeilen, und die Pfadprüfung bräuchtest du ohnehin selbst.

---

## Sicherheit

Alles Sicherheitsrelevante liegt in `src/constants/Gallery.ts`, ohne Abhängigkeiten und damit einzeln testbar.

| Funktion | Verhindert |
|---|---|
| `ResolveImagePath(relative)` | `../`-Ausbrüche und absolute Pfade — erst `resolve()`, dann Wurzel prüfen. Gibt `null` statt eines Pfads ausserhalb |
| `SanitizeName(value)` | Pfadwechsel über Ordner- und Dateinamen. Erlaubt nur `a-z0-9_-`, max. 32 Zeichen |
| `IsScope(value)` | Fremde Werte als Verzeichnisnamen. Nur Snowflakes und `"default"` |
| `IsPrivateHost(hostname)` | Downloads ins eigene Netz (`127.0.0.1`, `10.x`, `169.254.169.254`, `::1`, `*.local` …) |
| `ParseSource(url)` | Alles ausser `https` |

Beim Download zusätzlich:

- **8 MB Limit**, mitgezählt beim Streamen — `maxContentLength` von axios greift nur, wenn der Server einen `Content-Length`-Header schickt
- **15 Sekunden Timeout**, max. 3 Redirects
- **Dateityp aus dem `Content-Type` der Antwort**, nicht aus der URL — eine URL auf `.png` sagt nichts darüber, was ankommt
- Bei einem Abbruch wird die halbe Datei wieder gelöscht

Gegen DNS-Rebinding prüft `LookupPublic` die Adresse erst im Moment des Verbindens, für die erste Anfrage wie für jede Weiterleitung; `CheckRedirect` lässt nur `https`-Sprünge zu. Details stehen als Kommentar in `src/constants/Gallery.ts`.

---

## Fallen

- **`Attach()` nicht vergessen.** `image.url` direkt in `.gallery()` funktioniert im Dev-Modus nicht.
- **Beim `editReply` kein `ephemeral` mitschicken.** Nach einem `deferReply` steht das Flag fest, Discord lehnt Änderungen ab. `toMessage()` ohne Argument nehmen.
- **`attachments: []` beim Bearbeiten**, sonst wachsen die Anhänge mit jeder Seite.
- **Die Endung ändert sich.** Aus `logo.png` wird beim Speichern `logo.webp` — wer eine ID vorher zusammenbaut, trifft daneben. Die zurückgegebene `IGalleryEntry` benutzen.
- **Der Default-Scope ist schreibgeschützt.** `CreateCategory`, `AddImage`, `MoveImage` und `DeleteImage` lehnen `guildId: "default"` ab.
- **Select-Menüs fassen 25 Optionen.** Kategorien, Unterordner und Bildlisten werden abgeschnitten, das Panel weist darauf hin.
- **Jeder Lesezugriff geht auf die Platte.** Für ein Panel mit ein paar Ordnern ist das kein Thema; wer die Galerie auf Tausende Bilder aufbohrt, braucht davor einen Cache.
