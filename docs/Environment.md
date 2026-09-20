# Umgebung

Die gesamte Konfiguration des Bots steckt in **einer** Datei: der `.env` im Projekt-Root. Eine `config.json` gibt es nicht mehr.

Gelesen wird sie genau einmal, in `src/utils/config.ts`. Der Rest des Bots sieht nur noch ein fertiges `IConfig` über `this.client.config`.

> **Was hier *nicht* steht:** wer im Dashboard Administrator, Partner oder Premium ist. Das liegt in der Datenbank und wird im Dashboard unter `/admins` vergeben — siehe [Dashboard.md](Dashboard.md). Nicht zu verwechseln mit dem **ConfigService** (`src/config/*.json`, siehe [ConfigService.md](ConfigService.md)): der verwaltet Auswahllisten für Discord-Panels.

---

## Einrichtung

```bash
cp .env.example .env
npm run token -- --secret     # erzeugt SERVER_JWT_SECRET
```

Die Datei liegt im **Projekt-Root**, nicht in `src`. Der Pfad wird beim Start aus `process.cwd()` aufgelöst — der Bot muss also aus dem Projekt-Root gestartet werden.

`.env` steht in der `.gitignore`, `.env.example` ist die Vorlage und kommt mit.

---

## Alle Werte

### Discord

