# Rang-Tracking (Prime)

Die Ränge für **1v1, 2v2 und 3v3** kommen von **Prime** (`prime.rocketplanet.gg`), einem Zugang zu den PsyNet-Daten von Rocket League. Im Dashboard stehen sie im Nutzermenü unter **RL Tracker**.

Ohne `PRIME_API_TOKEN` bleibt das Tracking aus — alles andere läuft weiter.

---

## Einrichten

Token unter <https://prime.rocketplanet.gg/access> holen und in die `.env`:

```bash
PRIME_API_TOKEN="..."
```

Prüfen:

```bash
npm run check:prime -- DEIN_EPIC_NAME
```

Ohne Namen wird nur gerechnet und geprüft, was ohne Netz geht; mit Namen geht eine echte Anfrage raus.

---

## Wie die MMR entsteht

Prime liefert den **internen Skill-Wert**, nicht die Zahl aus dem Spiel. Umgerechnet wird sie so:

```
MMR = Wert * 20 + 100
```

| Wert von Prime | Angezeigt |
|---|---|
| `62.4867` | **1350** |
| `53.9804` | **1180** |
| `33.9633` | **779** |

Gerundet wird kaufmännisch (`Math.round`), nicht abgeschnitten. Steht diese Formel falsch, sieht jede Zahl im Dashboard trotzdem plausibel aus — deshalb prüft `npm run check:prime` sie gegen echte Werte.

**Rang und Division** kommen dagegen fertig von Prime: `Tier` von 0 (Unranked) bis 22 (Supersonic Legend), `Division` von 0 bis 3 — im Spiel heißen die I bis IV. Ohne Rang wird keine Division angezeigt, statt eine zu erfinden.

---

## Der Weg zu den Daten

Zwei Aufrufe, beide über `PrimeService`:

| Schritt | Endpunkt | Rein | Raus |
|---|---|---|---|
| 1 | `/Resolver/ResolveUser` | `{ User: "MecryTv" }` | Konto samt Plattform und verknüpften Konten |
| 2 | `/Players/GetFullProfile` | `{ PlayerID: "Epic\|<AccountID>\|0" }` | `Skills`, `RewardLevels`, `Leaderboards`, `Titles` |

Die **PlayerID** wird aus der Antwort von Schritt 1 zusammengesetzt: `<Plattform>|<AccountID>|0`. Die Plattformnamen unterscheiden sich zwischen Resolver und PsyNet:

| Prime liefert | PlayerID braucht |
|---|---|
| `Epic Games` | `Epic` |
| `PlayStation` | `PS4` |
| `Xbox` | `XboxOne` |
| `Nintendo` | `Switch` |
| `Steam` | `Steam` |

Aufgelöst wird immer über den **Epic-Namen** — jedes Rocket-League-Konto hängt an einem Epic-Konto, auch bei Steam, Xbox, PlayStation oder Switch. Genau deshalb fragt der RL Tracker beim ersten Aufruf danach.

### Der Ingame-Club

`GetFullProfile` liefert bei Spielern, die in einem Club sind, zusätzlich
`ClubDetails` — Name, Tag, Farben, Owner und die vollständige Mitgliederliste.
Es braucht dafür **keine** eigene Anfrage; das Feld fehlt schlicht, wenn der
Spieler in keinem Club ist.

```json
"ClubDetails": {
  "ClubID": 12345,
  "ClubName": "TEAM RAPTOR",
  "ClubTag": "TR",
  "OwnerPlayerID": "Steam|76561198148599803|0",
  "Members": [{ "PlayerID": "…", "EpicPlayerID": "…", "PlayerName": "ELDRIFTING", "RoleID": 1 }],
  "bVerified": false,
  "CreatedTime": 1535564461
}
```

Gemeint ist der Club **aus dem Spiel** — nicht die Tabelle `clubs`, die der Bot
für eigene Zwecke führt. Die beiden haben nichts miteinander zu tun.

Für die Club-MMR fehlen in `ClubDetails` die Ränge der Mitglieder. Die holt
`/Skills/GetPlayersSkills` mit `{ PlayerIDs: [...] }` in **einem** Aufruf — die
einzige zusätzliche Anfrage, und sie geht nur raus, wenn überhaupt ein Club da
ist.

