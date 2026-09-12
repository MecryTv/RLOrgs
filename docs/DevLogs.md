# DevLogs

Die Session-Logs des Bots direkt in Discord lesen, durchsuchen und herunterladen — ohne SSH auf den Server.

Zugriff über den Client: `this.client.devLogsService`.

---

## Die Bausteine

| Datei | Aufgabe |
|---|---|
| `src/commands/dev/DevLogs.ts` | `/devlogs` — öffnet das Panel |
| `src/services/DevLogsService.ts` | Dateien finden, scannen, seitenweise lesen, durchsuchen |
| `src/builder/DevLogsPanel.ts` | Zeichnet das Panel, hält dessen Zustand |
| `src/events/devlogs/DevLogsHandler.ts` | Bedient das Panel (Buttons, Select, Modals) |
| `src/constants/DevLogs.ts` | Pfad-Auflösung, Formatierung, Limits — ohne Abhängigkeiten |

Die Sessions selbst kommen vom `ChronicleLogger`: `getSessionHistory()`, `getSessionsDirectory()`, `getSessionsPerPage()` und `getCurrentSessionNumber()`. Der Service legt nichts eigenes an, er liest nur.

---

## Der Command

```
/devlogs
```

`developerOnly: true` — die Freigabe kommt allein aus `DEV_USER_IDs` in der `.env`, geprüft vom `CommandHandler`. Eine Server-Berechtigung setzt der Command bewusst nicht: Entwickler sind keine Administratoren, und Developer-Commands werden ohnehin nur in der `DEV_GUILD_ID` registriert.

Die Antwort ist **ephemeral**: nur wer den Command ausführt, sieht das Panel und kann seine Buttons bedienen. Ein eigener Rechte-Check im Handler wäre doppelt gemoppelt — Discord lässt niemand anderen an eine ephemere Nachricht.

---

## Die vier Ansichten

Das Panel ist ein Zustandsautomat. `state.view` entscheidet, was gezeichnet wird:

| View | Zeigt | Kommt hin über |
|---|---|---|
| `list` | Alle Sessions als Select-Menü, seitenweise | Start, „Zur Liste" |
| `overview` | Status, Laufzeit, Größe, Statistik einer Session | Session im Menü wählen |
| `page` | Der Log-Inhalt, 1500 Bytes pro Seite | „Volltext", Fehler-Sprünge |
| `search` | Treffer eines Suchbegriffs | „Durchsuchen" |

```ts
export interface IDevLogsState {
    view: DevLogsView;
    listPage: number;
    session: number | null;
    part: number | null;      // null = jüngster Teil der Session
    page: number;
    term: string | null;
    notice: string | null;
}
```

Der Zustand liegt in einem LRU (`PanelStates`, 50 Einträge, 30 Minuten), abgelegt unter der Message-ID — genau wie beim Galerie-Panel. Deshalb tragen die customIds **keine** Parameter: `devlogs:panel:next` reicht, weil die aktuelle Session und Seite schon im Zustand stehen.

---

## Warum der Zustand und nicht die customId

Die alte Fassung schrieb alles in die ID: `devlogs_view:42:0:17`. Das funktioniert, aber jeder Button muss dann wissen, wohin er springt — auch die Fehler-Navigation, die dafür beim Zeichnen schon die Zieleseite kennen musste. Mit Zustand fragt der Handler beim Klick nach:

```ts
const { errorPages } = await this.client.devLogsService.Stats(file);
const target = errorPages.find((page) => page > state.page);
```

Ein Button weniger zu bauen, eine Sonderroute weniger (`devlogs_err_none`), und die 100-Zeichen-Grenze von Discord für customIds ist kein Thema mehr.

---

## Der Service

