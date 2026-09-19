# Moderation

Verwarnen, stummschalten, kicken, bannen, aufräumen — aus Discord per Befehl oder im Dashboard unter **Moderation**. Jede Aktion wird ein **Fall** mit fortlaufender Nummer je Server (`#12`), Grund, Dauer, Status und Verlauf. Dazu Notizen und Beweise am Fall, eine Karte im Log-Kanal und auf Wunsch eine DM an den Betroffenen.

Das Modul heißt `moderation` und wird wie jedes andere unter *Module* eingeschaltet (oder `/module an modul:moderation`). Ohne Datenbank geht nichts — die Fälle stehen dort.

---

## Die Aktionen

| Aktion | Befehl | Was passiert | Fall bleibt aktiv |
|---|---|---|---|
| Verwarnen | `/warn user grund` | Fall mit Grund (Pflicht). Erreicht der User eine **Stufe**, folgt die Strafe von selbst | bis er entfernt wird |
| Verwarnung entfernen | `/unwarn [user] [fall]` | Der Warn zählt nicht mehr. Ohne Fall: die neueste des Users | — |
| Timeout | `/timeout user dauer [grund]` | Discord-Timeout, 60 Sekunden bis 28 Tage. Ein neuer ersetzt den alten | bis er abläuft |
| Timeout aufheben | `/untimeout user` | Schaltet frei | — |
| Kick | `/kick user [grund]` | Wirft raus — mit Einladung kann er zurück | — |
| Bann | `/ban user [grund] [dauer] [loeschen]` | Auch gegen User, die nicht (mehr) auf dem Server sind. Mit Dauer befristet, der Bot hebt ihn selbst auf. `loeschen` nimmt Nachrichten der letzten Stunde bis sieben Tage mit | bis er aufgehoben wird oder abläuft |
| Entbannen | `/unban user` | Vorschläge aus der Bannliste (Name oder ID) | — |
| Nachrichten löschen | `/purge anzahl [user]` | Die letzten 1–100 Nachrichten im Kanal, auf Wunsch nur die eines Users. Nur die letzten 14 Tage (Discord), angeheftete bleiben | — |

Dazu `/fall zeigen|notiz|beweis nummer` und `/verlauf user`. Alle Antworten sieht nur der Moderator; öffentlich ist die Karte im Log-Kanal.

**Dauer-Angaben** versteht der Bot wie `10m`, `2h`, `1h30m`, `3 Tage`, `1w` oder eine nackte Zahl (Minuten). In Discord schlägt das Feld Werte vor und rechnet das Getippte vor („2h 30m" → „2 Std. 30 Min."). Was er nicht versteht, lehnt er ab — ein Tippfehler macht keinen Bann dauerhaft.

---

## Wer darf

