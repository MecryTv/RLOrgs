# Sidebar-Kategorien und Galerie im Dashboard — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Modul-Leiste des Dashboards nach Kategorien gruppieren, die Galerie zum festen Modul machen und ihr eine Dashboard-Ansicht mit Upload, Bildauswahl und automatischer Komprimierung geben.

**Architecture:** Teil 1 ändert nur Anzeige und Modul-Liste — keine neuen Tabellen, keine neuen Routen. Teil 2 legt eine Komprimierfunktion (`Shrink`) unter den bestehenden `GalleryService`, sodass jeder Weg ins Bildverzeichnis durch sie läuft, und stellt zwei Fastify-Routen davor. Das Dashboard bekommt eine Verwaltungsseite, über die Alben und Bilder ohne Discord zu erreichen sind.

**Tech Stack:** TypeScript (CommonJS für den Bot, ESNext für den Dashboard-Client), discord.js 14, Fastify 5, MariaDB, `@napi-rs/canvas`, `axios`.

**Spec:** `docs/superpowers/specs/2026-09-12-tickets-und-bilder-design.md`, Teil 1 und Teil 2.

## Global Constraints

- **Git.** Das Repository wurde am 12.09.2026 lokal angelegt; Baseline ist `01c500f`, gearbeitet wird auf `feature/sidebar-und-galerie`. Es gibt kein Remote — nichts wird gepusht. Jede Aufgabe endet mit einem Prüflauf **und** einem Commit. `core.autocrlf` steht auf `false`, damit Zeilenenden die Diffs nicht zumüllen.
- **Kein Test-Framework, absichtlich.** Der Kopf von `src/scripts/CheckDashboard.ts` sagt es: „Absichtlich ohne Test-Framework - der Bot hat keins." Prüfungen sind ausführbare Skripte unter `src/scripts/`, angemeldet als `check:*` in `package.json`. Der TDD-Zyklus lautet hier: Prüfung zuerst erweitern, fehlschlagen lassen, dann bauen.
- **Keine neuen npm-Pakete.** Alles Nötige ist vorhanden: `@napi-rs/canvas` für Bilder, `axios` für Downloads, `glob` für die Routen-Erkennung.
- **Der Dashboard-Client kompiliert eigenständig.** `src/dashboard/tsconfig.json` setzt `rootDir: "client"` und `types: []`. Aus `src/dashboard/client/**` darf **nichts** außerhalb von `client/` importiert werden. Geteiltes Wissen wird gespiegelt und von `npm run check:dashboard` verglichen — so läuft es schon für die Modul-Liste.
- **Importe im Client tragen `.js`.** Beispiel: `import { MODULES } from "../constants/Modules.js";` — auch wenn die Quelle `.ts` heißt.
- **Sprache:** Kommentare, Log-Zeilen, Fehlertexte und Oberfläche auf Deutsch.
- **Namen:** Methoden in Klassen PascalCase (`Handle`, `AddImage`), Interfaces mit `I`-Präfix, Dateien PascalCase.
- **Bildregeln, wörtlich aus dem Spec:** längste Kante **1920px**, `canvas.encode("webp", 80)`, `image/gif` unverändert durchlassen, Obergrenze **8 MB**.
- **Kategorie-Namen, wörtlich aus dem Spec:** `Rocket League`, `Community`, `Support`, `Moderation`, `Inhalte & Meldungen`.
- **Festes Modul:** `gallery`, nicht abschaltbar.

## Dateien

| Datei | Verantwortung | Aufgabe |
|---|---|---|
| `src/dashboard/client/constants/Modules.ts` | Kategorien, Modul→Kategorie, `always`-Markierung | 1 |
| `src/scripts/CheckDashboard.ts` | Prüft Kategorien, `always`, Ablehnung des Ausschaltens | 1, 3 |
| `src/dashboard/client/pages/Guild.ts` | Leiste nach Kategorien, gesperrter Schalter, Karten-Hook | 2, 9 |
| `src/dashboard/public/assets/style.css` | `.setnav__cap`, `.modalways`, Galerie-Ansicht | 2, 9 |
| `src/constants/Modules.ts` | `PERMANENT_MODULES`, `IsPermanent` | 3 |
| `src/models/GuildSettings.ts` | Feste Module immer in der Liste | 3 |
| `src/routes/DashboardApiModules.ts` | 400 beim Ausschalten eines festen Moduls | 3 |
| `src/utils/image.ts` | `Shrink` — verkleinern und neu kodieren | 4 |
| `src/scripts/CheckImage.ts` | Selbstprüfung für `Shrink` | 4 |
| `src/constants/Gallery.ts` | `MAX_IMAGE_BYTES`, `UPLOAD_TYPES` | 4 |
| `src/services/GalleryService.ts` | `Store`, `AddUpload`, `AddImage` über einen Weg | 5 |
| `src/interfaces/services/gallery/IGalleryService.ts` | `AddUpload` im Vertrag | 5 |
| `src/Server.ts` | Content-Type-Parser für rohe Bilder | 6 |
| `src/routes/DashboardApiGallery.ts` | Lesen: Kategorien und Bilder | 7 |
| `src/routes/DashboardApiGalleryEdit.ts` | Schreiben: sechs Aktionen unter einem Pfad | 8 |
| `src/dashboard/public/guild.html` | Sektion `gallery` | 9 |
| `src/dashboard/client/pages/GuildGallery.ts` | Verwaltungsansicht | 9 |

---

# Teil 1 — Sidebar-Kategorien

### Task 1: Kategorien in der Modul-Liste

**Files:**
- Modify: `src/dashboard/client/constants/Modules.ts`
- Modify: `src/scripts/CheckDashboard.ts:501-525`

**Interfaces:**
- Produces: `CATEGORIES: IModuleCategory[]` mit `{ id, name }`; `IModule.category: string`; `IModule.always?: true`. Task 2 liest beides.

- [ ] **Step 1: Prüfung zuerst — `CheckDashboard.ts` erweitern**

In `src/scripts/CheckDashboard.ts` den Typ `ModuleEntry` (Zeile 501) ersetzen und die geladene Datei um `CATEGORIES` erweitern:

```ts
    type ModuleEntry = {
        id: string;
        icon: string;
        category?: string;
        always?: true;
        parts?: { id: string; icon: string }[];
    };
    type CategoryEntry = { id: string; name: string };

    const { pathToFileURL } = await import("node:url");
    const moduleFile = path.join(ASSETS, "constants", "Modules.js");
    const guildPage = await readFile(path.join(ASSETS, "..", "guild.html"), "utf8");
    const loaded = existsSync(moduleFile)
        ? ((await import(pathToFileURL(moduleFile).href)) as {
              MODULES?: ModuleEntry[];
              CATEGORIES?: CategoryEntry[];
          })
        : {};

    const modules = loaded.MODULES ?? [];
    const categories = loaded.CATEGORIES ?? [];
```

Direkt hinter den bestehenden Check `Modul-Anker sind eindeutig und brauchbar` diese drei einfügen:

```ts
    // Jedes Modul steht unter einer Ueberschrift der Leiste. Ohne Kategorie
    // fiele es aus der Leiste heraus, ohne dass jemand es merkt.
    const known = new Set(categories.map((entry) => entry.id));
    const homeless = modules.filter((entry) => !entry.category || !known.has(entry.category));

    check(
        `Jedes Modul haengt an einer Kategorie (${modules.length})`,
        categories.length > 0 && homeless.length === 0,
        homeless.map((entry) => entry.id).join(", ")
    );

    const empty = categories.filter((entry) => !modules.some((module) => module.category === entry.id));

    check(
        `Jede Kategorie traegt mindestens ein Modul (${categories.length})`,
        empty.length === 0,
        empty.map((entry) => entry.id).join(", ")
    );

    // Die Galerie gehoert fest dazu. Faellt die Markierung weg, stuende im
    // Dashboard ein Schalter, den der Bot nicht annimmt.
    check(
        "Galerie ist als festes Modul markiert",
        modules.find((entry) => entry.id === "gallery")?.always === true
    );
```

