# Umfragen

Abstimmungen im Kanal — entweder **eigene mit Knöpfen** (Balken in der Karte, anonym möglich, Ergebnisse im Dashboard) oder **Discords eigene Umfrage**. Welche von beiden, entscheidet ihr je Umfrage.

Das Modul heißt `polls` und wird unter *Module* eingeschaltet (oder `/module an modul:polls`). Ohne Datenbank geht nichts — die Umfragen und Stimmen stehen dort.

---

## Die beiden Arten

| | Eigene (Knöpfe) | Discord-Umfrage |
|---|---|---|
| Aussehen | Karte von RL Nexus mit einem Knopf je Antwort und Balken | Discords Umfrage-Element |
| Gezählt wird | vom Bot, in `poll_votes` | von Discord |
| Laufzeit | eine Minute bis ein Jahr — oder **ohne Ende** | eine Stunde bis 32 Tage, auf volle Stunden gerundet |
| Mehrfachwahl | ja, auf Wunsch mit Höchstzahl | ja |
| Anonym | ja — niemand sieht, wer was gewählt hat, auch nicht im Dashboard | nein, Discord zeigt die Stimmen |
| Balken erst später | ja („immer", „nach der eigenen Stimme", „erst am Ende") | nein |
| Nur bestimmte Rollen | ja | nein |
| Beschreibungstext | ja | — |
| Wer schon abgestimmt hat | im Dashboard je Antwort (außer anonym) | nur die Zahlen |

Beides gibt es mit `@everyone`-, `@here`- oder Rollen-Ping beim Start und in eigener Farbe.

---

## Starten

**In Discord:** `/umfrage erstellen frage antworten [art] [dauer] [mehrfach] [anonym] [kanal]` — Antworten mit `|` getrennt (`Ja | Nein | Vielleicht`), zwei bis zehn. Das Feld *dauer* schlägt Werte vor und rechnet Getipptes vor (`1h30m` → „1 Std. 30 Min."). `/umfrage beenden nummer` beendet vorzeitig. Beide Befehle stehen auf „Server verwalten".

**Im Dashboard:** *Umfragen* › **Neue Umfrage** — Art, Frage, Beschreibung, Antworten (mit Emoji), Kanal, Ping, Laufzeit, Mehrfachwahl, anonym, wann die Balken zu sehen sind und welche Rollen abstimmen dürfen. Daneben steht die Vorschau, bei Discord-Umfragen im Discord-Look.

**Kanal:** Textkanal, Ankündigungskanal oder ein **Beitrag in einem Forum** (im Dashboard „+ Neuer Beitrag in #forum").

---

## Abstimmen

Ein Klick auf den Knopf zählt, ein zweiter auf dieselbe Antwort zieht die Stimme zurück. Bei Mehrfachwahl schaltet jeder Knopf seine Antwort an und aus; ist eine Höchstzahl gesetzt, sagt der Bot, dass erst eine abgewählt werden muss. Jede Antwort darauf sieht **nur der Abstimmende** — mit seiner Wahl und, je nach Einstellung, dem Zwischenstand.

Die Karte im Kanal zeichnet sich höchstens alle drei Sekunden neu: auch 200 Stimmen in einer Minute überrennen Discord nicht.

---

## Ende und Ergebnis

Abgelaufene Umfragen beendet `CommunityTimers` jede Minute. Danach: Balken für alle, keine Knöpfe mehr, Karte in Grau. Bei Discord-Umfragen beendet der Bot die Umfrage in Discord (sofern sie noch läuft) und schreibt das Ergebnis fest — er wartet eine Minute nach Ablauf, weil Discord einen Moment braucht, bis die Zahlen endgültig sind.

Eine Umfrage **ohne Ende** läuft, bis jemand sie beendet — im Dashboard oder mit `/umfrage beenden`.

---

## Dashboard

`/dashboard/guild/<id>/polls` — oben die Zahlen (laufend, beendet, Stimmen), darunter die Liste: Frage, Art, Kanal, Stimmen und die Balken direkt in der Zeile. Ein Klick öffnet die große Ansicht: alle Antworten mit Zahlen und Anteil, wer was gewählt hat (außer anonym), dazu **Beenden**, **Zur Nachricht** und **Löschen** (nimmt auch die Nachricht in Discord mit).

| Route | |
|---|---|
| `GET <base>/api/guild/:id/polls` | Umfragen, Kanäle, Log-Ziele, Rollen; mit `poll=<nummer>` Zahlen und Stimmen |
| `POST <base>/api/guild/:id/polls` | `create`, `end`, `delete`, `logthread` — nur JSON |

Anfang wie überall: `ManageGate()` (`utils/managegate.ts`) — Sitzung, „Server verwalten", Datenbank, Modul an.

---

## Dahinter

| | |
|---|---|
| Tabellen | `polls` (Nummer je Server, Frage, Antworten und Einstellungen als JSON, Ergebnis bei Discord-Umfragen) und `poll_votes` (eine Zeile je Stimme, Schlüssel Umfrage + User) — Migration 014 |
| Nummer | fortlaufend je Server, vergeben in einer Transaktion (`Polls.Create`) |
| Knöpfe | `poll:vote:<id>:<antwort>`, weitergereicht von `CommunityButtons` |
| Karte | `PollCard()` in `builder/CommunityView.ts`, Balken aus `Bar()` |
| Lauf | `CommunityTimers` jede Minute (`PollService.RunDue()`) |

Geht die Umfrage beim Start nicht raus (keine Rechte im Kanal), verschwindet die angelegte Zeile wieder — es bleibt keine Leiche in der Liste.

---

## Prüfen

```bash
npm run check:community   # Eingaben, Balken, Karten, Datenbank (Nummern, Stimmen, Auszählen)
```