| Variable | Pflicht | Standard | Wofür |
|---|---|---|---|
| `CLIENT_TOKEN` | ja | — | Bot-Token der Produktiv-Application |
| `CLIENT_ID` | ja | — | Application-ID, produktiv |
| `CLIENT_SECRET` | nein | `""` | OAuth2-Secret fürs Dashboard. Fehlt es, antwortet `/dashboard` mit `503` |
| `DEV_CLIENT_TOKEN` | ja | — | Bot-Token der Dev-Application |
| `DEV_CLIENT_ID` | ja | — | Application-ID, Entwicklung |
| `DEV_CLIENT_SECRET` | nein | `""` | OAuth2-Secret im `--dev` Modus |
| `DEV_GUILD_ID` | ja | — | Server, auf dem Commands im `--dev` Modus sofort registriert werden — global dauert das bis zu eine Stunde |
| `DEV_USER_IDs` | nein | `""` | **Kommagetrennt.** Wer `developerOnly`-Commands ausführen darf und ins Admin-Dashboard kommt |
| `GUILD_MEMBER_INTENT` | nein | `false` | Privilegiertes Members-Intent. Nur `true`, wenn es im Developer Portal ebenfalls an ist — sonst weist Discord den Login rundweg ab. Das [Welcome System](Welcome.md) braucht es: ohne sieht der Bot niemanden kommen |
| `GUILD_PRESENCE_INTENT` | nein | `false` | Ebenfalls privilegiert. Nur für die **Live-Rolle** des Twitch Notifiers ([Notifiers.md](Notifiers.md#live-rolle)); aus = der Rest des Notifiers läuft trotzdem |
| `PRIME_API_TOKEN` | nein | `""` | Rang-Tracking über prime.rocketplanet.gg. Leer = kein Tracking, siehe [Prime.md](Prime.md) |
| `EPIC_CLIENT_ID` | nein | `""` | Epic Account Services. Leer = kein Epic-Login, das Dashboard fällt auf die Eingabe des Namens zurück |
| `EPIC_CLIENT_SECRET` | nein | `""` | Das Secret dazu. Ohne beide Werte bleibt der Anmelde-Knopf aus |
| `TWITCH_CLIENT_ID` | nein | `""` | Twitch-App für den [Twitch Notifier](Notifiers.md). Leer = keine Live-Meldungen, das Dashboard sagt das über dem Modul |
| `TWITCH_CLIENT_SECRET` | nein | `""` | Das Secret dazu. Ohne beide Werte fragt der Bot Twitch gar nicht erst |
| `YOUTUBE_API_KEY` | nein | `""` | Nur für **Livestreams** im [YouTube Notifier](Notifiers.md). Videos und Shorts kommen ohne Schlüssel aus dem Kanal-Feed |

#### Epic-Login einrichten

Für die Konto-Verknüpfung gibt es **eine** Anmeldung: Epic. Jedes
Rocket-League-Konto hängt an einem Epic-Konto, und die Ränge sind über alle
Plattformen dieselben — eine zweite Anmeldung brächte keine anderen Zahlen.

1. Auf [dev.epicgames.com](https://dev.epicgames.com/portal) ein Produkt anlegen.
2. Unter **Product Settings → Clients** einen Client anlegen. Client-ID und
   Secret gehören in die `.env`.
3. Unter **Epic Account Services** als **Redirect URL** exakt diese Adressen
   eintragen — Epic vergleicht sie zeichengenau, und es sind zwei, weil das
   Dashboard lokal unter `/dashboard` und im Betrieb an der Wurzel seiner
   eigenen Domain liegt:

   ```
   http://localhost:3000/dashboard/link/epic/callback
   <SERVER_PUBLIC_URL>/link/epic/callback
   ```
4. Als Berechtigung genügt `basic_profile`. Mehr wird nicht abgefragt: gebraucht
   wird nur die Konto-ID, den Namen löst Prime damit selbst auf.

Für PlayStation und Nintendo gibt es ohnehin **keinen** öffentlichen Login: Sony
und Nintendo bieten Dritten keine Anmeldung an.

#### Twitch und YouTube einrichten

**Twitch:** auf [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) eine
kostenlose App anlegen (OAuth Redirect `http://localhost`, Kategorie *Chat Bot*),
Client-ID und Secret in die `.env`. Der Bot holt sich damit selbst ein
App-Token und erneuert es, wenn es abläuft — nichts weiter einzurichten.

**YouTube:** Videos und Shorts liest der Bot aus dem öffentlichen Kanal-Feed,
dafür braucht es nichts. Nur **Livestreams** gehen über die YouTube Data API:
auf [console.cloud.google.com](https://console.cloud.google.com) ein Projekt
anlegen, *YouTube Data API v3* aktivieren, unter *Anmeldedaten* einen
API-Schlüssel erstellen. Ohne Schlüssel bleibt „Livestreams" im Dashboard
gesperrt, der Rest läuft.

`DEV_GUILD_ID` ist auch dann Pflicht, wenn nie im Dev-Modus gestartet wird.

### Datenbank

| Variable | Pflicht | Standard | Wofür |
|---|---|---|---|
| `DATABASE_HOST` | nein | `""` | Host der MariaDB. Leer heißt: der Bot läuft ohne Datenbank |
| `DATABASE_PORT` | nein | `3306` | Port |
| `DATABASE_NAME` | nein | `""` | Name der Datenbank |
| `DATABASE_USER` | nein | `""` | Nutzer |
| `DATABASE_PASSWORD` | nein | `""` | Passwort |
| `DATABASE_POOL_LIMIT` | nein | `5` | Wie viele Verbindungen der Pool höchstens offen hält |

Fehlt Host, Name oder Nutzer, wird gar nicht erst verbunden — siehe [Database.md](Database.md).

### Webserver

| Variable | Pflicht | Standard | Wofür |
|---|---|---|---|
| `SERVER_JWT_SECRET` | ja | — | Schlüssel für API-Tokens **und** die Dashboard-Sitzungen |
| `SERVER_PORT` | nein | `3000` | Port des Fastify-Servers |
| `SERVER_PUBLIC_URL` | nein | `http://localhost:3000` | Die eigene Domain des Dashboards (`https://dashboard.nexus-emb.de`). Baut Redirect-URIs und Bild-URLs |
| `SITE_PUBLIC_URL` | nein | `https://nexus-emb.de` | Die Hauptseite. Steht als `<meta>` in jeder Dashboard-Seite; die Fußzeile verlinkt dorthin |
| `SERVER_JWT_EXPIRES_IN` | nein | `30d` | Standard-Gültigkeit neuer API-Tokens |
| `SERVER_RATE_LIMIT_MAX` | nein | `100` | Anfragen pro Fenster und IP |
| `SERVER_RATE_LIMIT_WINDOW` | nein | `1 minute` | Länge des Fensters |

`SERVER_PUBLIC_URL` wird im `--dev` Modus ignoriert — dort ist die Basis-URL immer `http://localhost:<SERVER_PORT>`. Ein abschließender `/` wird abgeschnitten.

**Zwei Domains, zwei Pfade.** Im Betrieb liegt das Dashboard an der **Wurzel** von `SERVER_PUBLIC_URL`, im `--dev` Modus unter `/dashboard` auf `localhost`. Das schlägt auf beide Redirect-URIs durch, die hinterlegt werden müssen:

```
http://localhost:3000/dashboard/callback              https://dashboard.nexus-emb.de/callback
http://localhost:3000/dashboard/link/epic/callback    https://dashboard.nexus-emb.de/link/epic/callback
```

Warum das so ist und wo es im Code steht: [Dashboard.md](Dashboard.md#zwei-adressen).

Ein neues `SERVER_JWT_SECRET` macht **alle** bestehenden API-Tokens und Dashboard-Sitzungen ungültig.

---

## Schreibweisen

### Werte immer in Anführungszeichen

```bash
CLIENT_TOKEN="MTIz.Abc#def"     ✅
CLIENT_TOKEN=MTIz.Abc#def       ❌ wird zu "MTIz.Abc"
```

Ein unmaskiertes `#` startet einen Kommentar — der Wert wird still abgeschnitten. Tokens und Secrets enthalten regelmäßig `#`.

### Mehrere IDs: kommagetrennt

```bash
DEV_USER_IDs="1059621019947634739,934857203948572034"
```

Leerzeichen um die Kommas sind in Ordnung, leere Einträge fallen weg.

**IDs sind Text, keine Zahlen.** In der `.env` ist ohnehin alles Text — anders als früher in der `config.json`, wo eine Snowflake als JSON-Zahl still gerundet wurde.

### Wahrheitswerte

```bash
GUILD_MEMBER_INTENT="true"      # an, "1" geht auch
GUILD_MEMBER_INTENT="ja"        # aus
```

Nur `true` und `1` schalten ein. Ein Tippfehler schaltet damit **ab** und nicht versehentlich ein — wichtig bei `GUILD_MEMBER_INTENT`, wo ein falsch angefordertes Intent den Login scheitern lässt.

### Zwei Zeitformate

Die beiden Zeitangaben werden von **verschiedenen** Parsern gelesen und sind nicht austauschbar:

| Variable | Format | Beispiele |
|---|---|---|
| `SERVER_JWT_EXPIRES_IN` | `<Zahl><Einheit>`, Einheit `ms` `s` `m` `h` `d` `w` | `30d`, `12h`, `90m` |
| `SERVER_RATE_LIMIT_WINDOW` | ausgeschrieben, für `@fastify/rate-limit` | `1 minute`, `30 seconds` |

`SERVER_JWT_EXPIRES_IN="1 minute"` wird nicht erkannt und fällt auf die eingebaute Standard-Gültigkeit zurück.

### Echte Umgebungsvariablen gewinnen

`process.loadEnvFile()` überschreibt nichts, was schon gesetzt ist. In Docker oder systemd gesetzte Variablen stechen also die Datei — derselbe Code läuft lokal wie im Betrieb.

---

## Wenn etwas nicht stimmt

| Meldung | Ursache |
|---|---|
| `CLIENT_TOKEN fehlt in der .env - siehe .env.example.` | Pflichtfeld fehlt, ist leer oder die Datei liegt nicht im Projekt-Root |
| `🗄️ Datenbank nicht eingerichtet` | `DATABASE_HOST`, `DATABASE_NAME` oder `DATABASE_USER` fehlt. Der Bot läuft ohne |
| `Used disallowed intents` | `GUILD_MEMBER_INTENT="true"`, aber im Developer Portal ist es aus |

Pflichtfelder fliegen **vor** dem Login, im Konstruktor von `BotClient`.

### Die stille Falle

```bash
SERVER_PORT="dreitausend"     # ❌ keine Zahl → wird still zu 3000
SERVER_PUBLIC_URL=""          # ❌ leer → wird still zu http://localhost:3000
```

Zahlenfelder akzeptieren nur echte Zahlen, alles andere fällt kommentarlos auf den Standard zurück. Leere Textfelder gelten als *nicht gesetzt*. Wer einen Wert setzt und ihn nicht wiederfindet, prüft zuerst diese beiden Punkte.

---

## Ablauf beim Start

1. `BotClient` ruft `LoadConfig()` auf — noch vor `super()`, weil die Intents an der Konfiguration hängen
2. `process.loadEnvFile()` liest die `.env`, ohne bestehende Variablen zu überschreiben
3. Pflichtfelder werden geprüft; fehlt eines, bricht der Start mit dem Namen ab
4. Optionale Felder bekommen ihre Standardwerte
5. Das fertige `IConfig` hängt an `client.config` und wird nicht mehr angefasst

Die Datenbank wird danach **ohne `await`** verbunden: ist sie nicht erreichbar, steht das im Log und der Bot läuft weiter.