- [ ] **Step 2: Prüfung laufen lassen, Fehlschlag bestätigen**

```bash
npm run build:dashboard && npm run check:dashboard -- --dev
```

Erwartet: drei neue Zeilen mit `FAIL` — `Jedes Modul haengt an einer Kategorie`, `Jede Kategorie traegt mindestens ein Modul`, `Galerie ist als festes Modul markiert`. Exit-Code 1.

- [ ] **Step 3: Kategorien und Zuordnung eintragen**

In `src/dashboard/client/constants/Modules.ts` über `export interface IModulePart` einfügen:

```ts
/**
 * Die Ueberschriften der Leiste, in dieser Reihenfolge. Jedes Modul traegt die
 * id einer davon in seinem Feld `category`. Eine Ueberschrift steht erst in der
 * Leiste, wenn mindestens ein Modul darunter eingeschaltet ist.
 *
 * In der Modul-Uebersicht gibt es sie nicht: dort bleiben die Kacheln flach.
 */
export interface IModuleCategory {
    id: string;
    name: string;
}

export const CATEGORIES: IModuleCategory[] = [
    { id: "rocket-league", name: "Rocket League" },
    { id: "community", name: "Community" },
    { id: "support", name: "Support" },
    { id: "moderation", name: "Moderation" },
    { id: "content", name: "Inhalte & Meldungen" },
];
```

`IModule` um zwei Felder erweitern:

```ts
export interface IModule extends IModulePart {
    /** Unter welcher Ueberschrift das Modul in der Leiste steht. */
    category: string;

    /**
     * Ein festes Modul: immer an, der Schalter steht sichtbar, aber gesperrt.
     * Der Bot fuehrt dieselbe Menge in constants/Modules.ts (PERMANENT_MODULES)
     * und weist ein Ausschalten ab.
     */
    always?: true;

    /**
     * Teile, die mit dem Modul kommen: eigene Karte und eigener Eintrag in der
     * Leiste, aber kein eigener Schalter. In guild_settings.modules steht nur
     * das Modul selbst - die IDs der Teile nie.
     */
    parts?: IModulePart[];
}
```

Dann jedem der 20 Einträge in `MODULES` sein `category`-Feld geben — direkt hinter `icon`:

| Modul | `category` |
|---|---|
| `rl-6mans`, `lft`, `teams`, `clips`, `matchups` | `"rocket-league"` |
| `moderation`, `automod`, `logging` | `"moderation"` |
| `welcome`, `apply`, `reaction-roles`, `levels`, `giveaways`, `polls`, `voice-hub` | `"community"` |
| `tickets` | `"support"` |
| `custom-message`, `gallery`, `twitch-notifier`, `youtube-notifier` | `"content"` |

Beispiel für den ersten Eintrag:

```ts
    {
        id: "rl-6mans",
        name: "RL 6Mans",
        description: "Warteschlange für 3v3-Pickup-Games: sechs Spieler, ausgeglichene Teams, Ergebnisse mit Rangliste.",
        icon: "#i-gamepad",
        category: "rocket-league",
    },
```

Und der Galerie-Eintrag bekommt zusätzlich `always`:

```ts
    {
        id: "gallery",
        name: "Gallery System",
        description: "Logos, Grafiken und Vorlagen in Alben sortieren, durchblättern und finden.",
        icon: "#i-image",
        category: "content",
        always: true,
    },
```

- [ ] **Step 4: Prüfung laufen lassen, Erfolg bestätigen**

```bash
npm run build:dashboard && npm run check:dashboard -- --dev
```

Erwartet: die drei neuen Zeilen mit `ok`. Die übrigen Prüfungen bleiben unverändert grün.

- [ ] **Step 5: Typen prüfen**

```bash
npm run typecheck
```

Erwartet: keine Ausgabe, Exit-Code 0.

---

### Task 2: Überschriften in der Leiste

**Files:**
- Modify: `src/dashboard/client/pages/Guild.ts:305-380` (`bindModules`)
- Modify: `src/dashboard/public/assets/style.css:1328` (hinter `.setnav a.is-sub svg`)

**Interfaces:**
- Consumes: `CATEGORIES`, `IModule.category`, `IModule.always` aus Task 1.
- Produces: `card()` überspringt Module, deren Sektion schon in `guild.html` steht — Task 9 hängt daran.

- [ ] **Step 1: CSS für die Überschriften**

In `src/dashboard/public/assets/style.css` direkt hinter `.setnav a.is-sub svg{width:13px;height:13px}` (Zeile 1328) einfügen:

```css
/* Ueberschrift einer Modulgruppe. Kein Link, nur Beschriftung - sie
   verschwindet, solange kein Modul darunter eingeschaltet ist. Der erste
   Abstand faellt weg, damit sie nicht vom Rand abrutscht. */
.setnav__cap{
  margin:14px 0 4px;padding:0 12px;
  font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-3);
}
.setnav__cap:first-of-type{margin-top:10px}
/* Ein festes Modul: der Schalter steht da, laesst sich aber nicht bewegen. */
.modlist .modalways{display:block;margin-top:4px;color:var(--text-2)}
```

- [ ] **Step 2: Import erweitern**

In `src/dashboard/client/pages/Guild.ts` Zeile 8 ersetzen:

```ts
import { CATEGORIES, IModulePart, MODULES } from "../constants/Modules.js";
```

- [ ] **Step 3: `card()` an vorhandene Sektionen anpassen**

In `bindModules()` die Funktion `card` ersetzen:

```ts
    function card(entry: IModulePart): void {
        // Steht die Sektion schon im HTML, gehoert sie einem gebauten Modul und
        // fuellt sich selbst. Nur was es noch nicht gibt, bekommt die Platzkarte.
        if (document.getElementById(entry.id)) return;

        const box = clone("#moduleCard");

        box.id = entry.id;
        box.querySelector(".modhead")!.append(icon(entry.icon), entry.name);
        box.querySelector(".modlead")!.textContent = entry.description;
        cards.append(box);
    }
```

- [ ] **Step 4: Die Aufbau-Schleife in zwei teilen**

Zwei Stellen, ein Block. **Erst löschen**, dann einsetzen:

1. Die Deklaration `const entries = new Map<string, { links: HTMLElement[]; tile: HTMLElement; input: HTMLInputElement }>();` samt dem Kommentar darüber — sie steht weiter oben, vor `let saved`. Sie kommt unten in erweiterter Form zurück.
2. Die Schleife `for (const module of MODULES) { ... }` vollständig — von `const links = [link(module, false)];` bis `entries.set(module.id, { links, tile, input });`.

An die Stelle der gelöschten Schleife (also hinter `function card()`, vor `function paint()`) kommt:

