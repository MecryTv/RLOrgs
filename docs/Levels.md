# Level System

Punkte fürs Schreiben und für die Zeit im Sprachkanal, Rollen ab einem bestimmten Level und eine Rangliste. In Discord zeigt `/level rang` den eigenen Stand als Karte, `/level rangliste` die Besten des Servers.

Das Modul heißt `levels` und wird unter *Module* eingeschaltet (oder `/module an modul:levels`). Ohne Datenbank gibt es keine Punkte.

> `/rank` ist etwas anderes: das sind die Rocket-League-Ränge aus [Prime.md](Prime.md). Hier geht es um die Punkte des Servers.

---

## Punkte

| | |
|---|---|
| **Chat** | Je Nachricht eine zufällige Zahl zwischen zwei Werten (Standard 15–25), aber höchstens alle 60 Sekunden. Die Sperre lässt sich auf 0 bis 3600 Sekunden stellen |
| **Voice** | Je Minute im Sprachkanal (Standard 5). Standardmäßig nur, wenn jemand anderes dabei ist und man sich nicht selbst stumm geschaltet hat; der AFK-Kanal zählt nie. Beides lässt sich umstellen |
| **Bonus** | Faktor 0,1 bis 5 je Rolle und je Kanal. Von mehreren Rollen zählt die höchste, der Kanal-Faktor kommt obendrauf |
| **Ohne Punkte** | Kanäle (auch ganze Kategorien) und Rollen, die leer ausgehen |

Die Voice-Punkte verteilt `CommunityTimers` jede Minute: Der Bot schaut, wer gerade in einem Sprachkanal sitzt — Beitritts- und Austrittszeiten muss er sich dafür nicht merken.

**Die Kurve** hängt an einer Zahl: Von Level *n* auf *n+1* braucht es `Basis × (n+1)` Punkte. Mit der Standard-Basis 100 sind das 100 Punkte für Level 1, 1500 für Level 5 und 5500 für Level 10. Eine höhere Basis macht alles langsamer, ohne dass sonst etwas umgestellt werden muss.

---

## Aufsteigen

Wer genug Punkte hat, steigt auf. Dann passiert zweierlei:

**Belohnungsrollen** — bis zu 25 Stück, je eine ab einem Level. Zwei Arten:

- **Sammeln** (Standard): Alle erreichten Rollen bleiben.
- **Ersetzen**: Nur die höchste erreichte bleibt, die vorherigen nimmt der Bot wieder weg.

Im Dashboard gibt es dazu **Rollen nachtragen**: Der Bot geht alle durch, die das Level schon haben, und vergibt, was fehlt — praktisch, wenn ihr eine Rolle später hinzufügt.

**Die Nachricht** — im Kanal, in dem es passiert, in einem festen Kanal, per DM oder gar nicht. Geschrieben wird sie im selben Editor wie alle anderen Nachrichten des Bots, mit diesen Platzhaltern:

| | | | |
|---|---|---|---|
| `{user}` | Erwähnung | `{xp}` | Punkte insgesamt |
| `{user.name}` | Name | `{xp.next}` | Punkte bis zum nächsten Level |
| `{user.id}` | ID | `{rank}` | Platz in der Rangliste |
| `{level}` | Neues Level | `{guild}` | Server-Name |
| `{level.old}` | Altes Level | `{channel}` | Kanal, in dem es passiert ist |

---

## Rangliste ohne Anmeldung

Jeder Server kann seine Rangliste öffentlich stellen: Dashboard › *Rangliste* › **Öffentlich**. Dann liegt sie unter

```
<SERVER_PUBLIC_URL>/rangliste/<server-id>
```

und jeder mit dem Link sieht sie — ohne Discord-Login, ohne Konto. Den Link kopiert ihr direkt aus der Karte.

Zu sehen sind **Platz, Anzeigename, Profilbild, Level und Punkte**, dazu Nachrichten und Voice-Minuten; die ersten 100 Plätze. Mehr gibt die Seite nicht heraus, und ohne den Schalter antwortet sie mit 404 — auch dann, wenn es den Server gibt.

**Der Schalter steht standardmäßig auf aus.** Wer ihn anschaltet, veröffentlicht Namen und Bilder seiner aktivsten Mitglieder; das sollte der Server wissen, bevor er es tut.

---

## In Discord

| Befehl | |
|---|---|
| `/level rang [user]` | Der eigene Stand als Karte: Avatar, Level, Platz, Fortschrittsbalken, Nachrichten und Voice-Zeit. Ohne Angabe die eigene |
| `/level rangliste [seite]` | Die Besten, zehn je Seite |

Die Karte wird mit `@napi-rs/canvas` gezeichnet (`builder/LevelCard.ts`) — dieselben Schriften und Farben wie die Rang-Karte, nur kleiner. Geladen wird dafür nur der Avatar.

---

## Dashboard

Zwei Seiten: **Level System** stellt ein, **Rangliste** zeigt die Zahlen. Die Rangliste steht in der Leiste eingerückt unter dem Level System — so wie Live Tickets unter dem Ticket System. Einen eigenen Schalter hat sie nicht: sie kommt mit dem Modul.

`/dashboard/guild/<id>/levels`

- **Punkte** — Chat, Voice, Kurve, Bonus-Faktoren und die Ausnahmen.
- **Aufsteigen** — wohin die Nachricht geht, der Editor mit Live-Vorschau, die Belohnungsrollen und „Rollen nachtragen".

`/dashboard/guild/<id>/leaderboard`

- **Öffentliche Rangliste** — der Schalter samt Link; er gilt sofort, ohne Speichern.
- **Rangliste** — 25 je Seite, mit Level, Punkten, Fortschritt, Nachrichten und Voice-Minuten.
- **Punkte von Hand** — einem Mitglied Punkte setzen oder dazugeben (auch negativ), seinen Stand zurücksetzen oder die ganze Rangliste löschen.

| Route | |
|---|---|
| `GET <base>/api/guild/:id/levels` | Einstellungen, Vorlage, Grenzen und die Rangliste (`page`) |
| `POST <base>/api/guild/:id/levels` | `save`, `members`, `adjust`, `sync`, `reset` — nur JSON |
| `GET <base>/rangliste/:id` | Die öffentliche Seite — ohne Anmeldung |
| `GET <base>/api/public/levels/:id` | Die Liste dazu. 404, solange die Rangliste nicht öffentlich steht |

Anfang wie überall: `ManageGate()` (`utils/managegate.ts`) — Sitzung, „Server verwalten", Datenbank, Modul an.

---

## Dahinter

| | |
|---|---|
| Tabelle | `levels` (Punkte, Level, Nachrichten, Voice-Minuten je Server und Mitglied) — Migration 017 |
| Einstellungen | `module_settings` unter `levels` |
| Chat | `LevelMessages` hört auf `MessageCreate`; die Sperre steht im Speicher **und** in der Zeile, überlebt also einen Neustart |
| Voice | `CommunityTimers` jede Minute |
| Addieren | Ein einziges `INSERT … ON DUPLICATE KEY UPDATE xp = xp + …` — zwei Nachrichten in derselben Sekunde verlieren dadurch keine Punkte |

---

## Prüfen

```bash
npm run check:levels   # Kurve hin und zurück, Einstellungen, Karte als PNG, Rangliste und Belohnungsrollen
```

Punkte fürs Schreiben und fürs Sitzen im Sprachkanal fallen erst auf einem echten Server an.
