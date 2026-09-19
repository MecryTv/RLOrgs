# Giveaways

Verlosungen mit Bedingungen, Bonus-Losen und Gewinnern, die sich melden müssen — wer die Frist verpasst, wird automatisch ersetzt. Starten lassen sie sich sofort oder **geplant**.

Das Modul heißt `giveaways` und wird unter *Module* eingeschaltet (oder `/module an modul:giveaways`). Ohne Datenbank geht nichts — die Giveaways und Teilnahmen stehen dort.

---

## Ein Giveaway anlegen

**In Discord:** `/giveaway start preis dauer [gewinner] [kanal] [beschreibung] [rolle] [ping]` — für alles Weitere (Bonus-Lose, mehrere Bedingungen, geplanter Start) gibt es das Dashboard. Dazu `/giveaway beenden nummer` (lost sofort aus), `/giveaway neu nummer [user]` und `/giveaway abbrechen nummer`. Alle auf „Server verwalten".

**Im Dashboard:** *Giveaways* › **Neues Giveaway** — Preis, Beschreibung, Bild, Zahl der Gewinner, Kanal (Text, Ankündigung oder Beitrag in einem Forum), Ping, Laufzeit, Start (**sofort** oder ein Zeitpunkt bis 90 Tage voraus), dazu Bedingungen, Bonus-Lose und die Frist. Rechts steht die Karte, wie sie in Discord aussieht.

Laufzeit: eine Minute bis 60 Tage, bis 50 Gewinner. Ein geplantes Giveaway startet der Bot selbst; bis dahin steht es als **geplant** in der Liste und lässt sich abbrechen.

---

## Bedingungen

Alle sind freiwillig und lassen sich kombinieren — wer nicht passt, bekommt beim Klick auf **Mitmachen** genau die Liste dessen, was ihm fehlt (nur für ihn sichtbar).

| Bedingung | |
|---|---|
| **Rollen** | eine dieser Rollen — oder, auf Wunsch, **alle** davon |
| **Verboten** | mit einer dieser Rollen geht es nicht (etwa das Team) |
| **Booster** | nur Server-Booster, oder gerade **keine** Booster |
| **Dabei seit** | mindestens so viele Tage auf dem Server („noch 5 Tage") |
| **Konto-Alter** | das Discord-Konto mindestens so viele Tage alt — gegen frische Zweitkonten |
| **Nachrichten** | mindestens so viele Nachrichten in den letzten 14 Tagen (aus dem [Activity](Activity.md)-Tracking) |
| **Verknüpftes Konto** | ein verbundenes Rocket-League-Konto (Epic, Dashboard › Einstellungen) |

Geprüft wird beim Mitmachen **und noch einmal beim Auslosen**: Wer den Server verlässt oder seine Rolle verliert, gewinnt nicht. Der Nächste rückt nach.

---

## Bonus-Lose

Je Rolle bis zu zehn Extra-Lose, bis zu zehn Rollen — **Server-Booster** gibt es dabei als eigene „Rolle". Jeder hat ein Los, Boni kommen dazu: mit `+2` für Stammgast und `+3` für Booster hat ein boostender Stammgast sechs Lose. Gezogen wird gewichtet und ohne Zurücklegen (`crypto.randomInt`), niemand gewinnt zweimal.

Die Lose werden beim Mitmachen festgehalten — wer die Rolle später bekommt, muss neu mitmachen (austragen und wieder eintragen).

---

## Gewinnen und annehmen

Unter der Karte sitzen **Mitmachen** und, nach dem Klick, **Austragen**. Die Teilnehmerzahl zieht höchstens alle fünf Sekunden nach.

Ist die Zeit um, lost der Bot aus, antwortet im Kanal mit den Gewinnern und schreibt sie in die Karte. Mit **DM an Gewinner** (Standard) bekommt jeder eine Nachricht — und, wenn eine **Frist** gesetzt ist (6, 12, 24, 48, 72 Stunden oder 7 Tage), darin den Knopf **Gewinn annehmen**.

| Stand | |
|---|---|
| **Gewonnen** | ohne Frist — der Gewinn gehört ihm |
| **Wartet** | Frist läuft, er hat noch nicht angenommen |
| **Angenommen** | hat den Knopf gedrückt |
| **Frist verpasst** | der Platz wird neu ausgelost |
| **Ersetzt** | neu ausgelost, der Platz ist weg |

Ob die DM ankam, steht am Gewinner — geschlossene DMs fallen so auf. Verpasste Fristen prüft `CommunityTimers` jede Minute und lost den Platz sofort neu aus (ist niemand mehr übrig, bleibt es beim Abgelaufenen).

**Neu auslosen** geht auch von Hand: für **alle, die noch nicht angenommen haben**, nur für die **verpassten Fristen** oder für einen **einzelnen Gewinner**. Jede Neuauslosung meldet sich im Kanal.

---

## Dashboard

`/dashboard/guild/<id>/giveaways` — oben die Zahlen (laufend, geplant, Teilnahmen, offene Gewinne), darunter die Liste mit Filter (alle, laufend, geplant, beendet). Ein Klick öffnet die große Ansicht: Preis, Kanal, Zeiten, Bedingungen, Bonus-Lose, die Gewinner mit ihrem Stand und ihrer Frist, die Teilnehmer mit ihren Losen — dazu **Jetzt auslosen**, **Neu auslosen**, **Abbrechen**, **Zur Nachricht** und **Löschen** (nimmt die Nachricht in Discord mit).

| Route | |
|---|---|
| `GET <base>/api/guild/:id/giveaways` | Giveaways, Kanäle, Log-Ziele, Rollen; mit `giveaway=<nummer>` Gewinner und Teilnehmer |
| `POST <base>/api/guild/:id/giveaways` | `create`, `end`, `reroll`, `cancel`, `delete`, `logthread` — nur JSON |

Anfang wie überall: `ManageGate()` (`utils/managegate.ts`) — Sitzung, „Server verwalten", Datenbank, Modul an.

---

## Dahinter

| | |
|---|---|
| Tabellen | `giveaways` (Nummer je Server, Bedingungen, Bonus, Einstellungen und Gewinner als JSON) und `giveaway_entries` (eine Zeile je Teilnahme mit ihren Losen) — Migration 014 |
| Status | `scheduled` → `running` → `ended`, dazwischen `cancelled` |
| Knöpfe | `giveaway:join:<id>`, `giveaway:leave:<id>`, `giveaway:claim:<id>` — weitergereicht von `CommunityButtons` |
| Karte | `GiveawayCard()` in `builder/CommunityView.ts`, dazu `WinnerDm()` und die Meldung im Kanal |
| Lauf | `CommunityTimers` jede Minute: geplante starten, Fristen prüfen. Endet eines in der nächsten Minute, setzt der Bot einen Timer **auf die Sekunde** |

Beim Auslosen wird das Giveaway **zuerst** als beendet festgehalten und dann gezogen — so lost auch ein zweiter Lauf nicht doppelt aus.

---

## Prüfen

```bash
npm run check:community   # Bedingungen, Bonus-Lose, gewichtetes Ziehen, Karten, Datenbank
```

Das Ziehen prüft der Lauf auch statistisch: zehn Lose gegen neunmal ein Los müssen in 2000 Runden rund die Hälfte gewinnen.
