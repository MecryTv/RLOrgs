# Aktivität

Die Übersicht auf der Serverseite zeigt, was auf einem Server los ist: Nachrichten, Zeit im Sprachkanal, Beitritte und Abgänge, dazu die aktivsten Kanäle und Mitglieder und die Rang-Verteilung. Die Zahlen zählt der Bot selbst mit — Discord liefert keine Vergangenheit. Die Kurve beginnt also an dem Tag, an dem RL Nexus auf dem Server läuft und eine Datenbank hat.

---

## Was gezählt wird

| Was | Woher | Wie |
|---|---|---|
| Nachrichten | `MessageCreate` | je Server und Stunde, je Kanal und Tag, je Mitglied und Tag |
| Minuten im Sprachkanal | `VoiceStateUpdate` | eine Sitzung vom Betreten bis zum Verlassen, über Stunden- und Tagesgrenzen aufgeteilt |
| Beitritte, Abgänge | `GuildMemberAdd`, `GuildMemberRemove` | je Server und Stunde |

- **Nur Menschen.** Bots und Systemnachrichten zählen nicht.
- **Vom Inhalt nichts.** Gezählt wird, dass eine Nachricht kam, nicht was drinstand.
- **Threads zählen zu ihrem Kanal.** Ein Thread ist nach ein paar Tagen archiviert, der Kanal bleibt — und unter „Aktivste Kanäle“ soll der stehen.
- **Der AFK-Kanal zählt nicht** als Sprachkanal.

## Intents

`GuildVoiceStates` ist dafür neu und **nicht privilegiert**: kein Schalter im Developer Portal. Beitritte und Abgänge brauchen `GuildMembers` (`GUILD_MEMBER_INTENT`, siehe [Dashboard.md](Dashboard.md)), die Rang-Verteilung ebenfalls — sie braucht die vollständige Mitgliederliste.

## Wie es in die Datenbank kommt

`ActivityService` sammelt im Arbeitsspeicher und schreibt **einmal pro Minute** alles in einer Transaktion (`FLUSH_MS`). Addiert wird mit `ON DUPLICATE KEY UPDATE x = x + VALUES(x)`: zwei Schreibvorgänge in dieselbe Stunde ergeben die Summe, nicht den letzten Wert.

Abgezogen wird erst **nach** dem Schreiben und nur, was geschrieben wurde. Was währenddessen dazukommt, bleibt stehen; schlägt das Schreiben fehl, geht nichts verloren — der nächste Lauf versucht es mit allem erneut.

Laufende Sprachsitzungen werden bei jedem Lauf bis zur aktuellen Minute angerechnet, damit die Übersicht auch mitten in einer langen Runde stimmt. Voice sammelt sich in Millisekunden und geht als Minuten in die Datenbank; der Rest unter einer Minute bleibt liegen und kommt beim nächsten Mal mit. Eine abgeschlossene Stunde wird gerundet, denn dort kommt nichts mehr dazu.

Ein Neustart kostet höchstens diese eine Minute. Wer beim Start schon im Sprachkanal sitzt, zählt ab dem Start (`Warm()` im Ready-Event); beim Herunterfahren schreibt der Bot ein letztes Mal. **Ohne Datenbank wird gar nicht erst gesammelt** — es gäbe keinen Ort, an den es je ginge.

## Tabellen

| Tabelle | Schlüssel | Inhalt | Aufbewahrung |
|---|---|---|---|
| `guild_activity` | Server + Stunde | Nachrichten, Voice-Minuten, Beitritte, Abgänge | 90 Tage |
| `channel_activity` | Server + Tag + Kanal | Nachrichten | 90 Tage |
| `member_activity` | Server + Tag + Mitglied | Nachrichten, Voice-Minuten | 14 Tage |

Die Zeit steht als **ganze Zahl**: Stunden beziehungsweise Tage seit 1970 in UTC, nicht als `DATETIME`. So gibt es auf dem Weg in die Datenbank keine Zeitzone, die der Treiber falsch umrechnen könnte. In Ortszeit rechnet erst der Browser — 23 Uhr in Berlin ist ein anderer Tag als 23 Uhr UTC.