Eine Liste für den ganzen Server: die **Moderatoren** (einzelne User und Rollen, Dashboard › *Moderatoren*, siehe [Tickets.md](Tickets.md#moderatoren)). Sie gilt für Tickets **und** Moderation.

| Wer | In Discord | Im Dashboard |
|---|---|---|
| Owner, „Server verwalten“ | alles | alles, dazu die Einstellungen |
| Moderatoren-Liste | alles | Verlauf, Fälle, alle Aktionen — keine Einstellungen |
| Nur ein Discord-Recht („Mitglieder bannen", „… kicken", „… im Timeout", „Nachrichten verwalten") | die passenden Befehle | nein |

`ModerationService.Allowed()` prüft das bei jeder Aktion, egal woher sie kommt. Die Befehle tragen deshalb **keine** Standard-Rechte in Discord: sonst sähe ein Moderator von der Liste sie nicht, wenn ihm das Discord-Recht selbst fehlt. Wer sie in Discord verstecken will, stellt das unter *Server-Einstellungen › Integrationen* ein.

Vor jeder Aktion dieselben Regeln (`CheckTarget()`): nicht sich selbst, nicht den Bot, nicht den Owner, nur nach unten in der Rollen-Reihenfolge — und nur, was der Bot selbst darf (`bannable`, `kickable`, `moderatable`; Admins lassen sich nicht stummschalten). Scheitert die Discord-Aktion trotzdem, verschwindet der schon angelegte Fall wieder.

---

## Stufen

Unter *Moderation › Einstellungen*: „ab **3** Verwarnungen → **Timeout 1 Stunde**", „ab **5** → **Kick**" (das ist auch der Standard). Bis zu zehn Stufen, je Zahl eine, als Strafe Timeout (mit Dauer), Kick oder Bann (befristet oder dauerhaft).

- Gezählt werden die **aktiven** Verwarnungen des Users — auf Wunsch nur die der letzten 30 bis 365 Tage (`warnDays`, 0 = für immer).
- Eine Stufe greift **genau** bei ihrer Zahl: die vierte Verwarnung löst die dritte Stufe nicht noch einmal aus.
- Die Strafe wird ein eigener Fall (Quelle „automatisch", Verweis auf den Warn). Geht sie nicht (etwa gegen einen Admin), steht der Grund am Warn.

---

## Ein Fall

| Feld | |
|---|---|
| Nummer | fortlaufend je Server, vergeben in einer Transaktion (`ModCases.Create`) |
| Status | Bann, Timeout und Warn sind **aktiv**, bis sie enden: aufgehoben (durch einen anderen Fall), ersetzt (neuer Timeout), abgelaufen oder in Discord selbst aufgehoben |
| Quelle | per Befehl, im Dashboard, automatisch (Stufe, Ablauf) |
| Bezug | der zurückgenommene Warn, der auslösende Warn einer Stufe, der aufgehobene Bann |
| Notizen | nur fürs Team, bis 50 je Fall. Entfernen darf der Autor oder wer den Server verwaltet |
| Beweise | Bilder (PNG, JPG, GIF, WebP bis 8 MB — einmal durch den Canvas, heraus kommt WebP) und https-Links, bis 20 je Fall. Bilder liegen unter `evidence/<server>/<fall>/` (nicht im Repo, gehört ins Backup) |

Notizen und Beweise kommen auch später dazu: im Dashboard am Fall oder mit `/fall notiz` und `/fall beweis` (Anhang oder Link).

**Befristete Banns** hebt `ModerationExpiry` jede Minute auf (ein eigener Fall „Entbannt", automatisch). Abgelaufene **Timeouts** hebt Discord selbst auf, der Lauf trägt sie nur aus. Entbannt jemand in Discord von Hand, endet der offene Bann-Fall ebenfalls (`GuildBanRemove`, Intent `GuildModeration`).

---

## Log-Kanal und DM

**Log-Kanal:** ein Textkanal oder ein **Beitrag in einem Forum** — dieselbe Auswahl wie beim Ticket-System (`utils/logtarget.ts`). Im Dashboard steht je Forum „+ Neuer Beitrag in #forum": der Bot legt ihn sofort an („Mod-Logs"). Jeder Fall ist eine Karte (Components V2) mit Knopf „Im Dashboard öffnen" (`…/moderation?fall=12`). Ändert sich am Fall etwas — Status, Notizen, Beweise —, zieht der Bot die Karte nach. Ein archivierter Beitrag wacht beim nächsten Fall von selbst auf.

**DM an den User** (Standard an): Aktion, Server, Grund, Dauer und Fallnummer — **ohne** den Namen des Moderators. Bei Bann und Kick geht sie **vor** der Aktion raus, danach teilt der User keinen Server mehr mit dem Bot. Ob sie ankam, steht am Fall. Beim Entbannen gibt es keine: ohne gemeinsamen Server kommt sie nicht an.

---

## Dashboard

`/dashboard/guild/<id>/moderation` — oben die Zahlen (aktive Banns, Timeouts, Warns, Fälle in 30 Tagen; ein Klick filtert), darunter:

- **Verlauf** — alle Fälle, neueste zuerst, Suche nach Fallnummer, Name, Discord-ID oder Grund, Filter nach Art und „nur aktive". Mit `?user=<id>` der Verlauf eines Users mit Kopf: Status (auf dem Server, gebannt, stumm bis …), Zahlen je Aktion, Knöpfe für die nächste Aktion. `/verlauf` in Discord verlinkt dorthin.
- **Ein Fall groß** — Klick auf eine Zeile oder `?fall=12`: alle Angaben, Zusammenhang, „Aufheben" (Bann, Timeout, Warn), Notizen, Beweise (hochladen oder Link).
- **Neue Aktion** — Aktion wählen (nur die erlaubten), User suchen (bei Entbannen in der Bannliste), Grund, Dauer (Vorschläge oder frei), ein Satz sagt, was passiert. Bann, Kick und Löschen brauchen einen zweiten Klick.
- **Einstellungen** (nur „Server verwalten") — Log-Kanal, DM, wie lange Warns zählen, die Stufen.

Wer die Moderation sieht: `canModerate` an der Serverkarte (`DashboardService.Supported()`) — wer verwaltet, und die Moderatoren-Liste, wenn das Modul an ist. Support-Rollen der Tickets allein reichen nicht.

| Route | |
|---|---|
| `GET <base>/api/guild/:id/moderation` | Liste (`q`, `action`, `status=active`, `user`, `before`), mit `meta=1` Rechte, Einstellungen, Kanäle, Log-Ziele; mit `case=12` ein Fall samt Zusammenhang und User-Kopf |
| `POST <base>/api/guild/:id/moderation` | `act`, `note`, `note-remove`, `link`, `evidence-remove`, `members`, `bans`, `save`, `logthread` — nur JSON |
| `POST <base>/api/guild/:id/moderation/evidence/:fall` | Beweisbild roh als Body (`image/*`), Name in `?name=` |
| `GET <base>/api/guild/:id/moderation/evidence/:id/:datei` | Ein Beweisbild — nur für die Moderatoren des Servers |

Gemeinsamer Anfang aller drei: `ModGate()` (`utils/modgate.ts`) — Sitzung, `canModerate`, Datenbank, Modul an, Mitglied des Servers.

---

## Was der Bot braucht

- **Rechte:** Mitglieder bannen, kicken, im Timeout; Nachrichten verwalten und Verlauf lesen (für `/purge`); im Log-Kanal schreiben, im Forum Beiträge erstellen.
- **Intent** `GuildModeration` (nicht privilegiert) — für Entbannungen in Discord und die Bannliste von `/unban`.
- Seine Rolle über den Rollen derer, die er bestrafen soll.

---

## Prüfen

```bash
npm run check:moderation   # Dauer-Angaben, Stufen, Einstellungen, Log-Ziele, Karten, Datenbank (Nummern, Suche, Sperre beim Ändern)
```

Bannen, Kicken und Timeouts selbst brauchen einen echten Server — die fängt erst ein Lauf dort.
