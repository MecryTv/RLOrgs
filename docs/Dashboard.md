# Dashboard

Das Webpanel. Wer die Seite aufruft und keine Sitzung hat, landet ohne Zwischenschritt bei der Discord-Anmeldung — es gibt keine öffentliche Ansicht.

Frontend: `src/dashboard` (HTML, CSS, TypeScript). Backend: die Routen `src/routes/Dashboard*.ts` und der `DashboardService`.

Jeder angezeigte Wert stammt aus Discord oder aus dem Bot selbst. Es gibt keine Beispieldaten im Code — steht ein Feld leer, dann weil es die Daten noch nicht gibt.

---

## Zwei Adressen

Das Dashboard hängt an zwei verschiedenen Stellen, je nach Modus:

| Modus | Adresse | Präfix |
|---|---|---|
| `--dev` | `http://localhost:3000/dashboard` | `/dashboard` |
| Betrieb | `https://dashboard.nexus-emb.de` | keins — es liegt an der Wurzel |

Im Betrieb hat das Dashboard eine eigene Subdomain, die Hauptseite steht auf `nexus-emb.de`. Beide Adressen stehen in der `.env` (`SERVER_PUBLIC_URL` und `SITE_PUBLIC_URL`, siehe [Environment.md](Environment.md)).

Im Code steht das **einmal**: `DASHBOARD_PATH` in `src/constants/Dashboard.ts` ist `/dashboard` mit `--dev` und sonst leer. Alles Weitere zieht daraus:

- **Routen** setzen es vor ihren Pfad (`${DASHBOARD_PATH}/api/me`).
- **HTML-Seiten** tragen den Platzhalter `__BASE__`; `SendPage()` ersetzt ihn beim Ausliefern.
- **Das Frontend** liest ihn an seiner eigenen Adresse ab: `core/Base.ts` steht immer unter `<wurzel>/assets/core/Base.js`, zwei Ebenen darüber liegt die Wurzel. Deshalb muss keine Seite ihn mitgeben.

In diesem Dokument steht **`<base>`** für beides — lies es als `/dashboard` im Entwicklungsmodus und als nichts im Betrieb.

> Cookie-Pfad und die Wurzelroute brauchen einen Pfad, der mit `/` beginnt; dafür gibt es `DASHBOARD_HOME` (`/dashboard` bzw. `/`). Der Server läuft mit `ignoreTrailingSlash`, ein Link auf `<base>/` trifft also dieselbe Route.

### Auf dem VPS

`dashboard.nexus-emb.de` gehört auf den Fastify-Port (`SERVER_PORT`, Standard `3000`), `nexus-emb.de` auf den gebauten Stand der Webseite. Der Proxy leitet **unverändert** weiter — kein Pfad-Rewrite, kein abgeschnittenes Präfix:

```
dashboard.nexus-emb.de/*  →  http://127.0.0.1:3000/*
```

Dieselbe Subdomain trägt auch `/images/*` (Galerie-Bilder für Discord) und `/dcapi/*` (die Plugin-API) — es ist derselbe Server, nur andere Pfade, siehe [Server.md](Server.md).

---

## Discord Developer Portal

Alles auf <https://discord.com/developers/applications> → deine Application.

### 1. OAuth2 → Redirects

Trag **jede** Adresse einzeln ein, unter der das Dashboard erreichbar ist. Discord vergleicht Zeichen für Zeichen, ein fehlender Slash oder `http` statt `https` reicht für ein `invalid_request`.

```
http://localhost:3000/dashboard/callback
https://dashboard.nexus-emb.de/callback
```

Die zweite Zeile trägt **kein** `/dashboard`: im Betrieb liegt das Dashboard an der Wurzel seiner eigenen Subdomain. Dasselbe gilt für den Epic-Redirect (`.../link/epic/callback`, siehe [Environment.md](Environment.md)).

> Im `--dev` Modus baut der Bot die Redirect-URI aus `http://localhost:<SERVER_PORT>`, sonst aus `SERVER_PUBLIC_URL`. **Ruf das Dashboard lokal über `localhost` auf, nicht über `127.0.0.1`** — für Discord sind das zwei verschiedene Redirects.

Welche URI der Bot gerade benutzt, sagt er dir selbst:

```bash
npm run check:dashboard
```

### 2. OAuth2 → Client Secret

`Reset Secret` klicken, den Wert kopieren und in die `.env` legen:

```bash
CLIENT_SECRET="..."       # Produktiv-Application
DEV_CLIENT_SECRET="..."   # Dev-Application, falls es eine zweite gibt
```

Das Secret gehört nicht ins Git — die `.env` steht in der `.gitignore`. Fehlt es, startet der Bot normal — nur `/dashboard` antwortet mit `503` und sagt, was fehlt.

### 3. Einen OAuth2-Link musst du nirgends hinterlegen

Den Login-Link baut der Bot bei jedem Aufruf selbst, samt frischem `state`. Der URL-Generator im Portal wird dafür nicht gebraucht. Zur Kontrolle sieht er so aus:

```
https://discord.com/oauth2/authorize
  ?client_id=<CLIENT_ID>
  &redirect_uri=<SERVER_PUBLIC_URL>/callback
  &response_type=code
  &scope=identify%20guilds%20guilds.members.read
  &state=<einmaliger Wert>
```

Nötige Scopes — sie stehen als `OAUTH_SCOPES` in `src/constants/Dashboard.ts`:

| Scope | Wofür |
|---|---|
| `identify` | Name, `@`-Name und Avatar in der Kopfzeile |
| `guilds` | Die Serverliste samt Rechten und Mitgliederzahl |
| `guilds.members.read` | Auf der Detailseite: Beitrittsdatum, Nickname und Rollenzahl des Angemeldeten auf genau diesem Server. **Plural** — `guilds.member.read` weist Discord mit `Invalid scope` ab, obwohl der Endpunkt darunter `/member` heißt |
| `email` | Die Adresse im Konto-Bereich der Einstellungen |

Jeder Scope kostet eine Zeile mehr im Zustimmungsdialog — wer `guilds.members.read` nicht braucht, streicht ihn aus `OAUTH_SCOPES` und die Detailseite lässt den Block einfach weg. Dasselbe gilt für `email`: ohne den Scope bleibt die Zeile in den Einstellungen leer, sonst ändert sich nichts.

> **`email` kam später dazu.** Sitzungen, die davor ausgestellt wurden, tragen weder die Adresse noch den `@`-Namen. Sie bleiben gültig — das Dashboard schreibt dort „Nach dem nächsten Anmelden sichtbar“, statt den Nutzer auszusperren. `IDashboardSession.handle` und `.email` sind genau deshalb optional.

### 4. Einladelink für den Bot

Den baut der Bot ebenfalls selbst — die Karten im Dashboard hängen `guild_id` an, damit Discord direkt den richtigen Server vorschlägt:

