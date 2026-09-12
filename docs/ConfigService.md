# Config

Lädt die JSON-Dateien aus `src/config`, prüft sie gegen ein Schema und gibt sie typisiert wieder heraus. Dazu Dev-Overlays, Hot-Reload, Seiten-Aufteilung und fertige Select-Optionen für Discord.

Zugriff über den Client: `this.client.configService`.

Nicht zu verwechseln mit der `.env` im Projekt-Root — dort stehen Token und Server-Einstellungen, siehe [Environment.md](Environment.md).

> **`src/config` ist aktuell leer.** Der Service ist da, die Dateien kommen mit den Features, die sie brauchen. Vorlagen aus der JavaScript-Fassung liegen unter `Ascension/src/config`. Alle Beispiele hier sind entsprechend Beispiele, keine vorhandenen Dateien.

---

## Ablauf beim Start

1. `BotClient.Init()` ruft `configService.Initialize()` auf — unabhängig von Discord.
2. Jede `*.json` in `src/config` wird gelesen, im Dev-Modus mit ihrem `*.dev.json` überlagert, geprüft und eingefroren.
3. Eine fehlerhafte Datei wird übersprungen und gemeldet, die übrigen laufen weiter.
4. Im `--dev` Modus startet danach `Watch()` — geänderte Dateien landen ohne Neustart im Speicher.
5. Beim Shutdown läuft `Unwatch()`.

Der Pfad kommt aus `process.cwd()`, nicht aus `__dirname`: `tsc` kopiert keine `.json` nach `dist`, im Build wäre der Ordner sonst leer. Voraussetzung ist damit nur, dass der Bot aus dem Projekt-Root gestartet wird.

---

## Format

Jede Datei ist ein **Array von Einträgen**. Jeder Eintrag braucht ein `pagination`-Flag, alles andere ist frei:

```json
[
    {
        "pagination": false,
        "options": [
            { "name": "Name", "description": "Ändere den Namen", "value": "name", "emoji": "📝" }
        ]
    }
]
```

In der Praxis hat jede Datei genau einen Eintrag. Das Array bleibt trotzdem — dafür gibt es `GetOne()`, damit niemand `[0]` schreiben muss.

> **`panigation`** ist ein Tippfehler aus der JavaScript-Fassung, der dort in jeder Datei steht. Der Loader liest ihn weiterhin als `pagination` und warnt dabei — eine unverändert herüberkopierte Datei läuft also, ohne dass der Fehler still weiterlebt.

---

## Zugriff

```ts
const config = this.client.configService;

config.Get<ISetupSettings>("setupsettings")       // alle Einträge
config.GetOne<ISetupSettings>("setupsettings")    // der erste Eintrag
config.Require<ISetupSettings>("setupsettings")   // wirft, statt null zu liefern
config.Has("tempvoice")
config.Value("emojis", "server_custom.ACCL", "")  // Punkt-Pfad mit Fallback
```

`Get` und `GetOne` melden einen unbekannten Schlüssel an den Guardian und geben `null` zurück. `Require` wirft stattdessen — richtig für alles, ohne das der Bot nicht sinnvoll läuft.

Eine eigene Form beschreibst du über ein Interface, das `IConfigEntry` erweitert:

```ts
export default interface ITempVoice extends IConfigEntry {
    options: IConfigOption[];
}
```

### Ergebnisse sind eingefroren

Geladene Einträge werden tief mit `Object.freeze` versehen. Alle Aufrufer bekommen dasselbe Objekt — wer hineinschreibt, würde es für alle ändern. Schreibversuche werfen deshalb:

```ts
config.GetOne("tempvoice")!.pagination = true;   // TypeError
[...config.Options("tempvoice", "options")].sort();  // so geht sortieren
```

---

## Options-Listen

Fast jedes Feld in diesen Dateien ist eine Liste aus `{ name, description, value, emoji }` — also genau eine Discord-Select-Option. Dafür gibt es eigene Methoden:

```ts
config.Options("setupsettings", "pages")                  // IConfigOption[]
config.Option("tempvoice", "options", "name")             // eine Option über ihren value
config.SelectOptions("setupsettings", "pages")            // StringSelectMenuOptionBuilder[]
```

`SelectOptions` baut fertige discord.js-Builder: Label und Beschreibung auf 100 Zeichen gekürzt, und `emoji` wird als Unicode gesetzt oder — wenn es eine Snowflake ist — als Custom-Emoji `{ id }`. Mehr als 25 Optionen gibt Discord nicht aus, deshalb wird dort abgeschnitten.

```ts
const menu = new StringSelectMenuBuilder()
    .setCustomId("setup:page")
    .addOptions(this.client.configService.SelectOptions("setupsettings", "pages"));
```

### Seiten

Genau dafür ist das `pagination`-Flag da:

```ts
const page = config.Page("setupsettings", "pages", 2, 10);
// { options, page: 2, pages: 4, total: 34, hasPrevious: true, hasNext: true }
```

- `pagination: true` → wird in Seiten zerlegt, Seitengröße ist `size` (maximal 25)
- `pagination: false` → alles auf einer Seite, `pages` ist 1

Seitenzahlen werden geklemmt: `0` wird zu `1`, alles über der letzten Seite wird zur letzten. `SelectOptions(key, field, page)` liefert direkt die Builder für eine Seite.

---

## Schemas