```ts
    // Je Modul: seine Eintraege in der Leiste (das Modul selbst und seine Teile),
    // seine Kachel, sein Schalter und ob es fest dazugehoert.
    const entries = new Map<
        string,
        { links: HTMLElement[]; tile: HTMLElement; input: HTMLInputElement; always: boolean }
    >();

    // Die Leiste steht nach Kategorien: erst die Ueberschrift, dann ihre Module.
    // Die Kacheln unter "Module" bleiben flach - dort gibt es keine Kategorien.
    const groups: { cap: HTMLElement; ids: string[] }[] = [];
    const bars = new Map<string, HTMLElement[]>();

    for (const category of CATEGORIES) {
        const members = MODULES.filter((entry) => entry.category === category.id);

        if (members.length === 0) continue;

        const cap = document.createElement("p");

        cap.className = "setnav__cap";
        cap.textContent = category.name;
        cap.hidden = true;
        nav.append(cap);

        for (const module of members) {
            const own = [link(module, false)];

            for (const part of module.parts ?? []) own.push(link(part, true));

            bars.set(module.id, own);
        }

        groups.push({ cap, ids: members.map((entry) => entry.id) });
    }

    for (const module of MODULES) {
        card(module);

        const tile = clone("#moduleTile");

        tile.querySelector(".acct__mark")!.append(icon(module.icon));
        tile.querySelector("b")!.textContent = module.name;
        tile.querySelector(".acct__text span")!.textContent = module.description;

        if (module.parts) {
            // Was mit angeht, steht auf der Kachel - sonst tauchen zwei Eintraege
            // in der Leiste auf, die niemand eingeschaltet hat.
            const parts = document.createElement("span");

            parts.className = "modparts";
            parts.textContent = `Mit dabei: ${module.parts.map((part) => part.name).join(" · ")}`;
            tile.querySelector(".acct__text")!.append(parts);

            for (const part of module.parts) card(part);
        }

        if (module.always) {
            const fixed = document.createElement("span");

            fixed.className = "modalways";
            fixed.textContent = "Immer an – dieses Modul gehört fest dazu.";
            tile.querySelector(".acct__text")!.append(fixed);
        }

        list.append(tile);

        const input = tile.querySelector<HTMLInputElement>("input")!;

        if (!module.always) input.addEventListener("change", () => toggle(module.id, input.checked));

        entries.set(module.id, {
            links: bars.get(module.id) ?? [],
            tile,
            input,
            always: Boolean(module.always),
        });
    }
```

- [ ] **Step 5: `paint()` um Überschriften und feste Module erweitern**

Die Funktion `paint()` ersetzen:

```ts
    function paint(): void {
        for (const [id, entry] of entries) {
            const on = shown.has(id) || entry.always;

            for (const anchor of entry.links) anchor.hidden = !on;

            entry.input.checked = on;
            entry.input.disabled = entry.always || !ready || !guild.canManage;
            entry.tile.classList.toggle("acct--on", on);
        }

        // Eine Ueberschrift ohne eingeschaltetes Modul darunter waere eine
        // Zeile, die auf nichts zeigt.
        for (const group of groups) {
            group.cap.hidden = !group.ids.some((id) => shown.has(id) || entries.get(id)?.always);
        }
    }
```

- [ ] **Step 6: Bauen und im Browser ansehen**

```bash
npm run build:dashboard && npm run typecheck
```

Erwartet: beide ohne Ausgabe, Exit-Code 0.

Dann `npm run dev` starten, `/guild/<id>/module` öffnen und prüfen:
- Über den Modul-Einträgen der Leiste stehen Überschriften in Großbuchstaben.
- Ein frischer Server zeigt „Übersicht", „Module" und — weil `gallery` fest ist — die Überschrift „Inhalte & Meldungen" mit „Gallery System".
- Ein Modul einschalten lässt seine Überschrift erscheinen, ausschalten lässt sie wieder verschwinden, sofern kein anderes Modul der Gruppe an ist.
- Der Schalter der Galerie-Kachel ist an und nicht bedienbar, darunter steht „Immer an – dieses Modul gehört fest dazu."
- Die Kacheln unter „Module" stehen weiterhin flach ohne Überschriften.

- [ ] **Step 7: Prüfung laufen lassen**

```bash
npm run check:dashboard -- --dev
```

Erwartet: alle Prüfungen `ok`, Exit-Code 0.

---

### Task 3: Galerie als festes Modul im Bot

**Files:**
- Modify: `src/constants/Modules.ts`
- Modify: `src/models/GuildSettings.ts:44-114`
- Modify: `src/routes/DashboardApiModules.ts:45-53`
- Modify: `src/scripts/CheckDashboard.ts:606-611`

**Interfaces:**
- Consumes: `ModuleId`, `IsModule` aus `src/constants/Modules.ts`.
- Produces: `PERMANENT_MODULES: Set<ModuleId>`, `IsPermanent(value: unknown): value is ModuleId`. Teil 5 des Specs (`/module aus`) nutzt beides.

- [ ] **Step 1: Prüfung zuerst — Ablehnung erwarten**

In `src/scripts/CheckDashboard.ts` hinter dem Check `Modul-Schalter weist unbekannte Module ab` (Zeile ~611) einfügen:

```ts
    // Die Galerie gehoert fest dazu. Der Schalter muss vor Datenbank und Discord
    // abweisen, sonst haengt die Antwort an Dingen, die der Check nicht hat.
    const festesAus = await fetch(modulesApi, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "application/json" },
        body: JSON.stringify({ module: "gallery", on: false }),
    });
    check("Festes Modul laesst sich nicht ausschalten", festesAus.status === 400, `${festesAus.status}`);
```

- [ ] **Step 2: Prüfung laufen lassen, Fehlschlag bestätigen**

```bash
npm run check:dashboard -- --dev
```

Erwartet: `FAIL Festes Modul laesst sich nicht ausschalten → 503` (ohne Datenbank meldet die Route heute 503). Exit-Code 1.

- [ ] **Step 3: `PERMANENT_MODULES` anlegen**

An das Ende von `src/constants/Modules.ts` anhängen:

```ts
/**
 * Module, die zum Bot gehoeren und sich nicht abschalten lassen. Sie stehen
 * trotzdem in MODULE_IDS: das Dashboard zeigt ihre Kachel, nur gesperrt.
 *
 * GuildSettings.Of() mischt sie in jede Modulliste - damit muss keine andere
 * Stelle davon wissen. Die Schalter-Route weist ein Ausschalten zusaetzlich mit
 * 400 ab, damit die Antwort erklaert, was passiert ist.
 */
export const PERMANENT_MODULES = new Set<ModuleId>(["gallery"]);

export function IsPermanent(value: unknown): value is ModuleId {
    return IsModule(value) && PERMANENT_MODULES.has(value);
}
```

- [ ] **Step 4: Route weist das Ausschalten ab**

In `src/routes/DashboardApiModules.ts` den Import erweitern:

```ts
import { IsModule, IsPermanent } from "../constants/Modules";
```

Und direkt hinter der `IsModule`-Prüfung (vor der Datenbank-Prüfung) einfügen:

```ts
        // Vor der Datenbank: die Antwort haengt nicht daran, ob eine erreichbar
        // ist - das Modul laesst sich so oder so nicht ausschalten.
        if (!on && IsPermanent(moduleId)) {
            return reply.code(400).send({
                error: "Dieses Modul lässt sich nicht ausschalten.",
                hint: "Die Galerie gehört fest zum Bot.",
            });
        }
```

- [ ] **Step 5: Prüfung laufen lassen, Erfolg bestätigen**

```bash
npm run check:dashboard -- --dev
```

Erwartet: `ok Festes Modul laesst sich nicht ausschalten`, Exit-Code 0.

- [ ] **Step 6: Feste Module in jede Modulliste mischen**

In `src/models/GuildSettings.ts` den Import ergänzen:

```ts
import { ModuleId, PERMANENT_MODULES } from "../constants/Modules";
```

Eine Hilfsfunktion neben `Unpack` stellen:

```ts
// Feste Module stehen in jeder Liste, egal was in der Spalte steht: so muss
// keine aufrufende Stelle wissen, dass es sie gibt.
function WithPermanent(modules: string[]): string[] {
    const all = new Set(modules);

    for (const id of PERMANENT_MODULES) all.add(id);

    return [...all].sort();
}
```

`DEFAULT_SETTINGS` bleibt unveraendert (`modules: []`) — `Of()` fuellt auf. In `Of()` beide Rueckgabewege anfassen:

```ts
    async Of(guildId: string): Promise<IGuildSettings> {
        const row = await this.Find(guildId);

        if (!row) return { guildId, ...DEFAULT_SETTINGS, modules: WithPermanent([]) };

        return {
            guildId: row.guild_id,
            modules: WithPermanent(Unpack<string[]>(row.modules, [])),
            rankRoles: Unpack<Record<string, string>>(row.rank_roles, {}),
            matchChannel: row.match_channel,
            queueChannel: row.queue_channel,
        };
    }
```

