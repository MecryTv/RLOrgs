# ComponentV2Builder

Fluent Builder für Discord ComponentsV2-Nachrichten. Ersetzt Embeds komplett — Layout, Buttons, Select-Menüs, Dateien und Bilder liegen in **einem** Container statt in Embed + separater ActionRow.

```ts
import ComponentV2Builder from "../../builder/ComponentV2Builder";
```

Interfaces liegen gesammelt in `src/interfaces/builder/IComponentV2Builder.ts` — importieren musst du sie nur, wenn du eigene Helper darum baust.

---

## Quickstart

```ts
await interaction.reply(
    new ComponentV2Builder({ accentColor: "Red" })
        .title("⚠️ | Fehler", "Das hat nicht geklappt")
        .separator()
        .text("Der Command braucht die Berechtigung `Manage Roles`.")
        .toMessage({ ephemeral: true })
);
```

Jede Methode gibt `this` zurück, du kettest also durch. Am Ende steht immer **entweder** `.toMessage()` **oder** `.build()`.

---

## Absenden

| Methode | Gibt zurück | Wofür |
|---|---|---|
| `.toMessage()` | `{ components, flags }` | Der Normalfall. Setzt `IsComponentsV2` selbst. |
| `.toMessage({ ephemeral: true })` | dito + `Ephemeral` | Nur für den Aufrufer sichtbar. |
| `.build()` | `ContainerBuilder` | Wenn du das Payload selbst zusammenbaust oder mehrere Container in eine Nachricht packst. |

```ts
// Standard
await interaction.reply(builder.toMessage());
await channel.send(builder.toMessage());

// Mit zusätzlichen Feldern reinspreaden
await interaction.reply({ ...builder.toMessage(), files: [attachment] });

// Zwei Container in einer Nachricht
await channel.send({
    components: [headerBuilder.build(), bodyBuilder.build()],
    flags: MessageFlags.IsComponentsV2,
});
```

`.toMessage()` **nicht** zweimal aufrufen und beide senden — beide zeigen auf denselben Container.

---

## Methoden

### Text

| Methode | Ergibt in Discord |
|---|---|
| `.title("Sprint 12")` | `# Sprint 12` |
| `.title("Sprint 12", "11.08. – 24.08.")` | `# Sprint 12` + kleine graue Zeile darunter |
| `.heading("In Arbeit")` | `## In Arbeit` |
| `.heading("Details", 3)` | `### Details` |
| `.text("Beliebiges **Markdown**")` | normaler Absatz |
| `.subtext("Fußnote")` | `-# Fußnote` — klein und grau |

`title` und `heading` strippen vorhandene `#` am Anfang, `.title("# Foo")` und `.title("Foo")` sind also identisch.

Discord-Markdown, das du in jedem Textfeld nutzen kannst:

```
**fett**   *kursiv*   ~~durchgestrichen~~   `code`   ||spoiler||
> Zitat            -# kleiner Text          [Link](https://…)
<@123>  User       <@&123>  Rolle           <#123>  Channel
<t:1755300000:R>   "vor 12 Minuten" (relativer Timestamp, lokalisiert)
```

### Listen

```ts
.list(["Erster Punkt", "Zweiter Punkt"])
// - Erster Punkt
// - Zweiter Punkt

.list(["Schritt eins", "Schritt zwei"], { ordered: true })
// 1. Schritt eins
// 2. Schritt zwei

.list(["Unterpunkt"], { indent: 1, bullet: "•" })
//   • Unterpunkt
```

Eine `.list()` ist **eine** Komponente, egal wie viele Einträge — für lange Listen also billiger als viele `.text()`-Aufrufe.

### Fortschrittsbalken

```ts
.progress(9, 15, { label: "erledigt" })
// `▰▰▰▰▰▰▱▱▱▱` · 9 / 15 erledigt · 60 %
```

| Option | Default | Bedeutung |
|---|---|---|
| `width` | `10` | Anzahl Zeichen im Balken |
| `label` | – | Wort hinter `9 / 15` |
| `filled` / `empty` | `▰` / `▱` | eigene Zeichen, z.B. `█` / `░` |
| `showPercent` | `true` | Prozentangabe anhängen |

Werte werden geklemmt: negative Zahlen werden `0`, `current > total` wird 100 %, `total: 0` crasht nicht.

### Sections (Text mit Element rechts daneben)

Das ist der Unterschied zu Embeds — rechts vom Text sitzt ein Thumbnail **oder** ein Button.

