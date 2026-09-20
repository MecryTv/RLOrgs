# Welcome System

Wer den Server betritt, wird begrüßt — als **gezeichnete Karte**, als Karte im Components-V2-Stil, als **Embed** oder als **normale Nachricht**. Dazu Rollen, die jeder Neue automatisch bekommt, und auf Wunsch ein Abschied, wenn jemand geht.

Das Modul heißt `welcome` und wird unter *Module* eingeschaltet (oder `/module an modul:welcome`).

> **Ohne das Members-Intent sieht der Bot niemanden kommen.** `GUILD_MEMBER_INTENT="true"` in der `.env` **und** im Developer Portal — sonst bleiben Begrüßung und Auto-Rollen still. Das Dashboard sagt es oben, wenn es fehlt.

---

## Vier Arten

Je Nachricht (Begrüßung und Abschied getrennt) wählt ihr oben im Editor, was rausgeht:

| Art | Was rausgeht |
|---|---|
| **Welcome Card (Bild)** | Ein PNG, das der Bot zeichnet: Hintergrund, Avatar, drei Textzeilen, Server-Icon. Darüber passt noch eine Textzeile — gut für die Erwähnung `{user}`, damit die Benachrichtigung ankommt |
| **Karte (Components V2)** | Der Container des Bots mit Text, Bildern, Galerie und Farbbalken |
| **Embed** | Klassisches Embed: Überschrift, Text, Farbe, Bilder, Autor, Fußzeile, Uhrzeit, bis zu zehn Felder |
| **Normale Nachricht** | Reiner Text bis 2000 Zeichen |

Die Vorschau rechts zeigt jede Art so, wie sie in Discord aussieht — die Welcome Card zeichnet dafür der Bot und schickt sie als Bild zurück.

---

## Die Welcome Card

| Einstellung | |
|---|---|
| **Hintergrund** | Eigenes Bild hochladen (PNG, JPG, GIF, WebP bis 8 MB). Der Bot verkleinert es auf 1920 px und legt es als WebP ab. Ohne Bild zeichnet er einen Farbverlauf aus der Akzentfarbe |
| **Akzentfarbe** | Rahmen, Ring um den Avatar und die kleine Zeile |
| **Abdunkeln** | 0 bis 90 % — hält den Text auch auf hellen Bildern lesbar |
| **Überschrift, Unterzeile, kleine Zeile** | Je eine Zeile mit Platzhaltern |
| **Schriftgröße** | 28 bis 72 Pixel für die Überschrift, der Rest richtet sich danach |
| **Ausrichtung** | Links neben dem Avatar oder mittig über die ganze Karte |
| **Avatar** | An oder aus, mit oder ohne Ring, rund oder abgeschrägt |
| **Server-Icon** | Oben rechts |
| **Beitrittsdatum** | Hängt hinten an der kleinen Zeile |

Abgeschaltete Bausteine hinterlassen keine Löcher: Ohne Avatar rücken die Texte nach links, ohne Zeile rückt der Block zusammen.

Gezeichnet wird mit `@napi-rs/canvas` (`builder/WelcomeCard.ts`), 1000 × 340 px, mit denselben Schriften wie die Rang- und Level-Karte.

---

## Platzhalter

| | | | |
|---|---|---|---|
| `{user}` | Erwähnung | `{guild}` | Server-Name |
| `{user.name}` | Anzeigename | `{guild.icon}` | Server-Icon (Bild) |
| `{user.tag}` | Discord-Name | `{guild.members}` | Mitgliederzahl |
| `{user.id}` | ID | `{member.number}` | Das wievielte Mitglied |
| `{user.avatar}` | Avatar (Bild) | `{joined}` | Beigetreten |
| | | `{created}` | Konto erstellt |

In Texten werden `{joined}` und `{created}` zu Discords Zeitstempeln („vor 2 Jahren"), auf der Karte zu einem Datum — dort kann Discord nichts umrechnen.

---

## Auto-Rollen

Zwei Listen, je bis zu zehn Rollen:

- **Für Mitglieder** — bekommt jeder, der den Server betritt.
- **Für Bots** — bekommt jeder Bot, den jemand einlädt. Begrüßt werden Bots nicht.

Die Rollen müssen unter der höchsten Rolle des Bots stehen, und er braucht **Rollen verwalten** — sonst sagt das Dashboard beim Speichern, woran es liegt.

---

## Abschied

Dieselben vier Arten, eigener Kanal, eigener Text — standardmäßig aus. Wer gebannt wird, zählt dabei mit: Discord meldet beides als „Mitglied weg".

---

## Dashboard

`/dashboard/guild/<id>/welcome` — oben die Zahlen (Begrüßung, Abschied, Auto-Rollen, gewählte Art), darunter zwei Reiter **Begrüßung** und **Abschied** mit Schalter, Kanal, Platzhalter-Leiste, Editor samt Vorschau und **Test senden**. Ganz unten die Auto-Rollen.

Der Test schickt genau das, was gespeichert ist, mit den Daten dessen, der auf den Knopf drückt.

| Route | |
|---|---|
| `GET <base>/api/guild/:id/welcome` | Einstellungen, Vorlagen, Platzhalter, Arten, Rollen und Kanäle |
| `POST <base>/api/guild/:id/welcome` | `save`, `test`, `preview` (zeichnet die Karte), `background-remove` — nur JSON |
| `GET,POST <base>/api/guild/:id/welcome/background/:which` | Hintergrundbild holen und hochladen (roh als `image/*`) |

Anfang wie überall: `ManageGate()` (`utils/managegate.ts`) — Sitzung, „Server verwalten", Datenbank, Modul an.

---

## Dahinter

| | |
|---|---|
| Einstellungen | `module_settings` unter `welcome` — eine JSON-Zeile je Server, keine eigene Tabelle |
| Bilder | `welcome/<server>/join.webp` bzw. `leave.webp` (nicht im Repo, gehört ins Backup) |
| Beitritt | `WelcomeJoin` hört auf `GuildMemberAdd`: erst die Rollen, dann die Nachricht |
| Abschied | `WelcomeLeave` hört auf `GuildMemberRemove` |
| Nachricht | Für Embed, Text und Components V2 baut `CustomMessageView()` die Nachricht — dieselbe Stelle wie bei [Custom Message](Messages.md) |

---

## Prüfen

```bash
npm run check:welcome   # Einstellungen, Platzhalter, die Karte als PNG und was an Discord ginge
```

Wer wirklich kommt und geht, sieht nur ein echter Server.