In `Toggle()` das Ausschalten eines festen Moduls verweigern:

```ts
    /** Ein Modul an- oder abschalten, ohne den Rest anzufassen. */
    async Toggle(guildId: string, module: string, on: boolean): Promise<string[]> {
        const settings = await this.Of(guildId);
        const modules = new Set(settings.modules);

        // Ein festes Modul bliebe ohnehin in jeder Liste - hier stehen zu
        // bleiben haelt auch die Spalte ehrlich.
        if (on) modules.add(module);
        else if (!PERMANENT_MODULES.has(module as ModuleId)) modules.delete(module);

        const next = [...modules].sort();

        await this.Save({ ...settings, modules: next });

        return next;
    }
```

In `ModulesOf()` die Schleife am Ende anpassen, damit auch die Serverkarten die Galerie kennen:

```ts
        for (const row of rows) found.set(row.guild_id, WithPermanent(Unpack<string[]>(row.modules, [])));
```

- [ ] **Step 7: Typen prüfen und alles durchlaufen lassen**

```bash
npm run typecheck && npm run check:dashboard -- --dev
```

Erwartet: beides ohne Fehler, Exit-Code 0.

Mit laufender Datenbank zusätzlich `npm run dev` starten, einen Server öffnen und prüfen: „Gallery System" steht in der Leiste, auch wenn es nie eingeschaltet wurde.

---

# Teil 2 — Galerie im Dashboard

### Task 4: `Shrink()` — verkleinern und neu kodieren

**Files:**
- Create: `src/utils/image.ts`
- Create: `src/scripts/CheckImage.ts`
- Modify: `src/constants/Gallery.ts`
- Modify: `package.json:26` (Skript-Block)

**Interfaces:**
- Produces:
  - `Shrink(buffer: Buffer, mime: string): Promise<{ buffer: Buffer; extension: string }>`
  - `MAX_IMAGE_BYTES: number` (8388608) und `UPLOAD_TYPES: string[]` aus `src/constants/Gallery.ts`

- [ ] **Step 1: Grenzwerte in die Konstanten holen**

In `src/constants/Gallery.ts` hinter `IMAGE_TYPES` einfügen:

```ts
/**
 * Die Obergrenze fuer ein Bild - fuer den Download aus dem Netz wie fuer den
 * Upload aus dem Dashboard. Die Zahl steht hier und nur hier.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Die Typen, die ein Upload tragen darf - ohne Dubletten. */
export const UPLOAD_TYPES = [...new Set(Object.values(IMAGE_TYPES))];
```

- [ ] **Step 2: Prüfung zuerst — `CheckImage.ts` schreiben**

Neue Datei `src/scripts/CheckImage.ts`:

```ts
/**
 * Prueft das Verkleinern von Bildern: Kantenlaenge, Format, GIF-Durchlass und
 * das Verhalten bei Muell.
 *
 *   npm run check:image
 *
 * Absichtlich ohne Test-Framework - der Bot hat keins, und ein Durchlauf reicht,
 * um die Regeln aus dem Spec abzusichern.
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Shrink } from "../utils/image";

let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
    if (!passed) failures++;

    console.log(`  ${passed ? "ok  " : "FAIL"} ${name}${passed || !detail ? "" : `  → ${detail}`}`);
}

// Ein breites Bild mit Farbverlauf: einfarbige Flaechen komprimiert WebP so
// stark, dass ein Groessenvergleich nichts mehr aussagt.
function Sample(width: number, height: number): Buffer {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, width, height);

    gradient.addColorStop(0, "#ff1e2d");
    gradient.addColorStop(1, "#101418");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    return canvas.toBuffer("image/png");
}

// Das kleinstmoegliche gueltige GIF (1x1, transparent).
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

async function main(): Promise<void> {
    console.log("\n🖼️  Bild-Verkleinerung\n");

    const big = Sample(3000, 1000);
    const shrunk = await Shrink(big, "image/png");
    const back = await loadImage(shrunk.buffer);

    check("Lange Kante landet auf 1920px", back.width === 1920, `${back.width}px`);
    check("Seitenverhaeltnis bleibt", back.height === 640, `${back.height}px`);
    check("Ergebnis ist WebP", shrunk.extension === ".webp", shrunk.extension);
    check(
        "Ergebnis ist kleiner als das Original",
        shrunk.buffer.length < big.length,
        `${big.length} → ${shrunk.buffer.length}`
    );

    const small = Sample(200, 100);
    const kept = await Shrink(small, "image/png");
    const keptBack = await loadImage(kept.buffer);

    check("Kleines Bild wird nicht hochskaliert", keptBack.width === 200, `${keptBack.width}px`);

    const gif = await Shrink(GIF, "image/gif");

    check("GIF bleibt unveraendert", gif.buffer.equals(GIF) && gif.extension === ".gif", gif.extension);

    const broken = await Shrink(Buffer.from("kein bild"), "image/png").then(
        () => "kein Fehler",
        (error: Error) => error.message
    );

    check("Muell wird mit lesbarem Text abgelehnt", broken === "Das Bild ließ sich nicht lesen.", broken);

    console.log(failures === 0 ? "\n✅ Alle Prüfungen bestanden.\n" : `\n❌ ${failures} Prüfung(en) fehlgeschlagen.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

void main();
```

In `package.json` den Skript-Block um eine Zeile ergänzen, alphabetisch hinter `check:dashboard`:

```json
        "check:image": "tsx src/scripts/CheckImage.ts",