```ts
// Thumbnail rechts
.section("## ✏️ In Arbeit\n-# 3 Aufgaben laufen gerade.", {
    type: "thumbnail",
    url: "https://cdn.example.com/board.png",
    description: "Sprint Board",   // Alt-Text, optional
    spoiler: false,                 // optional
})

// Button rechts — perfekt für Listenzeilen
.section("`#12` **Turnier-Bracket Rendering**\n-# 🟡 In Arbeit · fällig 18.08.", {
    type: "button",
    customId: "sprint:details:12",
    label: "Details",
})

// Link-Button rechts
.section("**Vollständiges Board**", {
    type: "button",
    url: "https://ascension.gg/board",
    label: "Öffnen",
})
```

Die `url` beim Thumbnail muss `http(s)://` oder `attachment://dateiname` sein.

### Separator

```ts
.separator()                                   // dünne Linie, kleiner Abstand
.separator({ spacing: "large" })               // dünne Linie, großer Abstand
.separator({ divider: false, spacing: "large" }) // nur Luft, keine Linie
```

### Bilder

```ts
.gallery("https://cdn.example.com/1.png")
.gallery(url1, url2, url3)   // Grid, max. 10
```

### Dateien

```ts
.file("sprint-12-scope.md")
```

`.file()` **hängt keine Datei an** — es zeigt nur auf einen Anhang derselben Nachricht. Du musst die Datei zusätzlich mitschicken, sonst rendert Discord eine leere Karte:

```ts
const scope = new AttachmentBuilder(Buffer.from(inhalt), { name: "sprint-12-scope.md" });

await interaction.reply({
    ...builder.file("sprint-12-scope.md").toMessage(),
    files: [scope],
});
```

Der Name in `.file()` und der in `AttachmentBuilder` müssen **exakt** gleich sein. Das `attachment://` davor setzt der Builder selbst, `.file("attachment://x.md")` geht aber auch.

### Buttons

Ein Aufruf = eine Reihe, max. 5 Buttons:

```ts
.buttons(
    { customId: "sprint:new",  label: "Aufgabe anlegen",   tone: "primary", emoji: "➕" },
    { customId: "sprint:done", label: "Als erledigt melden", tone: "success" },
    { customId: "sprint:kill", label: "Abbrechen",          tone: "danger", disabled: true },
)
.buttons({ url: "https://ascension.gg", label: "Board öffnen" })   // zweite Reihe
```

| `tone` | Farbe |
|---|---|
| `primary` | Blurple |
| `secondary` | Grau (Default) |
| `success` | Grün |
| `danger` | Rot |

Ein Button hat entweder `customId` **oder** `url` — TypeScript erzwingt das. Link-Buttons haben keinen `tone` (Discord rendert sie immer grau) und lösen keine Interaction aus.

Custom-Emojis: `emoji: { id: "123456789", name: "ascension", animated: false }`.

### Select-Menü

```ts
.select({
    customId: "sprint:claim",
    placeholder: "Aufgabe auswählen und übernehmen...",
    options: [
        { label: "#16 Match-Reminder Scheduler", value: "16", description: "fällig 22.08.", emoji: "🗓️" },
        { label: "#17 Admin-Dashboard", value: "17", default: true },
    ],
    minValues: 1,     // optional
    maxValues: 2,     // optional → Mehrfachauswahl
    disabled: false,  // optional
})
```

Ein Select belegt eine eigene Reihe, du kannst also mehrere untereinander setzen.

### Discord-Selects (Kanal, Rolle, Nutzer)

Discord füllt diese Menüs selbst — du gibst keine Optionen vor, und der Server-Inhalt ist immer aktuell.

```ts
.channelSelect({
    customId: "notifier:panel:channel",
    channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],  // optional
    placeholder: "Kanal wählen...",
    defaultChannel: "123456789",   // optional
})

.roleSelect({ customId: "notifier:panel:liverole", placeholder: "Live-Rolle wählen..." })
.userSelect({ customId: "notifier:panel:discord", placeholder: "Konto verknüpfen..." })
```

Die Auswahl kommt als `interaction.values[0]` zurück — eine ID, kein Objekt.

Eine vorausgewählte Option lässt sich in Discord **nicht noch einmal auswählen**. Wo derselbe Wert öfter gesetzt werden soll, `defaultChannel` und `defaultRole` deshalb weglassen und den aktuellen Stand stattdessen im Text darüber anzeigen — so machen es das Welcome- und das Notifier-Panel.

### Accent-Farbe

Der farbige Balken links am Container.

```ts
new ComponentV2Builder({ accentColor: "#B57BFF" })   // Hex-String
new ComponentV2Builder({ accentColor: 0xb57bff })    // Zahl
new ComponentV2Builder({ accentColor: "Red" })       // discord.js Farbname
builder.accent("Yellow")                             // auch nachträglich
```

Ohne Accent bleibt der Balken grau. `{ spoiler: true }` legt den ganzen Container hinter einen Spoiler.

---

## Limits