`src/constants/ConfigSchemas.ts` beschreibt pro Datei, wie sie auszusehen hat. Die Grundprüfung (Array, `pagination`) läuft immer, das Schema kommt obendrauf. `CONFIG_SCHEMAS` ist derzeit leer — pro neuer Datei kommt ein Eintrag dazu:

```ts
export const CONFIG_SCHEMAS: Record<string, IConfigSchema> = {
    tempvoice: { options: OPTIONS },
    emojis: {
        pllogo: { type: "string" },
        server_custom: { type: "object", entries: { type: "string" } },
    },
};
```

`OPTION` und `OPTIONS` sind fertig exportiert und beschreiben eine Liste aus `{ name, description, value, emoji }` mit optionalem `channel_type` — das deckt fast jedes Feld dieser Dateien ab. Für alles andere:

| Feld | Bedeutung |
|---|---|
| `type` | `string`, `number`, `boolean`, `object`, `array` |
| `optional` | Fehlen ist erlaubt |
| `of` | Bei `array`: das Schema jedes Elements |
| `shape` | Bei `object`: die bekannten Schlüssel |
| `entries` | Bei `object`: ein Schema für **alle** Werte, wenn die Schlüssel frei sind |

Unbekannte Schlüssel sind erlaubt — eine Datei darf mehr enthalten, als das Schema kennt. Eine Datei ohne Schema-Eintrag läuft nur durch die Grundprüfung; du kannst also erst die JSON anlegen und das Schema nachreichen.

Fehler benennen den genauen Pfad:

```
tempvoice.json ist ungültig: tempvoice[0].options[0].emoji fehlt
```

---

## Dev-Overlays

Eine Datei `<name>.dev.json` wird im `--dev` Modus über `<name>.json` gelegt. In Produktion wird sie ignoriert.

```json
// tempvoice.json
[{ "pagination": false, "options": [ ...20 Einträge... ] }]

// tempvoice.dev.json
[{ "options": [ { "name": "Test", "description": "d", "value": "test", "emoji": "🧪" } ] }]
```

Im Dev-Modus hat `tempvoice` dann eine Option, `pagination` bleibt `false`.

- Objekte werden tief gemischt, Felder aus dem Overlay gewinnen
- **Arrays werden ersetzt, nicht gemischt** — sonst wüsste niemand, ob Element 3 ergänzt oder überschrieben wird
- Einträge auf oberster Ebene werden nach Position gemischt

Geprüft wird erst nach dem Mischen: ein Overlay, das ein Pflichtfeld herauswirft, fällt beim Start auf.

---

## Neu laden

```ts
await config.Reload("tempvoice");   // eine Datei
await config.Reload();              // alle
```

`Reload` löst die Change-Handler aus:

```ts
const off = config.OnChange((name) => {
    if (name === "setupsettings") this.RebuildPanel();
});

off();   // abmelden
```

Ein Handler, der wirft, wird geloggt und hält die anderen nicht auf.

### Watch

```ts
config.Watch();      // true, wenn neu gestartet; false, wenn schon aktiv
config.Unwatch();
config.IsWatching;
```

`Watch()` hängt sich mit `fs.watch` an den Ordner. Änderungen werden 250 ms gesammelt — Editoren schreiben oft mehrfach hintereinander — und lösen dann `Reload(name)` für die betroffene Datei aus, samt Change-Handlern. Eine Änderung an `<name>.dev.json` lädt ebenfalls `<name>` neu.

`BotClient` startet das automatisch im `--dev` Modus. In Produktion bleibt es aus: dort ändert sich nichts im laufenden Betrieb, und ein Watcher wäre nur eine offene Datei mehr.

Der Watcher ist `unref()`-t und hält den Prozess beim Herunterfahren nicht offen.

---

## Der Rest der API

```ts
config.Root         // der Ordner, aus dem gelesen wird
config.Size         // Anzahl geladener Konfigurationen
config.Keys         // ["emojis", "setupsettings", ...]
config.IsLoaded     // true nach Initialize()
config.IsWatching
```

Für Tests nimmt der Konstruktor einen zweiten Parameter: `new ConfigService(client, "/pfad/zum/ordner")`.

---

## Fallen

- **Eine kaputte Datei fehlt einfach.** Sie reißt den Start nicht ab, aber `Get("x")` liefert danach `null`. Beim Start steht im Log, welche und warum.
- **Eingefrorene Ergebnisse nicht sortieren.** Erst kopieren (`[...options]`), dann sortieren.
- **Arrays im Overlay ersetzen komplett.** Wer im Dev-Modus eine Option ergänzen will, muss die ganze Liste hinschreiben.
- **`Watch` ist kein Ersatz für einen Neustart**, wenn sich die Struktur ändert: läuft die neue Datei nicht durch das Schema, bleibt die alte Fassung nicht stehen — der Schlüssel ist danach weg. Das Log sagt es, aber das Panel läuft dann ins Leere.
- **Index in einer Options-Liste ist keine ID.** Für Select-Menüs immer `value` benutzen, sonst verschiebt sich alles, sobald jemand eine Zeile einfügt.

`src/config` ist im Moment leer — der Service läuft trotzdem an und meldet `0 Konfiguration(en) geladen`. Sobald dort eine JSON-Datei liegt, wird sie beim Start eingelesen und, im `--dev` Modus, bei jeder Änderung neu geladen.
