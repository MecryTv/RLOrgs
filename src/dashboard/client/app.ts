/**
 * Frontend des RL Nexus-Dashboards. Wird nach public/assets/ gebaut:
 *   npm run build:dashboard      (einmalig)
 *   npm run dev:dashboard        (beobachtet Änderungen)
 *
 * Alle Daten kommen aus GET /api/me. Servernamen landen ausschließlich
 * über textContent im Dokument - nirgends wird HTML zusammengesetzt.
 *
 * Diese Datei ist nur noch der Einstieg: sie entscheidet anhand von
 * `<body data-page="...">`, welche Seite gezeichnet wird, und lädt genau deren
 * Code nach (import()). Der Bündler (src/scripts/BuildDashboard.ts) macht
 * daraus je Seite ein eigenes Stück - wer die Serverliste öffnet, lädt den
 * Code der Serverseite nicht mit. Alles andere liegt daneben:
 *
 *   interfaces/   Was der Bot schickt - eine Datei je Bereich
 *   constants/    Gruppen, Ränge, Plattformen: Tabellen ohne Logik
 *   core/         Werkzeug für alle Seiten: DOM, Formate, Töne, Toasts, Abruf
 *   services/     Was mit dem Bot spricht: Postfach und Konto-Verknüpfung
 *   layout/       Was auf jeder Seite steht: Kopfzeile, Menü, Fußzeile
 *   pages/        Eine Datei je Seite
 */
import { maybe, need } from "./core/Dom.js";
import { load, redirecting } from "./core/Api.js";
import { applyMotion } from "./core/Prefs.js";
import { NOTES_POLL, pullNotes } from "./services/Notes.js";
import { bindFooter } from "./layout/Footer.js";
import { renderProfile } from "./layout/Profile.js";
import { buildUserUI } from "./layout/UserMenu.js";
import { watchScroll } from "./layout/Topbar.js";

/**
 * Die Serverliste kam nicht. Der Grund steht in der Konsole, hier steht, was der
 * Nutzer tun kann.
 */
function failed(): void {
    const empty = maybe<HTMLElement>("#empty");
    const grid = maybe<HTMLElement>("#grid");

    if (grid) grid.replaceChildren();
    if (!empty) return;

    empty.classList.add("is-on", "empty--error");

    const symbol = maybe<SVGUseElement>("#emptyIcon use");
    if (symbol) symbol.setAttribute("href", "#i-warn");

    need<HTMLElement>("#emptyTitle").textContent = "Serverliste nicht erreichbar";
    need<HTMLElement>("#emptyText").textContent =
        "Der Bot antwortet gerade nicht oder Discord hat die Anfrage gebremst. Lade die Seite in einem Moment neu.";

    const reset = maybe<HTMLButtonElement>("#emptyReset");
    if (reset) {
        reset.textContent = "Neu laden";
        reset.addEventListener("click", () => window.location.reload());
    }

    const line = maybe<HTMLElement>("#resultline");
    if (line) line.textContent = "Laden fehlgeschlagen";
}

async function boot(): Promise<void> {
    const page = document.body.dataset.page;

    watchScroll();
    applyMotion();
    bindFooter();

    // Datenschutz, Doku und die WTSI-Erklaerung stehen ohne Anmeldung offen: eine
    // Datenschutzerklaerung hinter einem Login waere keine. Sie brauchen vom
    // Skript nur Fusszeile, Cookie-Hinweis und das Inhaltsverzeichnis.
    if (page === "static") {
        (await import("./pages/Docu.js")).bindDocNav();
        return;
    }

    // Der Code der Seite lädt neben /api/me, nicht danach. Was er vorab tun kann,
    // hängt in derselben Kette - so läuft es sicher vor dem Zeichnen, nie doppelt.
    const code =
        page === "guild"
            ? import("./pages/Guild.js").then((module) => {
                  // Die Serverseite weiss aus ihrer Adresse schon, welcher Server gemeint
                  // ist: ihre beiden Abfragen laufen deshalb neben /api/me statt danach.
                  module.prefetchGuild();

                  return module;
              })
            : page === "admin"
              ? import("./pages/Admin.js")
              : page === "tracking"
                ? import("./pages/Tracking.js")
                : page === "settings"
                  ? import("./pages/Settings.js")
                  : import("./pages/Servers.js").then((module) => {
                        if (page === "servers") module.skeletons(6);

                        return module;
                    });

    const data = await load();

    // Beim 401 läuft schon die Umleitung zum Login - dann keine Fehlermeldung zeigen.
    if (!data) {
        if (!redirecting()) failed();
        return;
    }

    renderProfile(data.user);
    buildUserUI(data.user);

    // Das Postfach liegt beim Bot: einmal holen und danach im Hintergrund
    // nachsehen, damit man neue Meldungen auch ohne Neuladen mitbekommt.
    void pullNotes();
    window.setInterval(() => void pullNotes(), NOTES_POLL);

    const module = await code;

    if ("renderGuild" in module) module.renderGuild(data);
    else if ("renderAdmin" in module) void module.renderAdmin();
    else if ("renderTracking" in module) void module.renderTracking();
    else if ("renderSettings" in module) void module.renderSettings(data.user);
    else module.renderServers(data);
}

void boot();
