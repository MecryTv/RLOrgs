/**
 * Frontend des RL Nexus-Dashboards. Wird nach public/assets/ gebaut:
 *   npm run build:dashboard      (einmalig)
 *   npm run dev:dashboard        (beobachtet Änderungen)
 *
 * Alle Daten kommen aus GET /api/me. Servernamen landen ausschließlich
 * über textContent im Dokument - nirgends wird HTML zusammengesetzt.
 *
 * Diese Datei ist nur noch der Einstieg: sie entscheidet anhand von
 * `<body data-page="...">`, welche Seite gezeichnet wird. Alles andere liegt
 * daneben:
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
import { bindDocNav } from "./pages/Docu.js";
import { renderServers, skeletons } from "./pages/Servers.js";
import { prefetchGuild, renderGuild } from "./pages/Guild.js";
import { renderTracking } from "./pages/Tracking.js";
import { renderSettings } from "./pages/Settings.js";
import { renderAdmin } from "./pages/Admin.js";
/**
 * Die Serverliste kam nicht. Der Grund steht in der Konsole, hier steht, was der
 * Nutzer tun kann.
 */
function failed() {
    const empty = maybe("#empty");
    const grid = maybe("#grid");
    if (grid)
        grid.replaceChildren();
    if (!empty)
        return;
    empty.classList.add("is-on", "empty--error");
    const symbol = maybe("#emptyIcon use");
    if (symbol)
        symbol.setAttribute("href", "#i-warn");
    need("#emptyTitle").textContent = "Serverliste nicht erreichbar";
    need("#emptyText").textContent =
        "Der Bot antwortet gerade nicht oder Discord hat die Anfrage gebremst. Lade die Seite in einem Moment neu.";
    const reset = maybe("#emptyReset");
    if (reset) {
        reset.textContent = "Neu laden";
        reset.addEventListener("click", () => window.location.reload());
    }
    const line = maybe("#resultline");
    if (line)
        line.textContent = "Laden fehlgeschlagen";
}
async function boot() {
    const page = document.body.dataset.page;
    watchScroll();
    applyMotion();
    bindFooter();
    // Datenschutz, Doku und die WTSI-Erklaerung stehen ohne Anmeldung offen: eine
    // Datenschutzerklaerung hinter einem Login waere keine. Sie brauchen vom
    // Skript nur Fusszeile, Cookie-Hinweis und das Inhaltsverzeichnis.
    if (page === "static") {
        bindDocNav();
        return;
    }
    if (page === "servers")
        skeletons(6);
    // Die Serverseite weiss aus ihrer Adresse schon, welcher Server gemeint ist:
    // ihre beiden Abfragen laufen deshalb neben /api/me statt danach.
    if (page === "guild")
        prefetchGuild();
    const data = await load();
    // Beim 401 läuft schon die Umleitung zum Login - dann keine Fehlermeldung zeigen.
    if (!data) {
        if (!redirecting())
            failed();
        return;
    }
    renderProfile(data.user);
    buildUserUI(data.user);
    // Das Postfach liegt beim Bot: einmal holen und danach im Hintergrund
    // nachsehen, damit man neue Meldungen auch ohne Neuladen mitbekommt.
    void pullNotes();
    window.setInterval(() => void pullNotes(), NOTES_POLL);
    if (page === "guild")
        renderGuild(data);
    else if (page === "admin")
        void renderAdmin();
    else if (page === "tracking")
        void renderTracking();
    else if (page === "settings")
        void renderSettings(data.user);
    else
        renderServers(data);
}
void boot();