```
https://discord.com/oauth2/authorize
  ?client_id=<CLIENT_ID>
  &permissions=117760
  &scope=bot%20applications.commands
```

`117760` sind View Channel, Send Messages, Embed Links, Attach Files und Read Message History — genau das, was der Bot heute benutzt. Die Zahl steht als `INVITE_PERMISSIONS` in `src/constants/Dashboard.ts`. Wer sie ändert, muss den Bot auf bestehenden Servern neu autorisieren.

### 5. Bot → Privileged Intents

`Message Content Intent` bleibt an (der Galerie-Upload braucht es).

`Guild Voice States` fordert der Bot seit der Server-Übersicht mit an. Es ist **nicht** privilegiert und braucht keinen Schalter im Portal — damit zählt er die Zeit im Sprachkanal, siehe [Activity.md](Activity.md).

**`Server Members Intent`** ist neu und **optional**. Nur damit kennt der Bot die Mitgliederliste eines Servers — und nur dann kann das Dashboard auf den Karten Menschen und Bots getrennt ausweisen („8 Mitglieder" + „3"). Ohne das Intent steht dort wie bisher die Gesamtzahl inklusive Bots.

Es sind **zwei** Schalter, und die Reihenfolge zählt:

```bash
# 1. Developer Portal → Bot → Privileged Gateway Intents → Server Members Intent → an
# 2. .env:
GUILD_MEMBER_INTENT="true"
```

> **Erst das Portal, dann die `.env`.** Fordert der Bot ein Intent an, das im Portal aus ist, weist Discord den Login komplett ab — der Bot startet dann gar nicht mehr. Deshalb steht der Schalter standardmäßig auf `false`.

Der Bot holt die Listen einmal beim Start (`Ready` → `DashboardService.Warm()`) und hält sie danach über die Gateway-Ereignisse selbst aktuell. Kommt später ein Server dazu, zieht der nächste Aufbau der Serverliste ihn nach. Gezählt wird nur, wenn die Liste **vollständig** ist (`members.cache.size >= memberCount`) — eine halb gefüllte Liste ergäbe eine zu kleine Zahl, die trotzdem echt aussähe.

---

## Einrichtung in drei Schritten

```bash
# 1. Secret aus dem Developer Portal in die .env
#    CLIENT_SECRET="..." / DEV_CLIENT_SECRET="..."

# 2. Frontend bauen (erzeugt public/assets/app.js und assets/chunks/)
npm run build:dashboard

# 3. Bot starten und http://localhost:3000/dashboard aufrufen
npm run dev
```

`npm run dev` und `npm run build` bauen das Frontend automatisch mit. Wer nur am Frontend arbeitet, lässt nebenher `npm run dev:dashboard` laufen — das beobachtet `src/dashboard/client` und baut bei jeder Änderung neu.

**Gebaut wird mit esbuild** (`src/scripts/BuildDashboard.ts`), vorher prüft `tsc` die Typen. Heraus kommt ein kleiner Einstieg `assets/app.js` und je Seite ein eigenes Stück unter `assets/chunks/` (Prüfsumme im Namen), verkleinert. `app.ts` lädt nur den Code der geöffneten Seite, die Serverseite ihre Bereiche (Tickets, Live Tickets, Galerie, Transcripts) erst, wenn man sie öffnet — samt ihrer Abfragen.

**Ausgeliefert** wird gepackt (Brotli, sonst gzip) und mit ETag: gleicher Stand, `304` ohne Inhalt. Stücke mit Prüfsumme, Schriften und Adressen mit `?v=<Prüfsumme>` darf der Browser ein Jahr behalten — die HTML-Seiten hängen `?v=` selbst an `app.js` und `style.css` (`utils/dashboard.ts`). JSON-Antworten der API packt ein `onSend`-Hook in `Server.ts`. `npm run measure:dashboard` misst einen Aufruf der Doku-Seite, frisch und mit Cache:

| | Anfragen | übertragen |
|---|---|---|
| vorher, erster Aufruf | 49 | 2.045 KB |
| vorher, zweiter Aufruf | 48 | 626 KB |
| jetzt, erster Aufruf | 29 (obere Grenze: alle Stücke, alle Schriften) | 211 KB |
| jetzt, zweiter Aufruf | 1 (nur die Seite) | 7 KB |

---

## Die Routen