| Methode | Gibt zurück |
|---|---|
| `Sessions()` | Alle Sessions, neueste zuerst |
| `ListPageOf(session)` | Auf welcher Listenseite diese Session steht |
| `Resolve(session, part?)` | `ILogFile` mit Pfad und Größe, `null` wenn die Datei weg ist |
| `Stats(file)` | Zeilen, Fehler, Warnungen und **auf welchen Seiten** die Fehler liegen |
| `Page(file, page)` | 1500 Bytes ab der Seitengrenze, Seite geklemmt |
| `Search(file, term)` | Bis zu 30 Treffer plus die echte Gesamtzahl |
| `Attachment(file)` | Die Datei als `AttachmentBuilder` |

`part` ist optional: ohne Angabe kommt der **jüngste** Teil einer Session. Lange Sessions rollt der Logger in mehrere Dateien, `entry.files` hält sie in Reihenfolge.

### Seiten sind Bytes, keine Zeilen

`Page()` liest mit `read(buffer, 0, length, start)` genau einen Abschnitt aus der Datei, statt sie ganz in den Speicher zu holen. Deshalb kann eine Seite mitten in einer Zeile anfangen — dafür kostet Blättern in einem 4-MB-Log dasselbe wie in einem 4-KB-Log.

`Stats()` rechnet die Fehlerstellen in dieselbe Byte-Rasterung um, sonst würde die Fehler-Navigation auf Seiten zeigen, die es so nicht gibt:

```ts
offset += Buffer.byteLength(line, "utf8") + 1;
```

### Der Scan wird gecached

`Stats()` liest die Datei komplett. Ohne Cache liefe das bei **jedem** Seitenklick erneut, weil die Seitenansicht die Fehlerstellen für ihre Navigation braucht. Ein LRU über `pfad:größe` (50 Einträge, 5 Minuten) fängt das ab — der Schlüssel enthält die Größe, damit eine wachsende Datei automatisch neu gescannt wird.

---

## Grenzen

| Konstante | Wert | Wofür |
|---|---|---|
| `PAGE_SIZE` | 1500 | Bytes pro Seite — passt mit ANSI-Codes ins 4000-Zeichen-Budget des Containers |
| `MAX_SEARCH_RESULTS` | 30 | Mehr Treffer werden gezählt, aber nicht angezeigt |
| `MAX_SEARCH_TERM` | 100 | Maximale Länge im Such-Modal |
| `MAX_INLINE_BYTES` | 5 MB | Darüber gibt es weder Volltext noch Suche noch Statistik |
| `MAX_UPLOAD_BYTES` | 10 MB | Darüber lehnt Discord den Upload ab — das Panel sagt es vorher |

---

## Sicherheit

`ResolveLogPath(directory, file)` ist die einzige Stelle, die aus einem Dateinamen einen Pfad macht:

```ts
const root = path.resolve(directory);
const full = path.resolve(root, file);

return full.startsWith(root + path.sep) ? full : null;
```

Erst auflösen, dann die Wurzel prüfen — ein `..` im Namen, ein absoluter Pfad oder ein Umweg über Unterordner landen alle bei `null`. Die Dateinamen kommen zwar aus dem eigenen Manifest und nicht vom Nutzer, aber der Check kostet nichts und der Test hält ihn fest.

Die Log-Inhalte laufen durch `Fence()`: ein ` ``` ` in einer Log-Zeile würde sonst den Codeblock des Panels aufreissen und den Rest der Ausgabe als Text ausspucken.

---

## Fallen

- **Ephemeral heisst nicht unsichtbar für den Server.** Wer `/devlogs` darf, sieht alles, was der Bot je geloggt hat — inklusive Nutzernamen und Fehlermeldungen. Deshalb `developerOnly`.
- **`Colorize()` färbt nach Textinhalt.** Eine Zeile mit dem Wort `ERROR` im Nutzertext wird rot, auch wenn sie eine INFO-Zeile ist. Für ein Log-Fenster ist das die richtige Näherung.
- **Der Statistik-Cache hängt an der Größe.** Wächst die aktuelle Session, wird neu gescannt. Ändert sich eine Datei ohne Größenänderung, sieht der Cache das nicht — bei Logs passiert das nicht.
- **Kein Rechte-Check im Handler.** Bewusst: die Panel-Nachricht ist ephemeral, es gibt keinen zweiten Nutzer, der klicken könnte.