Ausgetretene Mitglieder bleiben mit gesetztem `DeletedTime` in der Antwort
stehen und werden übersprungen.

> **Einschränkung:** Für fremde Mitglieder kennt der Bot keinen Peak — Prime
> liefert nur den aktuellen Stand. Die WTSI-Rechnung läuft für sie deshalb mit
> „aktuell = Peak", der Schutz gegen Deranking fällt dabei weg. Für eigene
> Nutzer führt `player_ranks` den echten Peak mit.

### Verknüpfte Plattformen

`ResolveUser` gibt zu jedem Konto `LinkedAccounts` zurück — dieselbe Person auf
Steam, Xbox, PlayStation und Switch, jeweils mit Kennung und Anzeigename:

```json
"LinkedAccounts": [
  { "AccountID": "76561198874822058", "DisplayName": "MecryTv", "IdentityProvider": "Steam" },
  { "AccountID": "2535457645913828",  "DisplayName": "MecryTv", "IdentityProvider": "Xbox" }
]
```

Der Bot **wertet das nicht aus**. Eine frühere Fassung schrieb diese Plattformen
als eigene Verknüpfungen mit; das ist mit Migration 007 wieder entfernt, weil die
Ränge ohnehin auf allen Plattformen dieselben sind (siehe unten). Das Feld bleibt
hier dokumentiert, weil es der Grund ist, warum ein einziger Login genügt.

`ResolveUser` nimmt außerdem statt des Namens die **32-stellige Epic-Konto-ID** —
genau das, was der Epic-Login zurückgibt. Der erlaubte Bereich steht in der
Fehlermeldung des Dienstes: `/^(?:[0-9A-Za-z]{32,34}|.{3,16})$/`.

### Die Ränge sind auf allen Plattformen dieselben

Nachgemessen: `GetFullProfile` liefert für `Epic|<id>|0` und `Steam|<id>|0`
desselben Spielers identische Werte, gleiche MMR und gleiche Karriere-Zahlen.

Das ist der Grund, warum es im Dashboard keine Plattform-Auswahl gibt. Sie hätte
an keiner einzigen angezeigten Zahl etwas geändert.

### Playlists

Von den `Skills` interessieren drei IDs; der Rest (Hoops, Rumble, Dropshot, Snowday, Turniere, Casual) wird nicht angezeigt.

| ID | Playlist |
|---|---|
| `10` | 1v1 Duell |
| `11` | 2v2 Doppel |
| `13` | 3v3 Standard |

Eine Playlist, die Prime nicht liefert, fällt weg — sie wird nicht mit Nullen aufgefüllt.

---

## Transport: QUERY über HTTP/2

Prime spricht die HTTP-Methode **`QUERY`**, und die geht **ausschließlich über HTTP/2**. Über HTTP/1.1 — und damit über `fetch`, Axios im Standard und die meisten Clients — antwortet der Dienst stumpf mit `400`.

`PrimeService` benutzt deshalb `node:http2` direkt. Eine Verbindung wird offen gehalten und für weitere Anfragen wiederverwendet.

> **Eine Falle, die der Prüflauf gefunden hat:** die ruhende Verbindung ist `unref()`-t, damit sie den Prozess nicht am Leben hält. Ohne ein Gegenstück beendet sich ein kurzlebiger Prozess dann **mitten in der Anfrage**. `PrimeService` zählt offene Anfragen mit und hält die Verbindung nur solange fest, wie wirklich etwas läuft.

### Fehler kommen mit HTTP 200

Fachfehler liefert Prime als `200` mit einem `Error`-Objekt im Rumpf:

| `Error.Type` | Bedeutung |
|---|---|
| `RequestError` | Die PlayerID hat das falsche Format |
| `InvalidPlayer` | Format passt, den Spieler gibt es nicht |

`PrimeService` übersetzt das in einen `PrimeError` mit `type`. Ein unbekannter Spieler wird zu `null` (die Route antwortet `404`), alles andere wirft weiter (die Route antwortet `502` — das Problem sitzt dann nicht im Dashboard).

---

## Wie oft geholt wird

**Alle zehn Minuten, nicht öfter.** Der Takt hängt an der Datenbank, nicht am Arbeitsspeicher:

1. `player_ranks.updated_at` sagt, wie alt der gespeicherte Stand ist — maßgeblich ist die **älteste** der drei Zeilen.
2. Ist er jünger als zehn Minuten, geht **gar keine** Anfrage nach draußen; die Seite liest aus der Tabelle.
3. Sonst wird geholt, gespeichert und ausgeliefert.

Angezeigt wird immer der **gespeicherte** Stand — auch direkt nach dem Holen. So steht überall dieselbe Zahl, egal aus welcher Richtung sie kommt. Antwortet Prime gerade nicht, bleibt der letzte bekannte Stand stehen, statt die Seite leer zu lassen.

Reward-Level und Karriere-Werte liegen im selben Takt in `player_profiles` — sonst wären sie im Zehn-Minuten-Fenster verschwunden.

Zusätzlich hält `PrimeService` dieselben zehn Minuten im Arbeitsspeicher, höchstens 500 Einträge. **Auch ein „kennt Prime nicht" wird gespeichert**, sonst fragt jeder Tippfehler erneut nach.

### Der Peak

Beim Speichern wächst `peak_mmr` über `GREATEST(peak_mmr, VALUES(mmr))` mit — und fällt nie. Genau darauf setzt die [WTSI-Rechnung](#club-mmr-wtsi) auf: wer vor einem Turnier absichtlich Rang abgibt, drückt seinen Wert damit nicht.

Der Token liegt beim Bot und **nie im Browser**: die Seite ruft `/dashboard/api/tracking/:userId` auf, und erst der Bot spricht mit Prime.

---

## Im Dashboard

Das Epic-Konto liegt **serverseitig** in `player_accounts`, nicht im Browser. Daraus folgt:

* Wer schon verbunden ist, wird im **RL Tracker** nicht erneut gefragt — das Konto wird übernommen.
* Beim **ersten** Verbinden prüft der Bot den Namen gegen Prime. Kennt Prime ihn nicht, wird nichts gespeichert.
* Ein Wechsel ist erst nach **3 Tagen** wieder möglich (`LINK_COOLDOWN_DAYS`). Im Entwicklungsmodus sind es **10 Sekunden**, sonst ließe sich das nicht testen. Derselbe Name noch einmal gilt nicht als Wechsel.

Die **volle Übersicht** steht unter `/dashboard/<userId>/tracking`: Rang-Abzeichen für 1v1, 2v2 und 3v3, MMR, Division, Spiele und Serie, dazu Karriere-Werte, Season-Reward und der Club. Die eigene Seite sieht jeder, fremde nur Administratoren und Developer.

### Platzierungsspiele

Solange die **zehn Platzierungsspiele** nicht durch sind, zeigt Rocket League selbst kein Abzeichen. Das Dashboard hält sich daran: unter zehn Spielen steht das **Unranked**-Abzeichen und „Platzierung 3/10", auch wenn Prime im Hintergrund längst eine Stufe liefert. Erst ab zehn erscheinen Rang und Division.

### Club-MMR (WTSI)

Der Durchschnitt eines Clubs wird nach **WTSI** gerechnet, dem Weighted True
Skill Index. Die Rechnung, ihre Begründung und die Fälle, die sie abfängt,
stehen in [WTSI.md](WTSI.md). Für Spieler erklärt sie das Dashboard selbst unter
`/dashboard/docu#wtsi`.

Die Rechnung steht in `src/constants/WTSI.ts` und wird von `npm run check:db`
gegen von Hand nachgerechnete Werte geprüft.

## Im Discord: `/rank`

Dieselben Daten wie im Dashboard, nur als Bild. Drei Unterbefehle:

| Befehl | Was er tut |
|---|---|
| `/rank link <epicname>` | Verbindet das Epic-Konto mit dem Discord-Konto. Prüft den Namen erst bei Rocket League, speichert ihn nur, wenn es ihn gibt. Antwort nur für den Aufrufer sichtbar |
| `/rank me` | Die eigene Karte. Sucht über die gespeicherte **Konto-ID**, nicht über den Namen — wer sich im Spiel umbenennt, bleibt derselbe Spieler |
| `/rank unlink` | Trennt die Verknüpfung wieder. Danach lässt sich ein anderes Konto verbinden |
| `/rank search <epicname>` | Die Karte zu einem beliebigen Epic-Namen. Hat jemand dieses Konto hier verknüpft, steht sein Discord-Name mit auf der Karte |

Unter jeder Antwort steht ein Knopf **Beim Tracker ansehen** (`TrackerURL()`), der zum öffentlichen Profil auf rocketleague.tracker.network führt: die Karte zeigt den Stand, der Tracker die Historie. Ein Link-Knopf, kein Klick-Ereignis — Discord öffnet die Adresse selbst, der Bot schreibt nichts mit, und der Knopf bleibt gültig, solange die Nachricht steht.

Der Name gehört dabei kodiert in die Adresse: Epic-Namen dürfen Leerzeichen und Sonderzeichen enthalten, und ein Doppelkreuz würde die Adresse sonst stillschweigend abschneiden. `npm run check:prime` prüft genau das.

**Der Name wird geprüft, bevor etwas gespeichert wird.** `/rank link` fragt zuerst bei Rocket League nach; einen Namen, den es dort nicht gibt, speichert der Bot gar nicht erst. Die Antwort zeigt seit Neuestem auch, *was* gefunden wurde (`2v2 Champion III (1350) · 3v3 Champion I (1180)`) — sonst bleibt für den Nutzer offen, ob er sich vertippt und trotzdem etwas verbunden hat.

`/rank link` teilt sich Sperrfrist und Speicherweg mit dem Dashboard (`EpicAdopt`): **drei Tage** (`LINK_COOLDOWN_DAYS`), im Entwicklungsmodus zehn Sekunden. Derselbe Name noch einmal zählt nicht als Wechsel.

**`/rank unlink` unterliegt derselben Frist**, und das ist kein Übereifer: `Cooldown()` rechnet gegen `changed_at` in der Kontozeile, und `Unlink()` löscht genau diese Zeile. Wäre Trennen frei, wäre trennen und neu verbinden ein Weg, die Wartezeit einfach zu überspringen.

### Kein Guild-Bezug

`player_accounts`, `player_ranks` und `player_profiles` sind auf `user_id` allein geschlüsselt — nirgends steht eine `guild_id`. Der Befehl ist global registriert und liest nur `interaction.user.id`. Beides zusammen heißt: **wer sich einmal verknüpft, ist auf jedem Server verknüpft, auf dem der Bot ist.**

Das steht nirgends im Code, sondern im Schema, und wäre damit still zu verlieren. `npm run check:prime` liest deshalb die Migrationen und schlägt an, sobald eine der drei Tabellen eine `guild_id` bekommt — auch nachträglich per `ALTER TABLE`.

**Warum jede Antwort verzögert wird:** Discord erwartet innerhalb von drei Sekunden eine Reaktion. Die Karte braucht beim ersten Mal rund eine halbe Sekunde, danach etwa 0,4 — knapp, aber die Prime-Abfrage kommt davor. Deshalb steht in jedem Zweig ein `deferReply()`.

### Die Karte

Gezeichnet mit `@napi-rs/canvas` in `src/builder/RankCard.ts`, Maße und Farben in `src/constants/RankCard.ts`.

**Der Hintergrund ist gezeichnet, kein Bild.** Vorher lag dort ein fertiges Motiv; es sah nach KI aus — weiche, beliebige Formen ohne Bezug zu dem Raster, auf das die Panels danach gelegt wurden. Der gezeichnete Grund kennt die Maße der Karte: Grundverlauf, zwei weiche Lichter (rot unten rechts, blau oben links), schräge Bänder im selben Winkel wie die abgeschrägten Panel-Ecken, ein kaum sichtbares Raster, Neonlinien nur in den Ecken, Vignette. In dieser Reihenfolge, und bewusst sparsam — die Vorgabe lautet *clean > maximal viele Effekte*.

**Schriften.** Oxanium für Namen, Ränge und Zahlen, Rajdhani für Labels, Orbitron als Akzent beim Season-Reward — so gibt es die Typografie-Vorlage vor. Die `.ttf`-Dateien liegen in `src/assets/fonts/` und werden beim ersten Rendern registriert.

Zwei Fallen stecken darin, beide gemessen und behoben:

* Die Vorlage nennt `registerFont()` aus dem Paket `canvas`. `@napi-rs/canvas` heißt das `GlobalFonts.registerFromPath()`. Dasselbe, anderer Name.
* Registrieren liest Dateien, ist also asynchron. Wird nicht darauf gewartet, zeichnet die **erste** Karte nach dem Start mit einer Systemschrift — ohne Fehler, nur falsch. `RenderRankCard()` wartet deshalb auf `RegisterFonts()`.

**Symbole mit leerem Rand.** `epicgames.png` trägt sein Motiv auf 16 % der Bildbreite, der Rest ist durchsichtig. Wer so ein Bild in ein Feld zeichnet, skaliert die Leere mit und bekommt einen Fleck. `contentBox()` misst deshalb einmal je Bild, wo überhaupt etwas steht, und `drawIcon()` zeichnet nur diesen Ausschnitt.

Gemessen wird auf einer auf 256 px verkleinerten Kopie, nicht auf dem Original. Das ist kein Geiz: die verschachtelte Schleife über ein Rang-Abzeichen mit 1381 × 1381 Bildpunkten kostete **1,4 Sekunden pro Bild** — bei fünf großen Bildern also fast neun Sekunden für die erste Karte. Mit dem Raster sind es 0,5. Der gerasterte Rahmen fällt dabei immer etwas größer aus als der genaue, schneidet also nie etwas ab.

**Schwarze Symbole.** Die Karriere-Symbole sind schwarz auf durchsichtig und wären auf der dunklen Karte unsichtbar. `tinted()` färbt sie über `source-in` um: die Farbe wird ersetzt, die Form bleibt.

**Season-Reward.** Eine Reward-Stufe umfasst drei Ränge, und gezeigt wird der **höchste**: der Reward „Diamant" ist Diamant III, nicht Diamant I (`RewardTier()`). Supersonic Legend hat nur einen Rang — die Rechnung ist deshalb gedeckelt, sonst zeigte sie über das Ende der Liste hinaus.

**Farbe je Karriere-Wert.** Die Symbole werden eingefärbt (`CAREER_COLORS`), nicht alle weiß: sechs gleiche Formen in einer Reihe verschwimmen sonst zu einem Band. Die Rang-Abzeichen bekommen einen Schein in ihrer Rangfarbe — dunkles Metall auf dunklem Grund ging darin unter.

**Sperrung.** Die HUD-Labels stehen gesperrt. Das macht `ctx.letterSpacing`, nicht eine Schleife über die Buchstaben — die setzte ohne Kerning sichtbare Lücken mitten in Wörter („ASS ISTS").

### Wie alt die Zahlen sind

Prime wird **höchstens alle zehn Minuten** gefragt (`PRIME_CACHE_TTL`); dazwischen kommt jede Antwort aus dem Zwischenspeicher. Der Eintrag selbst wird aber deutlich länger aufgehoben — `PRIME_CACHE_KEEP`, derzeit 24 Stunden.

Der Unterschied ist der Notvorrat: Ist der Eintrag nicht mehr frisch, wird neu geholt. Schlägt **das** fehl, weil Prime gerade nicht antwortet, kommt der alte Stand zurück statt einer Fehlermeldung — mit `stale: true` markiert. Die Karte schreibt es dann unten links hin, orange und mit Warnzeichen:

> ⚠ Rocket League antwortet gerade nicht — angezeigt wird der Stand von vor 3 Stunden

Ohne alten Stand bleibt es beim Fehler; einen zu erfinden wäre schlimmer als keiner.

Im Normalfall steht dort schlicht, wie alt die Zahlen sind (`Stand vor 4 Minuten · wird alle 10 Minuten erneuert`) — dieselbe Auskunft wie der Zähler auf der Tracking-Seite im Dashboard.

`PrimeService.Load()` ist `protected` und nicht `private`. Das ist Absicht: `npm run check:prime` stellt damit einen Ausfall nach und prüft beide Wege — mit altem Stand und ohne. Ungetestet wäre dieser Zweig das Papier nicht wert, auf dem er steht, denn zu sehen bekommt man ihn nur, wenn ohnehin gerade etwas schiefgeht.

```
npm run check:card
```

prüft, was eine Karte still kaputt macht: fehlende Schriften, fehlende Abzeichen, ein Rendering, das zu lange dauert oder zu groß für Discord wird. Dazu ein Profil ganz ohne Club, Ränge und Karriere — auch das darf die Karte nicht ins Stolpern bringen. Das Ergebnis liegt danach als `card-check.png` zum Ansehen bereit.

---

## Routen

| Route | Antwort |
|---|---|
| `GET /dashboard/api/tracking/:userId` | Konto, Ränge und Karriere-Werte. `401` ohne Sitzung, `403` bei fremden Seiten, `404` ohne verknüpftes Konto |
| `POST /dashboard/api/account/epic` | Notweg ohne Epic-Login: prüft den Namen und verknüpft ihn. `404` unbekannt, `429` gesperrt, `502` Prime gestört |
| `GET /dashboard/link/epic` | Schickt den Browser zur Epic-Anmeldung |
| `GET /dashboard/link/epic/callback` | Nimmt den Code entgegen, verknüpft und springt mit `?epic=<status>` zurück |
| `GET /dashboard/api/accounts` | Das verknüpfte Epic-Konto samt Sperrfrist |
| `GET /dashboard/docu` | Die WTSI-Rechnung, für Spieler erklärt, samt Rängen und Gruppen. Ohne Anmeldung lesbar |

Auf 30 beziehungsweise 10 Anfragen pro Minute gedeckelt — am anderen Ende hängt ein fremder Dienst.

---

## Aufbau

```
src/constants/Prime.ts                     Endpunkt, Playlists, Ränge, Umrechnung
src/services/PrimeService.ts               HTTP/2-Client, Auflösung, Profil, Cache
src/interfaces/services/prime/IPrimeService.ts
src/routes/DashboardApiTracking.ts         GET /dashboard/api/tracking/:userId
src/routes/DashboardApiAccount.ts          POST /dashboard/api/account/epic (Notweg)
src/routes/DashboardApiAccounts.ts         GET  /dashboard/api/accounts
src/routes/DashboardDocu.ts                GET  /dashboard/docu
src/routes/DashboardWTSI.ts                GET  /dashboard/wtsi (301 auf /dashboard/docu#wtsi)
src/routes/DashboardPrivacy.ts             GET  /dashboard/privacy
src/routes/DashboardLinkEpic.ts            GET  /dashboard/link/epic
src/routes/DashboardLinkEpicCallback.ts    GET  /dashboard/link/epic/callback
src/constants/Epic.ts                      Epic-Endpunkte und Scope
src/commands/user/Rank.ts                  /rank link | me | search
src/builder/RankCard.ts                    Die Karte, gezeichnet mit @napi-rs/canvas
src/constants/RankCard.ts                  Masse, Farben, Abzeichen-Dateien
src/assets/fonts/                          Oxanium, Rajdhani, Orbitron (.ttf)
                                           (Hintergrund und Logo: keine Bilder mehr noetig)
src/scripts/CheckCard.ts                   npm run check:card
src/utils/epic.ts                          Token-Tausch und EpicAdopt
src/routes/DashboardTracking.ts            GET /dashboard/user/<userId>/tracking
src/models/PlayerRanks.ts                  Gespeicherte Ränge, Peak, Reward-Level
src/models/Clubs.ts                        Eigene Clubs des Bots (nicht die aus dem Spiel)
src/constants/WTSI.ts                      Die Rechnung
src/scripts/CheckPrime.ts                  npm run check:prime
```

---

## Was noch fehlt

Der **Verlauf**. `player_ranks` hält heute nur den letzten Stand je Playlist, nicht die Historie — für eine Kurve über die Saison müsste jeder Abruf als eigene Zeile mitgeschrieben werden. Der Peak wird bereits geführt, das Gerüst steht also.

Der **Ingame-Club** wird gelesen, nicht geschrieben — Gründen, Beitreten und Verlassen passiert im Spiel. Die Tabelle `clubs` des Bots ist davon unberührt: sie hat weiterhin keine Oberfläche zum Anlegen und wird im Dashboard nirgends angezeigt.

Für **PlayStation** und **Nintendo** gibt es keinen öffentlichen Login. Beide hängen ausschließlich über das Epic-Konto herein; eine eigene Anmeldung wäre nur über inoffizielle Wege möglich und würde bei jeder Änderung brechen.

Der Umweg über `rocketleague.tracker.network` ist weg — die Übersicht liegt jetzt im Dashboard selbst.