| Route | Antwort |
|---|---|
| `GET <base>/` | Die Serverauswahl. Ohne Sitzung `302` auf `<base>/login` |
| `GET <base>/login` | `302` zu Discord, setzt das `state`-Cookie. `?return=<base>/...` merkt sich den Rückweg |
| `GET <base>/callback` | Tauscht den Code gegen einen Token, legt die Sitzung an, `302` zurück. `403` samt Anleitung, wenn am Discord-Konto Zwei-Faktor fehlt |
| `GET <base>/logout` | Verwirft Sitzung und Cookie, `302` auf den Login |
| `GET <base>/api/me` | JSON: Nutzer, Serverliste, Einladelink. Ohne Sitzung `401` |
| `GET <base>/guild/:id/:section?` | Serverseite: Übersicht, Module und die Module selbst |
| `GET <base>/g/:id` | Der alte Weg dorthin — leitet auf `/guild/:id/uebersicht` |
| `GET <base>/api/guild/:id` | JSON: Serverzahlen aus dem Bot-Cache, die eigenen Mitgliedsdaten und die eingeschalteten Module |
| `POST <base>/api/guild/:id/modules` | Schaltet ein Modul an oder aus. Nur wer den Server verwalten darf, nur JSON |
| `GET <base>/api/guild/:id/activity` | JSON: Aktivität für die Übersicht — Stunden, Kanäle, Mitglieder, Ränge. `503` ohne Datenbank, siehe [Activity.md](Activity.md) |
| `GET,POST <base>/api/guild/:id/moderators` | Die Moderatoren des Servers lesen, speichern, Mitglieder suchen. Nur wer den Server verwalten darf, POST nur JSON |
| `GET,POST <base>/api/guild/:id/moderation` | Fälle, Aktionen, Notizen, Einstellungen der Moderation — siehe [Moderation.md](Moderation.md#dashboard) |
| `GET,POST <base>/api/guild/:id/moderation/evidence/…` | Beweisbilder hochladen (roh als `image/*`) und ausliefern |
| `GET,POST <base>/api/guild/:id/streams/:platform` | Twitch- und YouTube-Notifier: Streamer, Nachrichten, Live-Rolle — siehe [Notifiers.md](Notifiers.md#dashboard) |
| `GET,POST <base>/api/guild/:id/polls` | Umfragen anlegen, beenden, löschen und ihre Stimmen — siehe [Polls.md](Polls.md#dashboard) |
| `GET,POST <base>/api/guild/:id/giveaways` | Giveaways anlegen, auslosen, neu auslosen, abbrechen — siehe [Giveaways.md](Giveaways.md#dashboard) |
| `GET <base>/admins` | Admin-Dashboard. Ohne Sitzung `302` auf den Login |
| `GET <base>/api/admin` | JSON: Kennzahlen und vergebene Gruppen. Nur Staff, sonst `403` |
| `POST <base>/api/admin/group` | Vergibt oder entzieht eine Gruppe. Nur Staff, nur JSON |
| `GET <base>/user/:userId/tracking` | Rang-Übersicht eines Spielers |
| `GET <base>/:userId/tracking` | Alter Pfad, `301` auf `<base>/user/:userId/tracking` |
| `GET <base>/user/:userId/settings` | Einstellungen: Profil, Design, Töne, Verknüpfungen. Fremde IDs `302` auf die eigene |
| `GET <base>/api/tracking/:userId` | JSON: verknüpftes Konto, Ränge, Karriere-Werte und Ingame-Club. Fremde nur für Staff |
| `GET <base>/link/epic` | Weiterleitung zur Epic-Anmeldung |
| `GET <base>/link/epic/callback` | Rücksprung von Epic, verknüpft das Konto |
| `GET <base>/api/accounts` | JSON: das verknüpfte Epic-Konto samt Sperrfrist |
| `POST <base>/api/account/epic` | Prüft den Epic-Namen und verknüpft ihn |
| `GET,POST <base>/api/notifications` | Postfach lesen, als gelesen markieren, leeren |
| `GET <base>/privacy` | Datenschutzerklärung. Ohne Anmeldung lesbar |
| `GET <base>/docu` | Dokumentation: Ränge, WTSI, Gruppen, Verknüpfung, Design, Sicherheit. Ohne Anmeldung lesbar |
| `GET <base>/wtsi` | Alter Pfad, `301` auf `<base>/docu#wtsi` |
| `GET <base>/assets/*` | CSS, JavaScript **und Bilder** |

Alles Öffentliche liegt unter **einem** Ordner: `public/assets`. Stylesheets und Skripte stehen dort neben `assets/images` — Logos, Rang-Abzeichen, Plattform- und Statistik-Symbole. Eine eigene Bild-Route gibt es nicht mehr: sie hieß `/dashboard/images/*` und wäre im Betrieb, ohne Präfix, mit der Galerie-Route `/images/*` zusammengestoßen (siehe [Server.md](Server.md)). Bilder bekommen dabei einen Tag Cache; Stile und Skripte siehe oben.

Das **RL Nexus N-Logo** ist Markenzeichen in der Kopfzeile und Favicon aller Seiten — als `rl-nexus-n-96.png` (Kopf- und Fußzeile) und `rl-nexus-n-48.png` (Favicon); das Original mit 1,4 MB stand vorher auf jeder Seite. Die Statistik-Symbole sind schwarze PNGs. Das Stylesheet färbt sie über `mask-image` ein, jedes in der Farbe, die es auch auf der Rang-Karte trägt.

Alle laufen mit `prefixed: false` (also ohne `/dcapi`) und `requiresAuth: false` — das Dashboard authentifiziert per Cookie, nicht per Bearer-Token. Die bestehende Plugin-API bleibt davon unberührt.

---

## Wer was sieht

Anmelden darf sich **jeder** Discord-Account. Was danach in der Liste steht, hängt an den Rechten:

| Fall | In der Liste | Bearbeiten |
|---|---|---|
| Owner des Servers | ja | ja |
| `MANAGE_GUILD` oder `ADMINISTRATOR` | ja | ja |
| Moderator (Moderatoren-Liste des Servers, selbst oder per Rolle, oder eine Support-Rolle der Tickets) | ja, Marke „Moderator“, eigener Abschnitt und Filter „Moderation“ | nein — nur **Live Tickets**, **Transcriptions** und, von der Moderatoren-Liste, die **Moderation**; siehe [Tickets.md](Tickets.md#moderatoren) und [Moderation.md](Moderation.md) |
| Weder noch | nein | — |
| Gruppe `administrator` oder `developer` | zusätzlich **jeder** Server, auf dem der Bot ist | nur mit eigenem Recht auf dem Server |

Die Serverliste holt der Bot je Sitzung höchstens einmal gleichzeitig: Eine Seite fragt mehrere Routen auf einmal ab, und alle warten auf denselben Abruf. Antwortet Discord trotzdem mit 429, wartet er die genannte Zeit (bis 5 Sekunden) und fragt einmal nach (`DashboardService.Guilds()` / `Fetch()`).

Moderatoren kommen nicht aus Discords Serverliste, sondern vom Bot: er schaut, ob das Mitglied als Moderator eingetragen ist, eine Moderatoren-Rolle oder eine Support-Rolle (allgemein oder eines Themas) trägt. Nur auf Servern mit eingeschaltetem Ticket- oder Moderations-Modul, und nur für Server, die sonst nicht in der Liste stünden. Die Moderation (`canModerate`) gibt es nur über die Moderatoren-Liste, nicht über eine Support-Rolle. Die Übersicht mit Aktivität bleibt für sie zu.

Karten ohne Bearbeitungsrecht tragen die Marke „Nur Ansicht“, die Detailseite blendet dort einen Hinweis ein. Wer Seiten-Admins auch dort schreiben lassen will, setzt in `DashboardService.Guilds()` beim Staff-Zweig `canManage` auf `true` — eine Zeile.

Server, die nur über die eigene Gruppe sichtbar sind, tragen die violette Marke **„Staff-Zugriff“** und einen Satz auf der Karte, warum sie da stehen. Dazu gibt es den Filter **Fremde Server** — der steht für Administrator und Developer **immer** in der Leiste, auch bei null Treffern, sonst wäre nicht zu sehen, dass es die Ansicht gibt. Gibt es solche Server wirklich, erscheint zusätzlich ein Hinweis über der Liste.

Zeigt eine Ansicht beides, wird das Raster in zwei Abschnitte geteilt: **Deine Server** zuerst (samt der Kachel zum Einladen), darunter **Fremde Server**. Stehen nur eigene oder nur fremde in der Liste, entfallen die Überschriften.

### Gruppen

Eine Gruppe ist eine reine **Anzeige** — sie vergibt keine Rechte auf einem Discord-Server. Nur die ersten beiden schalten überhaupt etwas frei: sie sehen jeden Server, auf dem der Bot sitzt (`DashboardService.IsStaff()`).

| Gruppe | Woher | Sieht fremde Server |
|---|---|---|
| Administrator | Tabelle `dashboard_groups` | ja |
| Developer | `DEV_USER_IDs` in der `.env` | ja |
| Partner | Tabelle `dashboard_groups` | nein |
| Premium | Tabelle `dashboard_groups` | nein |
| Guardian | — (wer keine andere Gruppe hat, aber auf mindestens einem Server Moderator ist) | nein |
| Testphase | — (wer nirgends steht) | nein |

**Guardian** wird nicht gespeichert: `DashboardService.Payload()` macht aus „Testphase" Guardian, sobald ein Server mit der Rolle „Moderator" in der Liste steht. Grünes Schild, dieselbe Marke wie überall.

**Vergeben wird das unter [`/dashboard/admins`](#admin-dashboard), nicht in einer Datei.** Ein Nutzer hat höchstens einen Eintrag in der Tabelle; steht er zusätzlich in `DEV_USER_IDs`, gewinnt Administrator, sonst Developer.

`DEV_USER_IDs` bleibt als einzige Liste in der `.env`. Das ist Absicht: sie schaltet die Entwickler-Befehle frei **und** ist der Einstieg ins Admin-Dashboard. Käme auch sie aus der Datenbank, könnte sich nach einem frischen Aufsetzen niemand die erste Berechtigung geben.

Ohne Datenbank bleibt nur Developer übrig, alle anderen landen in der Testphase — das Dashboard funktioniert weiter, es kann nur niemand etwas vergeben.

Eine Gruppe dazu heißt: einen Eintrag in `DASHBOARD_GROUPS` (`IDashboardUser.ts`), einen Wert im ENUM der Migration, einen in `STORED_GROUPS` (`models/DashboardGroups.ts`) und einen in `GROUPS` im Frontend (Name, Symbol, Farbe). `npm run check:db` prüft die Rangfolge, `npm run check:dashboard` das Verhalten ohne Datenbank.

### Admin-Dashboard

`/dashboard/admins` steht **Administratoren und Developern** offen. Wer sich anmeldet, kommt auf die Seite; was darauf steht, holt sie über `/dashboard/api/admin`, und das prüft die Gruppe serverseitig — ein Direktaufruf ohne Berechtigung bekommt `403` und die Seite sagt es.

Darauf zu sehen:

- **Kennzahlen** — Server mit RL Nexus, Zustand der Datenbank, Cache-Trefferquote, Laufzeit, und wenn die Datenbank steht: Teams, Partien, verknüpfte Konten, eingerichtete Server
- **Gruppen vergeben** — Discord-ID, Gruppe und eine optionale Notiz. Developer steht nicht zur Wahl
- **Vergebene Gruppen** — wer welche Gruppe hat, von wem und seit wann, mit Knopf zum Entziehen

Zwei Sperren, die absichtlich drin sind: die **eigene** Gruppe lässt sich hier nicht ändern (sonst sperrt man sich selbst aus), und **Developer** lässt sich weder vergeben noch entziehen (die Liste lebt in der `.env`).

**CSRF:** `POST /dashboard/api/admin/group` nimmt ausschließlich `application/json` an. Ein Formular auf einer fremden Seite kann diesen Inhaltstyp nicht ohne Preflight schicken, und das Sitzungscookie ist `SameSite=Lax` — es käme bei einem fremden POST ohnehin nicht mit.

---

## Sicherheit

**Zwei-Faktor ist Pflicht.** `Exchange()` liest `mfa_enabled` aus `/users/@me` (kommt mit dem Scope `identify` mit) und wirft `MfaRequired`, wenn dort nicht exakt `true` steht. Der Callback fängt das ab und liefert `mfa.html` mit `403` — eine Anleitung, keine Fehlermeldung.

Geprüft wird auf `=== true`: ein fehlendes Feld gilt als *nicht bestätigt*, nicht als *wird schon passen*. Bei einer Regel, die Zugang gewährt, ist die vorsichtige Auslegung die richtige.

Das Ergebnis steht als `mfa: true` in der Sitzung, und `Session()` verlangt es. Zwei Folgen, beide beabsichtigt:

* **Cookies von vor der Regel gelten nicht mehr.** Sonst liefe die Pflicht sieben Tage lang an allen vorbei, die gerade angemeldet sind. Kostet einmal ein neues Anmelden.
* **Es ist eine Momentaufnahme.** Wer den Schutz nach dem Anmelden abschaltet, kommt bis zum Ablauf des Cookies weiter herein. Laufend zu prüfen hieße, bei *jedem* Seitenaufruf `/users/@me` abzurufen — das ist der Genauigkeit nicht wert.

`npm run check:dashboard` stellt Discord dafür nach und prüft alle vier Fälle: mit, ohne, ohne Feld und mit einem `"true"` als Text.

**Sitzungen** stecken vollständig im Cookie, verschlüsselt mit AES-256-GCM (`src/utils/seal.ts`). Der Schlüssel wird aus `SERVER_JWT_SECRET` abgeleitet. Es gibt **keinen Sitzungsspeicher im Prozess** — deshalb übersteht ein Login jeden Neustart des Bots, auch das ständige Neuladen durch `tsx watch` im Entwicklungsmodus.

GCM verschlüsselt und signiert zugleich: ein verändertes Byte lässt die Entschlüsselung scheitern, eine getrennte Signaturprüfung braucht es nicht. Der Discord-Token liegt damit nie im Klartext beim Browser, und `Session()` prüft nach dem Entschlüsseln zusätzlich die Form — ein Cookie aus einer älteren Version fällt so sauber durch.

Was dieser Tausch kostet: **eine Sitzung lässt sich nicht serverseitig zurückziehen.** Bis das Cookie abläuft (7 Tage, gekoppelt an die Laufzeit des Discord-Tokens), bleibt sie gültig. Wer einzelne Sitzungen sofort beenden können muss, braucht doch eine Sperrliste — oder ein neues `SERVER_JWT_SECRET`, das alle auf einmal ungültig macht.

`DashboardService.Destroy()` räumt deshalb nur noch die Caches. Beendet wird eine Sitzung, indem die Route das Cookie löscht.

**Cookies** sind `HttpOnly`, `SameSite=Lax` und auf `Path=/dashboard` begrenzt. `Secure` setzt der Bot automatisch, sobald die Redirect-URI auf `https` steht. `Lax` statt `Strict` ist Absicht — bei `Strict` käme das Cookie beim Rücksprung von Discord nicht mit und der Login liefe endlos im Kreis.

**CSRF beim Login:** `/dashboard/login` legt einen Zufallswert gleichzeitig ins Cookie und in den `state`-Parameter. Der Callback vergleicht beide mit `timingSafeEqual`; passt etwas nicht, gibt es `400` statt einer Sitzung.

**Offene Redirects:** `?return=` akzeptiert nur Pfade, die mit `/dashboard` beginnen und weder mit `//` anfangen noch einen Backslash enthalten. Alles andere landet auf `/dashboard`.

**Pfadschutz:** `/dashboard/assets/*` löst ausschließlich unter `public/assets` auf und liefert nur bekannte Dateitypen aus — dieselbe Absicherung wie bei der Galerie. Die HTML-Seiten liegen eine Ebene darüber und werden nur namentlich ausgeliefert.

**Servernamen** landen im Frontend ausnahmslos über `textContent` und `<template>`-Klone im Dokument. Es wird nirgends HTML zusammengesetzt, ein Servername mit `<script>` darin bleibt sichtbarer Text.

**Discord-Rate-Limit:** `/users/@me/guilds` wird pro Sitzung 60 Sekunden zwischengespeichert, die Route selbst ist zusätzlich auf 60 Anfragen pro Minute gedeckelt.

---

## Was das Frontend anzeigt

Die Serverauswahl lebt von einem einzigen `GET /dashboard/api/me`. **Nichts davon ist erfunden** — jedes Feld hat eine Quelle:

| Feld | Quelle |
|---|---|
| Name, Icon, Rolle | Discord OAuth (`/users/@me/guilds`) |
| Mitgliederzahl | Der Bot selbst, wo er auf dem Server ist — sonst `approximate_member_count` |
| Bots und echte Mitglieder | Die Mitgliederliste des Bots, **nur mit `GUILD_MEMBER_INTENT`**. Ohne das Intent bleibt `bots` auf `null` und die Karte zeigt allein die Gesamtzahl |
| Erstelldatum | Aus der Guild-Snowflake gerechnet, kostet keinen API-Aufruf |
| Wappenfarben | Hash der Guild-ID — gleiche ID, immer gleiche Farbe, nichts gespeichert |
| Rolle (Owner/Admin/Staff-Zugriff) | Die `permissions`-Bits aus derselben Antwort |
| Gruppe des Angemeldeten | Tabelle `dashboard_groups`, plus `DEV_USER_IDs` aus der `.env` |
| Aktive Teams | `teams` in der Datenbank, aktive Teams des Servers (in der Kurzinfo) |
| Aktive Module | `guild_settings.modules` in der Datenbank — auf der Karte als Symbole, feste Module zählen mit |
| Seit wann RL Nexus dabei ist | `joinedTimestamp` aus dem Bot-Cache (`joined`), in der Statuszeile der Karte |

**Die Karte** zeigt oben Name und Rolle, darunter den Status („RL Nexus läuft hier seit März 2026“), zwei Zahlen — Mitglieder und Bots, gleich breite Ziffern — und die aktiven Module als Symbole (höchstens sechs, der Rest als „+n“; der Name steht im Tooltip und für Vorleser). **Die Kurzinfo** (der kleine Knopf neben „Dashboard öffnen“) ist ein Popover an der Karte (`layout/GuildInfo.ts`): alle Zahlen, Server erstellt, dabei seit, Teams, die Module mit Namen, was man dort darf, und Direktlinks — für Moderatoren zu Live Tickets und Transcriptions. Ohne Bot zählt sie auf, was RL Nexus mitbringt. Escape, Klick daneben oder ein zweiter Klick auf den Knopf schließen sie; der Fokus geht zurück an den Knopf.

Die Liste ist in bis zu drei Abschnitte geteilt: **Deine Server** (Owner, Admin), **Als Moderator**, **Fremde Server** (Staff) — Überschriften nur, wenn mehr als einer davon in der Ansicht steht.

### Kopfzeile, Einstellungen, Postfach

In der Kopfzeile steht nur noch der Nutzer. Ein Klick darauf öffnet das Menü mit **RL Tracker**, **Benachrichtigungen**, **Einstellungen** und **Abmelden**. Administratoren und Developer sehen darüber zusätzlich **Administration** — den Weg zu `/dashboard/admins`. Der Eintrag erscheint nur für sie; die Route prüft die Gruppe serverseitig noch einmal.

Die Einstellungen sind eine eigene Seite mit vier Reitern — **Profil**, **Design**, **Töne & Oberfläche**, **Verknüpfungen**. Was dort eingestellt wird, gilt **pro Browser**; der Bot erfährt davon nichts. Alles zusammen steckt unter einem einzigen `localStorage`-Schlüssel `rlnexus.prefs`:

| Einstellung | Wirkung |
|---|---|
| Oberflächentöne | Schaltet die synthetisierten Klänge an und aus |
| Lautstärke | Faktor auf die Lautstärke jedes Tons, `0` schaltet sie ganz ab |
| Bewegung reduzieren | Setzt `body.no-motion` — dieselbe Wirkung wie `prefers-reduced-motion` |
| Hinweise einblenden | Blendet die Toasts aus. Die Meldung landet trotzdem im Postfach |


Unter **Konten verknüpfen** steht der angemeldete Discord-Account als „Verbunden“, darunter Epic Games, Steam, Xbox, PlayStation und Nintendo Switch mit der Marke **„Geplant“** — ohne Funktion, es gibt dafür noch keine Gegenstelle im Bot. Wer eine anschließt, ersetzt die Marke durch einen Knopf.

Der Block **Konto** zeigt, was Discord über den Angemeldeten liefert: Anzeigename, `@`-Name, E-Mail, Discord-ID (mit Knopf zum Kopieren; ohne Zwischenablage wird die ID markiert) und die Gruppe als farbige Marke.

Darunter steht unter **Gruppen** die vollständige Übersicht: alle sechs in ihrer Rangfolge, je mit Symbol, Farbe und einem Satz dazu, was sie bedeuten. Die eigene ist hervorgehoben und mit „Deine Gruppe“ markiert. Die Liste baut das Frontend aus derselben `GROUPS`-Tabelle, aus der auch die Marke in der Kopfzeile kommt — eine neue Gruppe taucht dort also von allein auf.

### Konten verknüpfen

Verknüpft wird in den **Einstellungen**, nicht im RL Tracker — und über eine
echte Anmeldung, nicht über einen eingetippten Namen.

Es gibt genau **einen** Login: Epic. Der Grund ist keine Bequemlichkeit, sondern
die Lage draußen:

| Plattform | Öffentlicher Login? | Wie sie hereinkommt |
|---|---|---|
| **Epic Games** | ja — Epic Account Services | Echte Anmeldung, Grundlage für alles Weitere |
| **Steam** | ja (OpenID) | Über Epic — ein eigener Login brächte nichts Neues |
| **Xbox** | ja (Entra + XSTS) | Über Epic — dito, kostet aber eine eigene Registrierung |
| **PlayStation** | **nein** | Nur über Epic |
| **Nintendo** | **nein** | Nur über Epic |

Sony und Nintendo bieten Dritten schlicht keine Anmeldung an. Alles, was im Netz
dazu kursiert, sind nachgebaute Token-Wege, die bei jeder Änderung brechen — die
wären hier ein Wartungsversprechen, das niemand halten kann.

Das ist auch gar nicht nötig, und zwar aus einem stärkeren Grund als
Bequemlichkeit: **die Ränge sind auf allen Plattformen dieselben.** Nachgemessen
über `GetFullProfile` für Epic und Steam desselben Spielers, identische Werte.
Ein Steam-Login würde also nichts liefern, was der Epic-Login nicht schon hat.

Eine frühere Fassung führte die Plattformen aus `LinkedAccounts` als eigene
Zeilen und ließ eine davon zur "Hauptplattform" wählen. Das ist wieder
entfernt (Migration 007): eine Auswahl, die an der Anzeige nichts ändert, ist
keine Auswahl, sondern eine Behauptung.

#### Der Ablauf

```
Einstellungen → "anmelden"
  → GET  /dashboard/link/epic            Nonce ins Cookie, weiter zu Epic
  → Epic: Anmeldung und Zustimmung
  → GET  /dashboard/link/epic/callback   Nonce prüfen, Code gegen Konto-ID tauschen
  → Prime: Konto-ID auflösen             Name, Ränge, Karriere-Werte, Club in einem Zug
  → player_accounts schreiben            genau eine Zeile: Epic
  → zurück mit ?epic=ok                  Das Dashboard macht daraus einen Hinweis
```

Der Rücksprung trägt das Ergebnis in der Adresszeile, nicht als JSON: Epic
schickt eine ganze Seitennavigation zurück, kein `fetch`. Der Parameter wird
nach dem Anzeigen wieder entfernt, damit ein F5 den Hinweis nicht wiederholt.

Von Epic wird nur die **Konto-ID** geholt (`scope=basic_profile`). Den Namen löst
Prime damit selbst auf — ein zweiter Weg zu Epic wäre nur eine weitere Stelle,
die kaputtgehen kann.

Die **Sperrfrist** von 3 Tagen gilt weiterhin, aber nur dem *Wechsel*: wer sich
mit demselben Konto erneut anmeldet, frischt bloß die Plattformliste auf.

Ohne `EPIC_CLIENT_ID` bleibt der Knopf aus und es erscheint das alte Namensfeld
als Notweg — mit dem Hinweis, dass es keinen Eigentumsnachweis liefert. Zum
Einrichten siehe [Environment.md](Environment.md).

### RL Tracker

Der Eintrag **RL Tracker** im Nutzermenü fragt **nicht mehr** nach dem Epic-Konto — das hängt an der Anmeldung in den Einstellungen. Ist dort nichts verknüpft, steht hier nur der Weg dorthin.

Er hat auch keinen eigenen Dialog mehr. Nachdem die Frage nach dem Epic-Konto in die Einstellungen gewandert war, blieb nichts zu fragen übrig — also führt der Eintrag jetzt direkt auf die Tracking-Seite, wo die Ränge ohnehin besser stehen.

Darunter stehen die **Ränge für 1v1, 2v2 und 3v3** — MMR, Rang, Division, Spiele und Serie, geholt über `/dashboard/api/tracking/:userId` aus der Prime-API. Wie die MMR entsteht und was der Weg dorthin kostet, steht in [Prime.md](Prime.md). Ohne `PRIME_API_TOKEN` bleibt der Block leer und sagt das auch.

Das **Postfach** liegt beim Bot, nicht im Browser: dadurch sieht man dieselben Meldungen auf jedem Gerät, und der Bot kann selbst welche dazulegen. Die Seite holt sie beim Laden und danach jede Minute nach — der Zähler am Menü und der Punkt am Avatar zeigen Ungelesenes an. Ein Klick auf eine Meldung mit Ziel führt dorthin.

Was heute Meldungen erzeugt: eine **geänderte Gruppe** (aus dem Admin-Dashboard) und ein **verknüpftes oder gewechseltes Epic-Konto**. Weitere sind ein Einzeiler — `client.notifications.Push(userId, kind, titel, text, ziel)`, siehe [Database.md](Database.md).

Die kurzen Einblendungen unten rechts (Toasts) sind davon getrennt: sie sind reine Rückmeldung auf einen Klick und verschwinden wieder.

Teams und Module kommen aus der Datenbank — zwei Abfragen für die ganze Liste, nicht eine je Karte (`Team.CountsOf()` und `GuildSettings.ModulesOf()`). **Ohne Datenbank** stehen dort `0` und `—`, und die Seite bleibt heil: `DashboardService.Facts()` fängt das ab. Siehe [Database.md](Database.md).

### Tracking-Seite `/dashboard/user/<userId>/tracking`

Drei Spalten nebeneinander: **Karriere links, die Ränge in der Mitte, Club rechts.**
Über den Rängen der Season-Reward, der für die ganze Saison gilt.

Die Spalten enden auf derselben Höhe, ihr Inhalt wird aber **nicht** gestreckt —
früher wuchsen Kacheln und Rang-Karten mit und standen hoch und leer da:

| Bereich | Aufbau |
|---|---|
| Karriere | eine Liste: Symbol, Name, Zahl rechtsbündig, farbiger Strich links. Darunter zwei Quoten aus denselben Zahlen: **Trefferquote** (Tore pro Schuss) und **MVP-Quote** (MVP pro Sieg) — nur, wenn der Nenner da ist |
| Season-Reward | zehn Segmente, ein Sieg je Segment |
| Rang-Karte | oben die Playlist, in der Mitte Abzeichen, Rang, Division (in der Platzierung zehn Punkte), MMR und Spiele, unten „Serie“ — die Mitte steht zwischen Kopf und Serie zentriert, drei Karten enden auf einer Linie |
| Club | Tag, Name, Mitgliederzahl; Ø Club-MMR (WTSI) und der eigene WTSI als flache Zeilen; Owner und Gründung; die Mitglieder **nach MMR sortiert**, mit Platz, Balken zum Besten und der Marke „Du“ |

Alle Beschriftungen haben mindestens 11,5 px, Zahlen gleich breite Ziffern. Der
Zähler oben rechts trägt einen dünnen Strich, der bis zur nächsten Aktualisierung
schrumpft.

Umgesetzt als Flex-Zeile (`.trackmain`), nicht als Raster mit festen Spalten: ein
ausgeblendeter Block ist kein Flex-Element mehr und hinterlässt keine leere
Spalte. Wer in keinem Club ist, sieht die Ränge also nicht schief in der Zeile
stehen — sie rücken auf.

Die beiden Seitenspalten richten sich per **Container-Query** nach ihrer eigenen
Breite, nicht nach der des Fensters. Bricht die Zeile um, steht der Club
plötzlich voll breit da und wird von selbst wieder mehrspaltig; eine
Media-Query wüsste davon nichts.

Die **Club-Karte** zeigt den Club aus dem Spiel — nicht
zu verwechseln mit der Tabelle `clubs`, die der Bot für eigene Zwecke führt und
die im Dashboard nirgends auftaucht. Wer in keinem Ingame-Club ist, sieht die
Karte gar nicht.

Die Seite **lädt von selbst nach**: Läuft der Zähler oben rechts ab, holt sie den
neuen Stand, ohne dass jemand neu lädt. Der Termin folgt dem Zehn-Minuten-Takt des
Bots ([Prime.md](Prime.md)) und wird über den `Date`-Kopf der Antwort auf die Uhr
des Browsers umgerechnet, falls die anders geht. Ein verdeckter Tab wartet, bis
wieder jemand hinsieht. Ein Aussetzer beim Nachladen lässt den gezeigten Stand
stehen, der nächste Versuch kommt nach einer Minute.

### Serverseite `/dashboard/guild/:id`

Oben steht der Serverkopf — Wappen, Name, Marken —, darunter zwei Spalten: links die **Seitenleiste**, rechts genau ein Eintrag daraus. Welcher Eintrag offen ist, steht im Pfad: `/guild/<id>/tickets` ist eine eigene Adresse, die sich teilen lässt und im Verlauf zurückgeht. Ein Klick tauscht nur die Karte und hängt einen Eintrag in den Verlauf — geladen wird dabei nichts neu. Was kein Abschnitt ist oder ausgeschaltet, landet auf der Übersicht, und die Adresse sagt das danach auch.

**Übersicht** ist der erste Eintrag und zeigt, was auf dem Server los ist: Kennzahlen (Mitglieder, Beitritte, Nachrichten und Voice je sieben Tage mit Vergleich zur Vorwoche, Teams, eingeschaltete Module), den Verlauf der letzten 30 Tage — umschaltbar zwischen Chat, Voice und Beitritten —, eine Heatmap nach Wochentag und Uhrzeit, die aktivsten Kanäle und Mitglieder und die Rang-Verteilung der verknüpften Spieler. Gezählt wird im Bot, siehe [Activity.md](Activity.md); dort steht auch, was gespeichert wird und was nicht.

Auch hier steht nichts Erfundenes. Zwei Blöcke kommen ohne Zählerei aus:

| Block | Quelle | Kosten |
|---|---|---|
| **Server** — Kanäle, Rollen, Boosts, Boost-Stufe | Der Bot-Cache (`client.guilds.cache`) | kein API-Aufruf |
| **Du auf diesem Server** — Mitglied seit, Nickname, Rollenzahl | `GET /users/@me/guilds/{id}/member` über `guilds.members.read` | ein Aufruf, 60 s zwischengespeichert |

Ist der Bot nicht auf dem Server, fehlt der erste Block. Fehlt der Scope oder ist der Nutzer kein Mitglied mehr, fehlt der zweite. Es wird nie ein Platzhalter eingesetzt — der Block bleibt schlicht weg. Fehlen beide, sagt ein Satz das, statt dass die Übersicht leer dasteht.

Darunter steht **Module**: dort wird eingeschaltet, was der Server nutzen soll, eine Kachel mit Schalter je Modul. Kategorien gibt es keine — die 20 Module stehen in der Reihenfolge aus `client/constants/Modules.ts`:

RL 6Mans · Looking for · RL Team-Übersicht · Clips der Woche · Matchups · Moderation · Auto Mod · Logging System · Welcome System · Apply System · Self Roles · Level System · Giveaways · Umfragen · Temp Voice · Ticket System · Twitch Notifier · YouTube Notifier · Custom Message · Gallery System

Jedes Modul trägt einen Satz, worum es geht — auf seiner Kachel unter dem Namen und auf seiner Karte.

Was zusammengehört, hängt am Modul selbst: **Teile** (`parts`) kommen mit ihrem Modul. Das Ticket System bringt **Live Tickets** und **Transcriptions** mit; sie haben keinen eigenen Schalter, stehen eingerückt unter ihm in der Leiste und haben eine eigene Karte. In `guild_settings.modules` steht dafür nur `tickets` — die IDs der Teile nie, und der Bot kennt sie auch nicht.

In der Seitenleiste steht ein Modul erst, wenn es eingeschaltet ist. Ein frischer Server beginnt links also mit Übersicht, Module und **Moderatoren** (die Liste für Tickets und Moderation, nur für wer verwaltet) — statt mit zwei Dutzend auf einmal. Gebaut sind Ticket System, Gallery System, [Moderation](Moderation.md), [Twitch- und YouTube-Notifier](Notifiers.md), [Umfragen](Polls.md) und [Giveaways](Giveaways.md); jedes andere eingeschaltete Modul zeigt bis dahin seinen Namen, seinen Satz und „Dieses Modul kommt noch“.

Eine gespeicherte ID, deren Modul es nicht mehr gibt, zählt als aus — auf der Serverseite und in der Anzahl auf den Karten. So verschwinden `rl-tracking` (entfernt) und `embed-builder` (heute Custom Message, `custom-message`) ohne Migration.

**Gespeichert wird beim Bot**, in `guild_settings.modules`, nicht im Browser. Es gilt für alle, die den Server verwalten, und später liest der Bot dort, was an ist. Ein Schalter schickt `POST <base>/api/guild/:id/modules` mit `{ "module": "tickets", "on": true }`, zurück kommt die neue Liste.

| Regel | Sonst |
|---|---|
| Nur mit `canManage` — Owner oder „Server verwalten“. Staff-Zugriff allein reicht nicht, wie überall im Dashboard | `403` |
| Nur JSON — der CSRF-Schutz, derselbe wie beim Gruppen-Endpunkt | `415` |
| Nur Module aus `src/constants/Modules.ts` | `400` |
| Nur mit Datenbank. Die Schalter bleiben dann gesperrt, und die Seite sagt es | `503` |

Die Schalter antworten sofort, die Anfragen laufen nacheinander: der Bot liest und schreibt jedes Mal die ganze Liste (`GuildSettings.Toggle()`), zwei zugleich könnten sich überschreiben. Lehnt der Bot ab, springt der Schalter zurück, und die Seite nennt den Grund. Zwei Admins, die im selben Augenblick schalten, sind damit nicht abgedeckt — das bräuchte eine Transaktion.

Den Stand holt die Seite über `/api/guild/:id` frisch aus der Datenbank, nicht aus der zwischengespeicherten Serverliste — sonst stünde nach dem Umschalten bis zu einer Minute der alte da. Die Karten der Serverauswahl zeigen nur die Anzahl.

Die Liste steht zweimal, und das ist Absicht: `src/constants/Modules.ts` sagt dem Bot, welche IDs es gibt, `client/constants/Modules.ts` dem Dashboard, wie sie heißen, wohin sie gehören und welches Symbol sie tragen. `npm run check:dashboard` prüft, dass beide übereinstimmen und jedes Symbol im Sprite von `guild.html` steht.

Die **ID** eines Moduls ist sein Schlüssel: der Abschnitt in der Adresse und der Eintrag in `guild_settings.modules`. Wo es das Modul auf der Webseite schon gibt, ist es dieselbe ID wie dort (`src/data/modules.data.ts`) — Self Roles heißt deshalb `reaction-roles`, Temp Voice `voice-hub`. Sie beginnt mit einem Buchstaben, weil `#6mans` kein gültiger Selektor wäre; RL 6Mans heißt `rl-6mans`.

Die Seite ist breiter als die übrigen (`--shell` 1440 statt 1180 px). Auf schmalen Bildschirmen wird die Leiste wie in den Einstellungen zur waagerechten Reihe, ohne Kategorie-Überschriften.

---

## Design

Die Oberfläche trägt dieselbe Handschrift wie die [Webseite](https://nexus-emb.de) und die Rang-Karte, die der Bot in Discord postet: fast schwarzer Grund, **abgeschnittene statt gerundeter Ecken**, Oxanium für den Text, Rajdhani für die gesperrten Großbuchstaben-Labels, Orbitron für das Wortzeichen.

Alles Farbige, Maße und Schriften stehen als Tokens am Kopf von `assets/style.css` — dieselben Werte wie `src/constants/RankCard.ts` und `src/styles/_tokens.scss` der Webseite. Wer dort eine Farbe dreht, dreht sie hier mit.

Die Abschrägung macht **eine** Regel: zwei Selektorlisten am Anfang von `style.css` setzen `clip-path` auf alle Flächen (`--cut`) und alles Kleine (`--cut-sm`). Wer eine neue Fläche hinzufügt, trägt sie dort ein.

> `clip-path` schneidet auch weg, was aus dem Element herausragt — einen äußeren `box-shadow`, ein `outline`, ein `::after` mit negativem `inset`. Deshalb steht der Fokusring dieser Elemente als **innen** liegender Schatten direkt darunter, und Avatare, Schalter und Punkte bleiben rund.

Die Akzentfarbe steht fest: das Rot `#ff1e2d`, dasselbe wie auf der Webseite und auf der Rang-Karte. Eine Auswahl gibt es nicht, weil drei Oberflächen eines Produkts nicht drei verschiedene Farben tragen sollen.

---

## Prüfen

```bash
npm run check:dashboard          # wie im Betrieb: an der Wurzel
npm run check:dashboard -- --dev # wie lokal: unter /dashboard
```

Startet nur den Fastify-Server (kein Discord-Login), klopft alle Routen ab — Login-Weiche, `state`-Prüfung, Pfadschutz, offener Redirect, `401` ohne Sitzung, Gruppen-Rangfolge, Hausfarbe im Stylesheet, Symbole und IDs der Module, der Modul-Schalter — und beendet sich mit Exit-Code `1`, sobald etwas nicht stimmt. Nebenbei gibt das Skript die aktuelle Redirect-URI aus, die ins Developer Portal gehört.

Der Check nimmt denselben Pfad wie der Server im selben Prozess: **ohne** Schalter prüft er die Adressen des Betriebs (Wurzel), **mit** `--dev` die von `localhost`. Beide sollten durchlaufen.

---

## Aufbau

Das Frontend lag einmal vollständig in einer Datei. Bei 3.000 Zeilen fand darin niemand mehr etwas, deshalb steht es jetzt in Ordnern — als echte ES-Module, ohne Bundler: `tsc` schreibt aus jeder Quelldatei eine `.js` daneben, und der Browser lädt sie über `<script type="module">` selbst nach.

**Wichtig für neue Dateien:** Importe werden mit der Endung `.js` geschrieben, auch in TypeScript (`import { need } from "../core/Dom.js"`). TypeScript lässt den Pfad beim Bauen unverändert stehen — ohne Endung sucht der Browser eine Datei, die es nicht gibt, und die Seite bleibt weiß. `npm run check:dashboard` läuft den Modulbaum ab und schlägt an, bevor das jemandem auffällt.

```
src/dashboard/
  tsconfig.json          eigener Build: DOM-Typen, ESNext, ohne Node-Typen
  client/
    app.ts               nur noch der Einstieg: welche Seite wird gezeichnet
    interfaces/          was der Bot schickt (IUser, IGuild, IRank)
    constants/           Tabellen ohne Logik: Gruppen, Ränge, Plattformen, Module
    core/                für alle Seiten: Dom, Format, Prefs, Sound, Toast, Api,
                         Base (der Pfad des Dashboards)
    services/            was mit dem Bot spricht: Notes (Postfach), Accounts
    layout/              was auf jeder Seite steht: Footer, Profile, UserMenu,
                         Topbar, GuildCard
    pages/               eine Datei je Seite: Servers, Guild, Tracking,
                         Settings, Admin, Docu, GuildOverview
  public/
    index.html           Serverauswahl
    guild.html           Detailseite
    tracking.html        Ränge, Karriere, Club
    settings.html        Einstellungen
    admins.html          Admin-Dashboard
    docu.html            Dokumentation (ohne Anmeldung lesbar)
    privacy.html         Datenschutz (ohne Anmeldung lesbar)
    denied.html          Login abgebrochen
    mfa.html             Discord-Konto ohne Zwei-Faktor
    assets/style.css     Stylesheet: Tokens, Abschrägungen, Bausteine
    assets/fonts/        Oxanium, Rajdhani, Orbitron, selbst ausgeliefert
    assets/images/       Logo, Rang-Abzeichen, Plattform- und Statistik-Symbole
    assets/app.js        Einstieg - Ergebnis von npm run build:dashboard
    assets/chunks/       je Seite und Bereich ein Stück, Prüfsumme im Namen

src/routes/Dashboard*.ts       eine Datei pro Route
src/services/DashboardService.ts   OAuth, Sitzungen, Serverliste
src/constants/Dashboard.ts     Pfade, Cookies, Berechtigungen, Helfer
src/constants/Modules.ts       welche Module sich einschalten lassen (IDs)
src/services/ActivityService.ts  zählt Nachrichten, Voice und Beitritte mit (docs/Activity.md)
src/utils/dashboard.ts         Sitzung aus dem Request, Seiten und Dateien ausliefern
src/utils/seal.ts              Sitzung ver- und entschlüsseln (AES-256-GCM)
```

Die Typprüfung des Dashboards läuft mit `noUnusedLocals` und `noUnusedParameters`: ein Import, den niemand mehr braucht, lässt den Bau scheitern statt still liegenzubleiben.

`public/` wird **nicht** nach `dist` kopiert — die Dateien werden zur Laufzeit aus `src/dashboard/public` gelesen, genau wie `src/images` und `src/config`. Bei einem Deployment muss der Ordner also mit auf den Server.