`member_activity` ist die **einzige Tabelle mit Discord-IDs**, allein für die Liste der aktivsten Mitglieder, und nach 14 Tagen gelöscht. Die anderen beiden enthalten nur Zählerstände. So steht es auch im [Datenschutz](../src/dashboard/public/privacy.html).

Aufgeräumt wird täglich um 04:30 (Runnable `ActivityPrune`).

## Im Dashboard

`GET <base>/api/guild/:id/activity` — nur mit Sitzung, nur für Server, die der Nutzer sehen darf, `503` ohne Datenbank. Geliefert werden die Stunden der letzten 31 Tage als vier Reihen (Nachrichten, Voice, Beitritte, Abgänge), dazu die aktivsten Kanäle, die aktivsten Mitglieder und die Rang-Verteilung. Discord-IDs gehen nicht mit raus: der Browser bekommt Namen und Avatare, sonst nichts.

Die Übersicht zeigt daraus:

- **Kennzahlen** — Mitglieder, Beitritte, Nachrichten und Voice je sieben Tage mit Vergleich zur Vorwoche, Teams, eingeschaltete Module. Verglichen wird nur, wenn die Vorwoche ganz gezählt ist; eine halbe sähe wie ein Einbruch aus.
- **Verlauf** — 30 Tage, umschaltbar zwischen Chat, Voice und Beitritten. Beitritte und Abgänge teilen sich eine Achse: Zugänge nach oben, Abgänge nach unten.
- **Heatmap** — vier Wochen nach Wochentag und Uhrzeit, in der Zeitzone des Browsers, fünf Helligkeitsstufen einer Farbe.
- **Aktivste Kanäle** (30 Tage) und **aktivste Mitglieder** (7 Tage, Chat und Voice getrennt).
- **Rang-Verteilung** — der höchste Rang je Spieler über 1v1, 2v2 und 3v3, unter den Mitgliedern mit verknüpftem Epic-Konto. Entdoppelt wird nach dem Epic-Konto: dasselbe Konto an zwei Discord-Konten ist ein Spieler. Wer die Platzierungsspiele nicht durch hat, zählt als Unranked, genau wie im Spiel.

Die Abzeichen der Verteilung kommen aus `rlranks/small/`, einer 160er-Fassung. Die Originale sind 1381 Pixel groß und bis zu 220 KB schwer — für die Rang-Karte in Discord gedacht, nicht für neun Bilder nebeneinander mit 30 Pixeln Breite. Sie kamen so spät, dass die letzten Spalten leer aussahen. Erzeugt werden die kleinen mit `npm run icons:ranks` ([MakeRankIcons.ts](../src/scripts/MakeRankIcons.ts)); kommen neue Abzeichen dazu, einmal laufen lassen.

Tage vor der ersten gezählten Stunde bleiben **leer, nicht null**: „keine Daten“ ist etwas anderes als „nichts los“.

## Farben

Die Datenfarben stehen in `style.css` unter `.overview` und sind mit dem Palettenprüfer der Datenviz-Richtlinien gegen den dunklen Grund geprüft — Lichtband, Chroma, Farbfehlsichtigkeit, Kontrast:

| Reihe | Farbe |
|---|---|
| Beitritte | `#199e70` |
| Chat | `#3987e5` |
| Voice | `#d55181` |
| Abgänge | `#d95926` |

Blau neben Violett fällt bei Rot-Grün-Schwäche zusammen, Aqua neben Magenta ebenfalls. Deshalb diese vier und in dieser Reihenfolge. Die Balken der Rang-Verteilung sind bewusst neutral: dort tragen die Abzeichen die Farbe.

## Prüfen

```bash
npm run check:db          # Zeitraster und der Weg durch die Datenbank
npm run check:dashboard   # die Route ohne Sitzung ist 401
```