Der Builder zählt mit und greift ein, bevor Discord die Nachricht ablehnt:

| Limit | Verhalten |
|---|---|
| 4000 Zeichen Text gesamt | wird über **alle** Textfelder zusammengezählt und am Ende mit `…` abgeschnitten — kein Fehler |
| 40 Komponenten | `RangeError` |
| 5 Buttons pro Reihe | `RangeError` |
| 1–25 Select-Optionen | `RangeError` |
| 10 Bilder pro `.gallery()` | `RangeError` |

Was wie viel vom 40er-Budget kostet:

| Aufruf | Kosten |
|---|---|
| `.text()` / `.title()` / `.heading()` / `.subtext()` / `.list()` / `.progress()` | 1 |
| `.separator()` / `.gallery()` / `.file()` | 1 |
| `.section()` | 3 |
| `.buttons(a, b, c)` | 4 (Reihe + 3) |
| `.select()` | 2 |

Der Container selbst kostet 1, dir bleiben also 39. Das Board aus `/componentv2` liegt bei **37 von 40** — Sections sind teuer, mehr als ~10 davon passen nicht in eine Nachricht.

Die `RangeError`s fängt der `CommandHandler` über `guardian.ReportError` ab — im Zweifel siehst du sie also im Log, nicht als toter Command.

---

## Fallen

- **Kein `content`, keine `embeds`.** Sobald `IsComponentsV2` gesetzt ist, lehnt Discord beide Felder ab. Alles läuft über `.text()`.
- **V2 ist keine Einbahnstraße rückwärts.** Eine Nachricht, die mit dem Flag erstellt wurde, kann per `editReply` nicht auf Embeds zurück — und umgekehrt. Beim Editieren immer den **kompletten** Container neu bauen und mitschicken, es gibt kein partielles Update.
- **Mentions pingen.** `<@123>` in einem `.text()` löst eine echte Benachrichtigung aus. Wenn du nur den Namen anzeigen willst:
  ```ts
  await interaction.reply({ ...builder.toMessage(), allowedMentions: { parse: [] } });
  ```
- **`customId` braucht einen Handler.** Buttons und Selects feuern eine `InteractionCreate` — ohne passenden Handler sieht der User „Interaktion fehlgeschlagen". Nutze ein Präfix-Schema wie `sprint:details:12`, dann kannst du im Handler auf `startsWith("sprint:")` matchen.
- **Bilder brauchen erreichbare URLs.** Discord lädt sie serverseitig; localhost oder private URLs bleiben leer.
- **Reihenfolge = Darstellung.** Es gibt kein nachträgliches Umsortieren — was du zuerst kettest, steht oben.

---

## Rezepte

### Standard-Fehlermeldung

```ts
await interaction.reply(
    new ComponentV2Builder({ accentColor: "Red" })
        .title("⚠️ | Keine Berechtigung")
        .separator()
        .text("Du brauchst die Rolle <@&123> für diesen Command.")
        .toMessage({ ephemeral: true })
);
```

### Bestätigungsdialog

```ts
await interaction.reply(
    new ComponentV2Builder({ accentColor: "Orange" })
        .title("🗑️ | Wirklich löschen?")
        .separator()
        .text(`\`${count}\` Nachrichten werden unwiderruflich entfernt.`)
        .buttons(
            { customId: `purge:confirm:${count}`, label: "Löschen", tone: "danger" },
            { customId: "purge:cancel", label: "Abbrechen" },
        )
        .toMessage({ ephemeral: true })
);
```

### Liste mit Aktion pro Zeile

```ts
const builder = new ComponentV2Builder({ accentColor: "#B57BFF" }).title("🎫 Offene Tickets");

for (const ticket of tickets.slice(0, 10)) {
    builder.section(`**${ticket.title}**\n-# von <@${ticket.userId}> · <t:${ticket.createdAt}:R>`, {
        type: "button",
        customId: `ticket:open:${ticket.id}`,
        label: "Öffnen",
    });
}

await interaction.reply(builder.toMessage());
```

`slice(0, 10)` ist wichtig — 10 Sections sind bereits 30 Komponenten.

---

## Live testen

```bash
npm run dev
```

`/componentv2` (developer-only) rendert alle Komponenten auf einmal.
Quelle: `src/commands/dev/ComponentV2Test.ts` — der ehrlichste Beispielcode, den es gibt.

| Aufruf | Zeigt |
|---|---|
| `/componentv2` | Board mit Sections, Buttons, Select, Datei, Progress |
| `/componentv2 demo:Basic` | Titel, Subtitle, Thumbnail-Section |
| `/componentv2 demo:Limits` | 5000 Zeichen rein → auf 4000 gekürzt |
| `/componentv2 ephemeral:False` | öffentlich statt nur für dich |
