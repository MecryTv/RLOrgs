# Custom Message

Eigene Nachrichten im Namen des Bots: im Dashboard gebaut, mit Knöpfen darunter, von Hand gesendet oder nach Termin. Dazu **Stichwörter**, auf die der Bot von selbst antwortet.

Das Modul heißt `custom-message` und wird unter *Module* eingeschaltet (oder `/module an modul:custom-message`). Ohne Datenbank geht nichts.

---

## Eine Nachricht

Angelegt wird sie mit einem Namen — den sieht nur das Team. Danach kommen Inhalt, Kanal, Knöpfe und, wenn gewünscht, ein Termin. Geschrieben wird im selben Editor wie überall (Text, Bild, Galerie, Trennlinie; siehe [ComponentV2Builder.md](ComponentV2Builder.md)), mit Live-Vorschau daneben.

**Senden** schickt sie in den Kanal und merkt sich, wo sie steht. Danach ändert **Speichern** die Nachricht in Discord gleich mit — ihr müsst sie nicht löschen und neu schicken. Ist sie in Discord weg, sagt der Bot das und vergisst die alte Stelle.

Bis zu 50 Nachrichten je Server.

---

## Knöpfe

Unter jede Nachricht passen bis zu zehn Knöpfe, je fünf in einer Reihe:

| Knopf | Was passiert |
|---|---|
| **Rolle geben/nehmen** | an/aus (Standard), nur geben oder nur nehmen. Die Rolle muss unter der höchsten Rolle des Bots stehen, sonst sagt er das dem Klickenden |
| **Link öffnen** | Ein normaler Link-Knopf, `https://` |
| **Text nur für den Klickenden** | Eine versteckte Antwort — gut für Spoiler, Anleitungen oder Kleingedrucktes |

Farbe je Knopf: grau, blau, grün oder rot. Link-Knöpfe haben in Discord immer dasselbe Aussehen.

Die Knöpfe hängen an der Nachricht, nicht an einer Sitzung: In der Custom-ID stehen die ID der Nachricht und die des Knopfes, sie funktionieren also auch Monate später und nach jedem Neustart.

---

## Termine

| Termin | |
|---|---|
| **Von Hand** | Nur auf Knopfdruck |
| **Einmal zu einem Zeitpunkt** | Geht einmal raus, danach steht sie wieder auf „von Hand" |
| **Jeden Tag** | Zur eingestellten Uhrzeit |
| **Jede Woche** | Zur Uhrzeit an einem Wochentag |

Bei wiederkehrenden Nachrichten lässt sich **Alte löschen** setzen: Der Bot räumt die vorherige weg, bevor die neue kommt — so steht im Kanal immer nur die aktuelle.

Fällige Nachrichten schickt `CommunityTimers` jede Minute. Die Uhrzeit ist die des Servers, auf dem der Bot läuft.

---

## Stichwörter

Der Bot liest mit und antwortet, wenn etwas passt. Je Stichwort:

- **Vergleich:** enthält, ist genau, beginnt mit oder **Regex**. Ein kaputtes Muster löst nie aus — und lässt sich gar nicht erst speichern.
- **Als Antwort** auf die Nachricht oder als eigene im Kanal, auf Wunsch **leise** (ohne Benachrichtigung).
- **Auslöser löschen**, wenn die Frage selbst verschwinden soll.
- **Sperre** in Sekunden, damit dasselbe Stichwort im selben Kanal nicht im Kreis läuft.
- **Nur in diesen Kanälen** (auch ganze Kategorien), **nur für diese Rollen**, **nie für diese Rollen**.

In der Antwort setzt der Bot `{user}`, `{user.name}` und `{guild}` ein. Bots lösen nichts aus, und je Nachricht antwortet er höchstens einmal — das erste passende Stichwort gewinnt.

Bis zu 50 Stichwörter je Server.

---

## Dashboard

`/dashboard/guild/<id>/custom-message` — oben die Zahlen, darunter zwei Reiter: **Nachrichten** (anlegen, Editor mit Vorschau, Knöpfe, Termin, senden, löschen) und **Stichwörter** (anlegen, Antwort schreiben, Filter, an/aus).

| Route | |
|---|---|
| `GET <base>/api/guild/:id/messages` | Nachrichten, Stichwörter, Grenzen, Vorlagen, Kanäle und Rollen |
| `POST <base>/api/guild/:id/messages` | `create`, `save`, `send`, `update`, `delete`, `response-add`, `response-save`, `response-delete`, `preview` — nur JSON |

Anfang wie überall: `ManageGate()` (`utils/managegate.ts`) — Sitzung, „Server verwalten", Datenbank, Modul an.

---

## Dahinter

| | |
|---|---|
| Tabellen | `custom_messages` (Inhalt, Knöpfe, Kanal, Termin) und `auto_responses` (Stichwort, Antwort, Filter, Zähler) — Migration 018 |
| Knöpfe | `CustomButtons` hört auf die IDs `cm:btn:<nachricht>:<knopf>` |
| Stichwörter | `AutoResponder` hört auf `MessageCreate`; die Sperre liegt im Speicher, je Stichwort und Kanal |
| Termine | `CommunityTimers` jede Minute, der nächste Termin steht als `next` im JSON |

---

## Prüfen

```bash
npm run check:messages   # Eingaben, Knöpfe, Termine, Stichwörter, Karte und Datenbank
```

Senden, nachträglich ändern und die Antworten im Chat brauchen einen echten Server.
