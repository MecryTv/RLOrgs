# Server

Fastify-Server neben `index.ts` und `Guardian.ts`. Routen liegen in `src/routes` und werden vom `RouteManager` geladen, abgesichert und an Fastify gehängt.

Alles liegt unter dem Präfix **`/dcapi`** — die Schnittstelle, über die ein Minecraft-Plugin oder ein Webpanel mit dem Bot spricht. Ausnahmen sind `/images/*`, das Discord selbst abruft, und das Dashboard, das der Browser eines Menschen aufruft und deshalb per Cookie statt per Bearer-Token authentifiziert — siehe [Dashboard.md](Dashboard.md).

> **Das Dashboard hängt nicht immer unter `/dashboard`.** Im `--dev` Modus schon, im Betrieb liegt es an der Wurzel seiner eigenen Domain (`dashboard.nexus-emb.de`) und die Routen heißen dort `/login`, `/api/me`, `/assets/*`. Das ist der Grund, warum die Bilder des Dashboards unter `/assets/images` liegen: eine eigene Route `/images/*` hätte sich ohne Präfix mit der Galerie darunter gestritten, und `RouteManager.Register()` nimmt einen Pfad nur einmal an.

Zugriff über den Client: `this.client.server`.

---

## Ablauf beim Start

1. `BotClient.Init()` ruft `server.Start()` auf — unabhängig vom Discord-Login.
2. `Start()` prüft `SERVER_JWT_SECRET` (aus der `.env`, siehe [Environment.md](Environment.md)). Fehlt es oder ist es zu kurz, startet der Server gar nicht erst.
3. `@fastify/rate-limit` wird mit dem globalen Limit aus der `.env` registriert.
4. `RouteManager.Load()` lädt **jede Datei** in `src/routes`, `Apply()` hängt sie in Fastify.
5. Beim Shutdown läuft `server.Stop()`.

### .env

```json
"SERVER_PORT": 3000,
"SERVER_PUBLIC_URL": "https://dashboard.nexus-emb.de",
"SERVER_JWT_EXPIRES_IN": "30d",
"SERVER_RATE_LIMIT_MAX": 100,
"SERVER_RATE_LIMIT_WINDOW": "1 minute"
```

### .env

```bash
SERVER_JWT_SECRET="..."
```

---

## Eine Route anlegen

Eine Datei in `src/routes`, die per `default` eine Klasse exportiert. Im Editor gibt es dafür das Snippet **`route`**.

```ts
// src/routes/Stats.ts
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";

export default class Stats extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: "/stats",
            description: "Guild- und Task-Zahlen für das Panel",
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        return { guilds: this.client.guilds.cache.size, angefragtVon: request.token?.sub };
    }
}
```

| Option | Standard | Bedeutung |
|---|---|---|
| `method` | — | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, … |
| `path` | — | Fastify-Pfad, Wildcards mit `*`, Parameter mit `:name` |
| `description` | — | Wofür die Route da ist |
| `prefixed` | `true` | `false` hängt die Route ohne `/dcapi` ein |
| `requiresAuth` | `true` | `false` macht die Route ohne Token erreichbar |
| `rateLimit` | globales Limit | `{ max, timeWindow }` überschreibt es für diese Route |

`path: "/stats"` wird also zu `/dcapi/stats`. Der Präfix steht als `API_PREFIX` in `src/structures/Route.ts` und wird schon im Konstruktor aufgelöst — `route.path` und `route.Key` zeigen immer den echten Pfad.

Der Rückgabewert von `Handle` geht als JSON raus. Wer Header oder Status setzen will, benutzt `reply` und gibt das Ergebnis zurück.

Wirft `Handle`, fängt der RouteManager das ab: 500 an den Aufrufer, Meldung im Log und ein Bericht über `guardian.HandleServer()`. Ein Request endet nie ohne Antwort.

---

## Die Endpunkte

| Route | Auth | Antwort |
|---|---|---|
| `GET /dcapi/health` | ja | `{ status, uptime }` |
| `GET /images/*` | nein | Die Datei aus `src/images`, sonst 403 / 404 |
| `GET /dashboard*` (dev) bzw. alles Übrige (Betrieb) | Cookie | Das Webpanel — eigener Login über Discord OAuth2, siehe [Dashboard.md](Dashboard.md) |

```bash
curl -H "Authorization: Bearer $TOKEN" https://dashboard.nexus-emb.de/dcapi/health
```

Mehr braucht der Bot im Moment nicht. Weitere Endpunkte sind eine neue Datei in `src/routes` — der `RouteManager` findet sie beim Start von allein.

---

## Token-Pflicht

Jede Route verlangt standardmäßig einen Bearer-Token:

```
Authorization: Bearer <token>
```