```

- [ ] **Step 3: Prüfung laufen lassen, Fehlschlag bestätigen**

```bash
npm run check:image
```

Erwartet: Abbruch mit `Cannot find module '../utils/image'` — die Datei gibt es noch nicht.

- [ ] **Step 4: `Shrink()` schreiben**

Neue Datei `src/utils/image.ts`:

```ts
import { createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * Bringt ein Bild auf eine Groesse, mit der Discord und die Platte gut leben.
 *
 * Alles laeuft hier durch, was im Bildverzeichnis landet - der Upload aus dem
 * Dashboard genauso wie der Download aus dem Galerie-Panel. Eine Stelle, eine
 * Regel.
 *
 * Animierte GIFs gehen unveraendert durch: ein Canvas-Durchlauf behielte nur
 * das erste Bild, und eine stehende Animation waere schlechter als ein paar
 * Kilobyte mehr.
 */

const MAX_EDGE = 1920;
const QUALITY = 80;

export async function Shrink(buffer: Buffer, mime: string): Promise<{ buffer: Buffer; extension: string }> {
    if (mime === "image/gif") return { buffer, extension: ".gif" };

    const image = await loadImage(buffer).catch(() => null);

    if (!image) throw new Error("Das Bild ließ sich nicht lesen.");

    // Nur verkleinern, nie vergroessern: ein 200px-Logo auf 1920px gezogen
    // waere groesser und unschaerfer zugleich.
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = createCanvas(width, height);

    canvas.getContext("2d").drawImage(image, 0, 0, width, height);

    return { buffer: await canvas.encode("webp", QUALITY), extension: ".webp" };
}
```

- [ ] **Step 5: Prüfung laufen lassen, Erfolg bestätigen**

```bash
npm run check:image
```

Erwartet: sechs Zeilen `ok`, `✅ Alle Prüfungen bestanden.`, Exit-Code 0.

- [ ] **Step 6: Typen prüfen**

```bash
npm run typecheck
```

Erwartet: keine Ausgabe, Exit-Code 0.

---

### Task 5: Ein Weg ins Bildverzeichnis

**Files:**
- Modify: `src/services/GalleryService.ts:1-35` (Importe), `:120-170` (`AddImage`)
- Modify: `src/interfaces/services/gallery/IGalleryService.ts:50`

**Interfaces:**
- Consumes: `Shrink`, `MAX_IMAGE_BYTES`, `UPLOAD_TYPES` aus Task 4.
- Produces: `AddUpload(target: IGalleryTarget, buffer: Buffer, mime: string, fileName: string): Promise<IGalleryEntry>` — Task 8 ruft es auf.

- [ ] **Step 1: Vertrag erweitern**

In `src/interfaces/services/gallery/IGalleryService.ts` unter `AddImage` einfügen:

```ts
    AddUpload(target: IGalleryTarget, buffer: Buffer, mime: string, fileName: string): Promise<IGalleryEntry>;
```

- [ ] **Step 2: Importe in `GalleryService.ts` anpassen**

Die Datei streamt heute auf die Platte. Für das Verkleinern müssen die Bytes im Speicher liegen — 8 MB, das trägt der Prozess.

Kopfzeilen ersetzen:

```ts
import path from "path";
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import axios from "axios";
import { AttachmentBuilder } from "discord.js";
import BotClient from "../client/BotClient";
import IGalleryImage from "../interfaces/services/gallery/IGalleryImage";
import IGalleryService, {
    IAttachedMedia,
    ICategoryEntry,
    IGalleryEntry,
    IGalleryFolder,
    IGalleryTarget,
    IListOptions,
} from "../interfaces/services/gallery/IGalleryService";
import {
    DEFAULT_SCOPE,
    GALLERY_ROOT,
    IMAGE_TYPES,
    IsImageFile,
    IsScope,
    MAX_IMAGE_BYTES,
    ParseSource,
    PRIVATE_SCOPE,
    SanitizeName,
} from "../constants/Gallery";
import { Shrink } from "../utils/image";
import logger from "../utils/logger";

const DOWNLOAD_TIMEOUT = 15_000;
const EXTENSION_BY_MIME = new Map<string, string>();
for (const [extension, mime] of Object.entries(IMAGE_TYPES)) {
    if (!EXTENSION_BY_MIME.has(mime)) EXTENSION_BY_MIME.set(mime, extension);
}
```

Entfallen sind `createWriteStream`, `pipeline`, `Readable` und die Konstante `MAX_DOWNLOAD_BYTES` — sie steht jetzt als `MAX_IMAGE_BYTES` in den Konstanten. `unlink` bleibt, `DeleteImage` braucht es.

- [ ] **Step 3: `AddImage` ersetzen und `Store` sowie `AddUpload` danebenstellen**

Die gesamte Methode `AddImage` (von `async AddImage(` bis zur schließenden Klammer vor `async MoveImage`) durch diesen Block ersetzen:

```ts
    async AddImage(target: IGalleryTarget, url: string, fileName?: string): Promise<IGalleryEntry> {
        const source = ParseSource(url);

        const response = await axios.get<ArrayBuffer>(source.href, {
            responseType: "arraybuffer",
            timeout: DOWNLOAD_TIMEOUT,
            maxRedirects: 3,
            maxContentLength: MAX_IMAGE_BYTES,
            validateStatus: (status) => status === 200,
        });

        const mime = String(response.headers["content-type"] ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();

        if (!EXTENSION_BY_MIME.has(mime)) throw new Error(`Nicht unterstützter Dateityp: ${mime || "unbekannt"}`);

        return this.Store(target, Buffer.from(response.data), mime, fileName ?? path.basename(source.pathname));
    }

    async AddUpload(
        target: IGalleryTarget,
        buffer: Buffer,
        mime: string,
        fileName: string
    ): Promise<IGalleryEntry> {
        if (buffer.length > MAX_IMAGE_BYTES) {
            throw new Error(`Bild ist größer als ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
        }

        if (!EXTENSION_BY_MIME.has(mime)) throw new Error(`Nicht unterstützter Dateityp: ${mime || "unbekannt"}`);

        return this.Store(target, buffer, mime, fileName);
    }

    // Der einzige Weg, auf dem ein Bild ins Verzeichnis kommt - aus dem Netz wie
    // aus dem Dashboard. Deshalb steht das Verkleinern hier und nirgends sonst.
    private async Store(
        target: IGalleryTarget,
        buffer: Buffer,
        mime: string,
        wanted: string
    ): Promise<IGalleryEntry> {
        const { guildId, category, subcategory } = this.Normalize(target);

        if (!guildId || guildId === DEFAULT_SCOPE) throw new Error("Der Default-Scope kann nicht befüllt werden.");
        if (!category) throw new Error("Es wurde keine gültige Kategorie angegeben.");

        const shrunk = await Shrink(buffer, mime);
        const stem = SanitizeName(path.parse(wanted).name) || `image-${Date.now()}`;

        const directory = this.DirectoryFor(guildId, category, subcategory);
        await mkdir(directory, { recursive: true });

        // Zwei Uploads mit demselben Namen sind kein Fehler des Nutzers. Ohne
        // diese Schleife ueberschriebe der zweite den ersten, stumm.
        let file = `${stem}${shrunk.extension}`;
        let attempt = 2;

        while (await this.Exists(path.join(directory, file))) file = `${stem}-${attempt++}${shrunk.extension}`;

        await writeFile(path.join(directory, file), shrunk.buffer);

        logger.info(
            `⬇️  Bild "${file}" in ${guildId}/${category} gespeichert (${Math.round(shrunk.buffer.length / 1024)} KB)`
        );

        return this.ToEntry({ guildId, category, subcategory, file });
    }
```

- [ ] **Step 4: Typen prüfen**

```bash
npm run typecheck
```

Erwartet: keine Ausgabe, Exit-Code 0. Meldet der Compiler einen ungenutzten Import (`noUnusedLocals` ist an), den entsprechenden Eintrag aus Step 2 streichen.

- [ ] **Step 5: Im Discord-Panel gegenprüfen**

`npm run dev` starten, in Discord `/gallery` ausführen, eine Kategorie anlegen und ein großes PNG per URL hinzufügen.

Erwartet: das Log zeigt `⬇️ Bild "…​.webp" in …​ gespeichert (NN KB)`, die Datei unter `src/images/<guildId>/<kategorie>/` endet auf `.webp` und ist deutlich kleiner als die Quelle. Ein zweiter Upload desselben Namens legt `name-2.webp` an, statt zu überschreiben.

---

### Task 6: Rohe Bilder im Body annehmen

**Files:**
- Modify: `src/Server.ts:78`

**Interfaces:**
- Consumes: `MAX_IMAGE_BYTES`, `UPLOAD_TYPES` aus Task 4.
- Produces: `request.body` ist bei `Content-Type: image/*` ein `Buffer`. Task 8 verlässt sich darauf.

- [ ] **Step 1: Import ergänzen**

Am Kopf von `src/Server.ts` einfügen:

```ts
import { MAX_IMAGE_BYTES, UPLOAD_TYPES } from "./constants/Gallery";
```

- [ ] **Step 2: Parser registrieren**

In `Start()` direkt hinter `const instance = fastify({ logger: false, ignoreTrailingSlash: true });` einfügen:

```ts
        // Bilder kommen roh: der Browser schickt die Datei als Body, Ziel und
        // Name stehen in der Adresse. Ein Multipart-Paket waere eine Dependency
        // fuer fuenf Zeilen.
        instance.addContentTypeParser(
            UPLOAD_TYPES,
            { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES },
            (_request, body, done) => done(null, body)
        );
```

- [ ] **Step 3: Typen prüfen**

```bash
npm run typecheck
```

Erwartet: keine Ausgabe, Exit-Code 0.

- [ ] **Step 4: Server startet weiterhin**

```bash
npm run check:dashboard -- --dev
```

Erwartet: alle Prüfungen `ok`, Exit-Code 0. Der Check startet denselben Server — startet er, greift der Parser.

---

### Task 7: Lese-Route für die Galerie

**Files:**
- Create: `src/routes/DashboardApiGallery.ts`
- Modify: `src/scripts/CheckDashboard.ts` (hinter dem Aktivitäts-Check, Zeile ~624)

**Interfaces:**
- Consumes: `SessionOf` (`src/utils/dashboard.ts`), `DashboardService.GuildsOf` über eine neue öffentliche Hilfe.
- Produces: `GET /api/guild/:id/gallery` → `{ categories: ICategoryEntry[]; images: IGalleryEntry[] }`. Task 9 liest davon, Teil 3 ebenfalls.

- [ ] **Step 1: Prüfung zuerst — Route ohne Sitzung ist 401**

In `src/scripts/CheckDashboard.ts` hinter dem Check `Aktivität ohne Sitzung ist 401` einfügen:

```ts
    const galerieApi = await fetch(`${BASE}${P}/api/guild/${id}/gallery`, MANUAL);
    check("Galerie ohne Sitzung ist 401", galerieApi.status === 401, `${galerieApi.status}`);
```

- [ ] **Step 2: Prüfung laufen lassen, Fehlschlag bestätigen**

```bash
npm run check:dashboard -- --dev
```

Erwartet: `FAIL Galerie ohne Sitzung ist 401 → 404` — die Route gibt es noch nicht.

- [ ] **Step 3: Berechtigungsprüfung im `DashboardService` öffnen**

`GuildsOf` ist privat. Beide Galerie-Routen brauchen dieselbe Prüfung wie `SetModule`. In `src/services/DashboardService.ts` neben `SetModule` einfügen:

```ts
    /**
     * Darf diese Sitzung den Server verwalten? Dieselbe Frage, die SetModule
     * stellt - die Galerie-Routen stellen sie auch, und sie soll an genau einer
     * Stelle beantwortet werden. Wirft SessionExpired.
     */
    async CanManage(session: IDashboardSession, guildId: string): Promise<boolean> {
        const guild = (await this.GuildsOf(session)).find((entry) => entry.id === guildId);

        return Boolean(guild?.canManage);
    }
```

- [ ] **Step 4: Route schreiben**

Neue Datei `src/routes/DashboardApiGallery.ts`:

```ts
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { SessionOf } from "../utils/dashboard";

/**
 * Was in der Galerie eines Servers liegt: seine Kategorien samt Unterordnern und
 * die Bilder darin. Die Default-Bilder kommen mit, damit die Bildauswahl auch
 * ohne eigene Uploads etwas zu zeigen hat.
 */
export default class DashboardApiGallery extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/guild/:id/gallery`,
            description: "Liefert Kategorien und Bilder der Galerie eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 120, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id?: string };

        if (!id || !SNOWFLAKE.test(id)) return reply.code(404).send({ error: "Not Found" });

        try {
            if (!(await service.CanManage(session, id))) {
                return reply.code(403).send({ error: "Forbidden", hint: "Nur wer den Server verwalten darf." });
            }
        } catch (error) {
            if (!(error instanceof SessionExpired)) throw error;

            return reply
                .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
                .code(401)
                .send({ error: "Unauthorized" });
        }

        const gallery = this.client.galleryService;
        const scopes = [id, "default"];
        const categories = (await Promise.all(scopes.map((scope) => gallery.GetCategories(scope)))).flat();

        // Unterordner stehen gleichberechtigt in derselben Liste; ihr Feld
        // "parent" sagt, wohin sie gehoeren.
        const nested = (
            await Promise.all(
                categories.map((entry) => gallery.GetSubcategories(entry.guildId, entry.name))
            )
        ).flat();

        const folders = [...categories, ...nested];

        const images = (
            await Promise.all(
                folders.map((entry) =>
                    gallery.GetImages({
                        guildId: entry.guildId,
                        category: entry.parent ?? entry.name,
                        subcategory: entry.parent ? entry.name : null,
                    })
                )
            )
        ).flat();

        return reply.header("Cache-Control", "no-store").send({ categories: folders, images });
    }
}
```

- [ ] **Step 5: Prüfung laufen lassen, Erfolg bestätigen**

```bash
npm run typecheck && npm run check:dashboard -- --dev
```

Erwartet: `ok Galerie ohne Sitzung ist 401`, Exit-Code 0.

Sollte `this.client.galleryService` einen Typfehler werfen, den tatsächlichen Feldnamen aus `src/client/BotClient.ts` übernehmen (dort steht, wie der Dienst am Client hängt).

---

### Task 8: Schreib-Route für die Galerie

**Files:**
- Create: `src/routes/DashboardApiGalleryEdit.ts`
- Modify: `src/scripts/CheckDashboard.ts` (hinter dem Check aus Task 7)

**Interfaces:**
- Consumes: `AddUpload` (Task 5), Buffer-Body (Task 6), `CanManage` (Task 7).
- Produces: `POST /api/guild/:id/gallery/*` mit sechs Aktionen. Task 9 ruft sie auf, Teil 3 ebenfalls.

Sechs Aktionen unter einem Pfad statt sechs Dateien: die Rechteprüfung steht damit einmal da statt sechsmal, und die Galerie-ID enthält Schrägstriche (`<guild>/<kategorie>/<datei>`) und passt deshalb ohnehin in keinen Pfad-Parameter.

| `*` | Body | Wirkung |
|---|---|---|
| `category` | `{ category, subcategory? }` | anlegen |
| `category/delete` | `{ category, subcategory? }` | löschen |
| `image` | rohe Bytes, Query `?category=&subcategory=&name=` | hochladen |
| `image/url` | `{ url, category, subcategory? }` | von https holen |
| `image/move` | `{ image, category, subcategory? }` | verschieben |
| `image/delete` | `{ image }` | löschen |

- [ ] **Step 1: Prüfung zuerst**

In `src/scripts/CheckDashboard.ts` hinter dem Galerie-Check aus Task 7 einfügen:

```ts
    const galerieSchreiben = `${BASE}${P}/api/guild/${id}/gallery/image/delete`;

    const galerieOhneSitzung = await fetch(galerieSchreiben, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: `${id}/test/bild.webp` }),
    });
    check("Galerie-Schreiben ohne Sitzung ist 401", galerieOhneSitzung.status === 401, `${galerieOhneSitzung.status}`);

    const galerieErfunden = await fetch(`${BASE}${P}/api/guild/${id}/gallery/gibt-es-nicht`, {
        method: "POST",
        headers: { ...mitSitzung, "Content-Type": "application/json" },
        body: "{}",
    });
    check("Galerie weist unbekannte Aktionen ab", galerieErfunden.status === 400, `${galerieErfunden.status}`);
```

- [ ] **Step 2: Prüfung laufen lassen, Fehlschlag bestätigen**

```bash
npm run check:dashboard -- --dev
```

Erwartet: beide neuen Zeilen `FAIL` mit `404`.

- [ ] **Step 3: Route schreiben**

Neue Datei `src/routes/DashboardApiGalleryEdit.ts`:

```ts
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { UPLOAD_TYPES } from "../constants/Gallery";
import { SessionOf } from "../utils/dashboard";
import logger from "../utils/logger";

interface IBody {
    category?: unknown;
    subcategory?: unknown;
    image?: unknown;
    url?: unknown;
}

function Text(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Alles, was die Galerie eines Servers veraendert - sechs Aktionen unter einem
 * Pfad. Die Rechtepruefung steht damit einmal da statt sechsmal, und die
 * Galerie-ID mit ihren Schraegstrichen passt in keinen Pfad-Parameter.
 */
export default class DashboardApiGalleryEdit extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "POST",
            path: `${DASHBOARD_PATH}/api/guild/:id/gallery/*`,
            description: "Legt an, laedt hoch, verschiebt und loescht in der Galerie eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id?: string };

        if (!id || !SNOWFLAKE.test(id)) return reply.code(404).send({ error: "Not Found" });

        const action = (request.params as { "*"?: string })["*"] ?? "";

        try {
            if (!(await service.CanManage(session, id))) {
                return reply.code(403).send({ error: "Forbidden", hint: "Nur wer den Server verwalten darf." });
            }
        } catch (error) {
            if (!(error instanceof SessionExpired)) throw error;

            return reply
                .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
                .code(401)
                .send({ error: "Unauthorized" });
        }

        try {
            const result = await this.Run(id, action, request);

            if (result === null) return reply.code(400).send({ error: "Unbekannte Aktion oder fehlende Angaben." });

            logger.user(`🖼️  Galerie ${action} auf ${id} (von ${session.userId})`);

            return reply.header("Cache-Control", "no-store").send({ ok: true, ...result });
        } catch (error) {
            // Was der Dienst ablehnt, ist eine Angabe des Nutzers - kein Ausfall.
            return reply.code(400).send({ error: error instanceof Error ? error.message : "Das ging nicht." });
        }
    }

    private async Run(
        guildId: string,
        action: string,
        request: FastifyRequest
    ): Promise<Record<string, unknown> | null> {
        const gallery = this.client.galleryService;
        const body = (typeof request.body === "object" && !Buffer.isBuffer(request.body)
            ? request.body ?? {}
            : {}) as IBody;

        const category = Text(body.category);
        const subcategory = Text(body.subcategory);

        if (action === "category") {
            if (!category) return null;

            return { created: await gallery.CreateCategory({ guildId, category, subcategory }) };
        }

        if (action === "category/delete") {
            if (!category) return null;

            return { removed: await gallery.DeleteCategory({ guildId, category, subcategory }) };
        }

        if (action === "image") {
            const mime = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();

            if (!Buffer.isBuffer(request.body) || !UPLOAD_TYPES.includes(mime)) return null;

            const query = request.query as { category?: string; subcategory?: string; name?: string };
            const target = Text(query.category);

            if (!target) return null;

            return {
                image: await gallery.AddUpload(
                    { guildId, category: target, subcategory: Text(query.subcategory) },
                    request.body,
                    mime,
                    Text(query.name) ?? "bild"
                ),
            };
        }

        if (action === "image/url") {
            const url = Text(body.url);

            if (!url || !category) return null;

            return { image: await gallery.AddImage({ guildId, category, subcategory }, url) };
        }

        if (action === "image/move") {
            const image = Text(body.image);

            // Nur in der eigenen Galerie: eine ID aus einem fremden Server waere
            // ein Griff in dessen Verzeichnis.
            if (!image || !category || !image.startsWith(`${guildId}/`)) return null;

            return { moved: await gallery.MoveImage(image, { category, subcategory }) };
        }

        if (action === "image/delete") {
            const image = Text(body.image);

            if (!image || !image.startsWith(`${guildId}/`)) return null;

            return { removed: await gallery.DeleteImage(image) };
        }

        return null;
    }
}
```

- [ ] **Step 4: Prüfung laufen lassen, Erfolg bestätigen**

```bash
npm run typecheck && npm run check:dashboard -- --dev
```

Erwartet: beide neuen Zeilen `ok`, Exit-Code 0.

---

### Task 9: Die Galerie-Seite im Dashboard

**Files:**
- Modify: `src/dashboard/public/guild.html` (neue Sektion vor `</div>` von `#moduleCards`)
- Create: `src/dashboard/client/pages/GuildGallery.ts`
- Modify: `src/dashboard/client/pages/Guild.ts` (Aufruf in `renderGuild`)
- Modify: `src/dashboard/public/assets/style.css` (ans Ende)

**Interfaces:**
- Consumes: `GET /api/guild/:id/gallery` (Task 7), `POST /api/guild/:id/gallery/*` (Task 8), `card()`-Hook (Task 2).
- Produces: `renderGallery(guildId: string, canManage: boolean): void` — von `renderGuild` gerufen.

- [ ] **Step 1: Sektion in `guild.html`**

In `src/dashboard/public/guild.html` innerhalb von `<div class="setcards" id="moduleCards">`, hinter der Sektion `#uebersicht`, einfügen:

```html
        <!-- Die Galerie. Sie steht fest im HTML statt als Platzkarte aus dem
             Template: das Modul ist gebaut, und card() in Guild.ts ueberspringt
             jede Sektion, die es schon gibt. -->
        <section class="setcard" id="gallery" hidden>
          <h2 class="modhead"><svg><use href="#i-image"/></svg>Gallery System</h2>
          <p class="modlead">Logos, Grafiken und Vorlagen in Alben sortieren. Was hier liegt, steht in Discord unter <code>/gallery</code> und später im Nachrichten-Editor zur Auswahl.</p>

          <div class="notice galnote" id="galNote" hidden>
            <svg><use href="#i-warn"/></svg>
            <span></span>
          </div>

          <div class="galbar">
            <select id="galFolder" aria-label="Album"></select>
            <input id="galName" type="text" maxlength="32" placeholder="Neues Album…" aria-label="Name des neuen Albums">
            <button class="btn" id="galNew" type="button"><svg><use href="#i-plus"/></svg>Anlegen</button>
            <button class="btn" id="galUpload" type="button"><svg><use href="#i-image"/></svg>Bild hochladen</button>
            <input id="galFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
          </div>

          <div class="galgrid" id="galGrid"></div>
          <p class="galempty" id="galEmpty" hidden>In diesem Album liegt noch kein Bild.</p>
        </section>
```

- [ ] **Step 2: CSS ans Ende von `style.css`**

```css
/* ----------------------------------------------------------
   Galerie

   Ein Raster aus Kacheln, darueber die Auswahl des Albums. Die Kacheln sind
   quadratisch, damit unterschiedliche Seitenverhaeltnisse die Zeilen nicht
   zerreissen; das Bild selbst bleibt vollstaendig sichtbar.
   ---------------------------------------------------------- */
.galbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 16px}
.galbar select,.galbar input[type="text"]{
  min-width:180px;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r-sm);
  background:var(--glass);color:var(--text);font-size:13px;
}
/* Loeschen in zwei Schritten: der erste Klick fragt, der zweite loescht. Ein
   window.confirm waere die einzige Systembox in einer sonst eigenen Oberflaeche. */
.galtile__bar button.is-sure{background:var(--brand);padding:4px 8px;font-size:11px}
.galgrid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}
.galtile{
  position:relative;aspect-ratio:1;border:1px solid var(--line);border-radius:var(--r-sm);
  background:var(--glass);overflow:hidden;
}
.galtile img{width:100%;height:100%;object-fit:contain}
.galtile__bar{
  position:absolute;inset:auto 0 0 0;display:flex;gap:4px;justify-content:flex-end;
  padding:6px;background:linear-gradient(transparent,rgba(0,0,0,.72));
  opacity:0;transition:opacity var(--t-fast) var(--ease);
}
.galtile:hover .galtile__bar,.galtile:focus-within .galtile__bar{opacity:1}
.galtile__bar button{
  display:flex;align-items:center;padding:4px;border-radius:var(--r-sm);
  background:rgba(0,0,0,.5);color:var(--text);
}
.galtile__bar button:hover{background:var(--brand)}
.galtile__bar svg{width:14px;height:14px}
.galempty{margin:24px 0;color:var(--text-3);font-size:13px;text-align:center}
```

- [ ] **Step 3: Die Seite schreiben**

Neue Datei `src/dashboard/client/pages/GuildGallery.ts`:

```ts
/** Abschnitt: Galerie eines Servers. */

import { icon, need } from "../core/Dom.js";
import { BASE } from "../core/Base.js";
import { clickSound } from "../core/Sound.js";

interface IFolder {
    guildId: string;
    name: string;
    parent: string | null;
    scope: "default" | "custom";
    images: number;
}

interface IImage {
    id: string;
    url: string;
    guildId: string;
    category: string;
    subcategory: string | null;
    file: string;
}

/** Ein Album ist eine Kategorie oder ein Unterordner - beides eine Zeile. */
function labelOf(folder: IFolder): string {
    const where = folder.scope === "default" ? "Vorlagen" : "Dein Server";

    return `${where} · ${folder.parent ? `${folder.parent}/${folder.name}` : folder.name}`;
}

function keyOf(folder: IFolder): string {
    return [folder.guildId, folder.parent ?? folder.name, folder.parent ? folder.name : ""].join("|");
}

export function renderGallery(guildId: string, canManage: boolean): void {
    const note = need<HTMLElement>("#galNote");
    const picker = need<HTMLSelectElement>("#galFolder");
    const grid = need<HTMLElement>("#galGrid");
    const empty = need<HTMLElement>("#galEmpty");
    const file = need<HTMLInputElement>("#galFile");
    const newButton = need<HTMLButtonElement>("#galNew");
    const name = need<HTMLInputElement>("#galName");
    const uploadButton = need<HTMLButtonElement>("#galUpload");

    let folders: IFolder[] = [];
    let images: IImage[] = [];

    newButton.disabled = !canManage;
    name.disabled = !canManage;
    uploadButton.disabled = !canManage;

    function warn(text: string | null): void {
        note.hidden = text === null;
        note.querySelector("span")!.textContent = text ?? "";
    }

    async function send(action: string, body: unknown): Promise<boolean> {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(body),
            });

            if (response.ok) return true;

            const data = (await response.json().catch(() => ({}))) as { error?: string };

            warn(data.error ?? `Der Bot hat abgelehnt (${response.status}).`);
        } catch {
            warn("Der Bot antwortet gerade nicht.");
        }

        return false;
    }

    async function load(): Promise<void> {
        try {
            const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery`, {
                headers: { Accept: "application/json" },
            });

            if (!response.ok) {
                warn("Die Galerie lässt sich gerade nicht laden.");
                return;
            }

            const data = (await response.json()) as { categories: IFolder[]; images: IImage[] };

            folders = data.categories;
            images = data.images;
            warn(null);
            paintPicker();
            paintGrid();
        } catch {
            warn("Der Bot antwortet gerade nicht.");
        }
    }

    function paintPicker(): void {
        const chosen = picker.value;

        picker.replaceChildren(
            ...folders.map((folder) => {
                const option = document.createElement("option");

                option.value = keyOf(folder);
                option.textContent = `${labelOf(folder)} (${folder.images})`;

                return option;
            })
        );

        // Nach dem Neuladen dasselbe Album wie vorher, sofern es das noch gibt.
        if (folders.some((folder) => keyOf(folder) === chosen)) picker.value = chosen;
    }

    function current(): { category: string; subcategory: string | null; own: boolean } | null {
        const folder = folders.find((entry) => keyOf(entry) === picker.value);

        if (!folder) return null;

        return {
            category: folder.parent ?? folder.name,
            subcategory: folder.parent ? folder.name : null,
            own: folder.scope === "custom",
        };
    }

    function paintGrid(): void {
        const here = current();
        const shown = here
            ? images.filter(
                  (image) => image.category === here.category && image.subcategory === here.subcategory
              )
            : [];

        grid.replaceChildren(...shown.map((image) => tile(image, Boolean(here?.own) && canManage)));
        empty.hidden = shown.length > 0;
    }

    function tile(image: IImage, editable: boolean): HTMLElement {
        const box = document.createElement("figure");

        box.className = "galtile";

        const picture = document.createElement("img");

        picture.src = image.url;
        picture.alt = image.file;
        picture.loading = "lazy";
        box.append(picture);

        if (!editable) return box;

        const bar = document.createElement("div");

        bar.className = "galtile__bar";

        const remove = document.createElement("button");

        remove.type = "button";
        remove.title = "Bild löschen";
        remove.append(icon("#i-x"));
        // Ein geloeschtes Bild ist weg - das darf keine Fingerbewegung sein.
        // Zwei Klicks statt einer Systembox: der erste fragt, der zweite loescht.
        let sure = false;

        remove.addEventListener("click", () => {
            clickSound("primary");

            if (!sure) {
                sure = true;
                remove.classList.add("is-sure");
                remove.replaceChildren(document.createTextNode("Wirklich?"));
                window.setTimeout(() => {
                    sure = false;
                    remove.classList.remove("is-sure");
                    remove.replaceChildren(icon("#i-x"));
                }, 4000);

                return;
            }

            void send("image/delete", { image: image.id }).then((ok) => ok && load());
        });

        bar.append(remove);
        box.append(bar);

        return box;
    }

    picker.addEventListener("change", paintGrid);

    function create(): void {
        const wanted = name.value.trim();

        if (!wanted) return;

        clickSound("primary");
        void send("category", { category: wanted }).then((ok) => {
            if (!ok) return;

            name.value = "";
            void load();
        });
    }

    newButton.addEventListener("click", create);
    name.addEventListener("keydown", (event) => {
        if (event.key === "Enter") create();
    });

    uploadButton.addEventListener("click", () => file.click());

    file.addEventListener("change", () => {
        const chosen = file.files?.[0];
        const here = current();

        file.value = "";

        if (!chosen) return;

        if (!here?.own) {
            warn("Vorlagen lassen sich nicht verändern – lege zuerst ein eigenes Album an.");
            return;
        }

        const query = new URLSearchParams({ category: here.category, name: chosen.name });

        if (here.subcategory) query.set("subcategory", here.subcategory);

        void (async () => {
            try {
                const response = await fetch(
                    `${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery/image?${query}`,
                    { method: "POST", headers: { "Content-Type": chosen.type }, body: chosen }
                );

                if (!response.ok) {
                    const data = (await response.json().catch(() => ({}))) as { error?: string };

                    warn(data.error ?? `Der Bot hat abgelehnt (${response.status}).`);
                    return;
                }

                warn(null);
                await load();
            } catch {
                warn("Der Bot antwortet gerade nicht.");
            }
        })();
    });

    void load();
}
```

- [ ] **Step 4: In `Guild.ts` aufrufen**

Import ergänzen:

```ts
import { renderGallery } from "./GuildGallery.js";
```

In `renderGuild`, direkt hinter `void renderOverview(guild, data.user.id, waiting.activity);`:

```ts
    renderGallery(guild.id, guild.canManage);
```

- [ ] **Step 5: Bauen und prüfen**

```bash
npm run build:dashboard && npm run typecheck && npm run check:dashboard -- --dev
```

Erwartet: alles ohne Fehler, Exit-Code 0.

Dann `npm run dev` starten und `/guild/<id>/gallery` öffnen:
- Die Auswahl zeigt „Vorlagen · …" und, sobald angelegt, „Dein Server · …".
- „Album anlegen" fragt nach dem Namen und die Auswahl wächst.
- „Bild hochladen" in einem eigenen Album legt das Bild ab; es erscheint im Raster und liegt als `.webp` unter `src/images/<guildId>/`.
- Ein Upload in ein Vorlagen-Album wird mit Hinweis abgelehnt.
- Das Löschen fragt nach und entfernt die Kachel.

---

## Nach dem Plan

Teil 3 (Message-Editor mit Live-Vorschau), Teil 4 (Ticket-Kern) und Teil 5
(Discord-Commands) aus dem Spec bekommen einen eigenen Plan, sobald dieser
abgearbeitet ist.

Der Bild-Picker (`src/dashboard/client/layout/ImagePicker.ts`, `pickImage()`)
gehört dorthin und nicht hierher: er hätte in Teil 2 keinen Aufrufer, und ein
Knopf, den nur der Test drückt, ist Code ohne Grund. Er entsteht in Teil 3
zusammen mit dem Editor, der ihn wirklich braucht — auf den Routen aus Task 7
und 8 und dem Raster (`.galgrid`, `.galtile`) aus Task 9, die beide dafür schon
stehen.