Ohne oder mit ungültigem Token kommt `401` samt `WWW-Authenticate`. Der Handler wird dann nie erreicht — die Prüfung läuft als `onRequest`-Hook davor. Im Handler stehen die Nutzdaten unter `request.token` (`sub`, `scope`, `iat`, `exp`).

### Warum `/images/*` offen ist

Discord holt Bild-URLs **selbst** ab, um Embeds zu rendern, und schickt dabei keinen `Authorization`-Header mit. Eine Token-Pflicht auf `/images/*` würde jedes Galerie-Bild in Discord unsichtbar machen. Die Route steht deshalb als einzige auf `requiresAuth: false` und hat stattdessen ein eigenes, großzügigeres Rate Limit (300/Minute), weil eine Nachricht viele Bilder enthalten kann.

Sie ist aus demselben Grund auch `prefixed: false` und bleibt auf `/images/*` statt `/dcapi/images/*`: die URLs stehen in bereits verschickten Nachrichten und müssen weiter stimmen. `/dcapi` ist die Schnittstelle für Plugin und Panel, `/images` die Auslieferung für Discord — zwei verschiedene Dinge, zwei verschiedene Pfade.

Der Pfadschutz gegen Traversal und fremde Dateitypen bleibt davon unberührt (`ResolveImagePath`).

### Tokens erzeugen

```bash
npm run token -- --sub minecraft-plugin
```

| Argument | Bedeutung |
|---|---|
| `--sub <name>` | Für wen der Token ist. Pflicht. |
| `--expires <dauer>` | `30d`, `12h`, `90m`, `45s`. Standard: `SERVER_JWT_EXPIRES_IN` |
| `--scope <a,b>` | Kommagetrennte Berechtigungen, landen im Token |
| `--secret` | Erzeugt ein neues `SERVER_JWT_SECRET` |
| `--help` | Kurzhilfe |

Ein neues Secret macht **alle** bereits ausgegebenen Tokens ungültig. Tokens lassen sich nicht einzeln zurückziehen — kurze Laufzeiten sind deshalb besser als eine lange.

Die Tokens sind selbst signierte JWTs (HS256, `node:crypto`). Beim Prüfen wird das `alg` aus dem Token nie zum Auswählen des Verfahrens benutzt, es wird immer HS256 gerechnet und erst danach verglichen — die klassische alg-Confusion läuft damit ins Leere. 

---

## Rate Limits

Global aus der `.env`, pro Route überschreibbar. Gezählt wird pro IP; ist das Budget aufgebraucht, kommt `429` mit `Retry-After`.

```ts
rateLimit: { max: 10, timeWindow: "1 minute" }
```

Der Zähler liegt im Arbeitsspeicher: nach einem Neustart ist er leer, und mehrere Bot-Instanzen zählen getrennt. Für eine Instanz reicht das.

---

## Die Manager-API

```ts
const server = this.client.server;

server.Routes.Size                       // Anzahl registrierter Routen
server.Routes.Keys                       // ["GET /dcapi/health", "GET /images/*"]
server.Routes.Get("GET /dcapi/health")   // die Route
server.Routes.Has(key)
server.Routes.Register(route)      // false bei doppelter Methode+Pfad
server.Routes.Remove(key)
server.Routes.Clear()

server.IsRunning
server.Instance                    // die Fastify-Instanz, sonst null
server.BaseURL                     // localhost im Dev-Modus, sonst SERVER_PUBLIC_URL
server.Port = 8080                 // wirft, solange der Server läuft
server.Host = "127.0.0.1"          // dito
```

`Port` und `Host` sind nur änderbar, solange der Server steht — Fastify liest beide ausschließlich beim `listen()`, ein Setter im Betrieb wäre eine Lüge.

`Register` und `Remove` wirken auf den Manager. Sie greifen erst nach einem `Stop()` und `Start()`, weil Fastify Routen nur vor dem `listen()` annimmt.

---

## developerMode

`BaseURL` zeigt im `--dev` Modus auf `http://localhost:<SERVER_PORT>`. Discord kann localhost nicht laden, deshalb schickt der GalleryService Bilder dort als Anhang statt als URL mit.

Derselbe Schalter entscheidet, wo das Dashboard hängt: `DASHBOARD_PATH` in `src/constants/Dashboard.ts` liest `process.argv` genau wie `BotClient.developerMode` — dort muss der Pfad schon feststehen, bevor es einen Client gibt. Im `--dev` Modus `/dashboard`, sonst leer.

Der Server läuft mit `ignoreTrailingSlash: true`. An der Wurzel heißt das Dashboard `/`, im Entwicklungsmodus `/dashboard` — ein Link auf `/dashboard/` soll dieselbe Seite treffen und nicht ins Leere laufen.
