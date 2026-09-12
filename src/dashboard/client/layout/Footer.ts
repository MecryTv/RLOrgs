/**
 * Fusszeile und Cookie-Hinweis.
 *
 * Beides haengt hier an jeder Seite, statt es in sechs HTML-Dateien zu pflegen.
 */

import { link, maybe } from "../core/Dom.js";
import { BASE } from "../core/Base.js";

/* ----------------------------------------------------------
   Fusszeile und Cookie-Hinweis

   Beides haengt app.ts an jede Seite an, statt es in vier HTML-Dateien zu
   pflegen. Die Seiten sind ohnehin leer, bis das Skript sie fuellt.
   ---------------------------------------------------------- */
export const FOOTER_HTML = `
<footer class="footer">
  <div class="shell footer__inner">
    <div class="footer__brand">
      <span class="footer__mark"><img src="${BASE}/assets/images/RL Nexus N Logo.png" alt="" width="26" height="26" decoding="async"></span>
      <span>
        <b>RL Nexus</b>
        <i>Rang-Tracking und Orga-Verwaltung für Rocket League</i>
      </span>
    </div>

    <nav class="footer__nav" id="footerNav" aria-label="Fußzeile">
      <a href="${BASE}/docu">Dokumentation</a>
      <a href="${BASE}/docu#wtsi">WTSI erklärt</a>
      <a href="${BASE}/privacy">Datenschutz</a>
      <a href="https://github.com/MecryTv/RLOrgs/issues" target="_blank" rel="noopener">Fehler melden</a>
    </nav>

    <p class="footer__note">
      Rocket League ist eine Marke von Psyonix LLC. RL Nexus steht nicht mit Psyonix oder Epic Games in Verbindung.
    </p>
  </div>
</footer>`;

// Ein Hinweis, keine Einwilligung: RL Nexus setzt ausschliesslich Cookies, die
// fuer die Anmeldung noetig sind - ohne sie gibt es keine Sitzung und damit
// keine Seite. Ein "Ablehnen" waere ein Knopf, der entweder nichts tut oder
// ausloggt; beides ist unehrlicher als der Hinweis selbst.
export const COOKIE_HTML = `
<div class="cookiebar" id="cookieBar" role="region" aria-label="Hinweis zu Cookies" hidden>
  <div class="cookiebar__inner">
    <span class="cookiebar__mark"><svg><use href="#i-shield"/></svg></span>
    <p class="cookiebar__text">
      RL Nexus setzt nur Cookies, die für die Anmeldung nötig sind — kein Tracking, keine Werbung,
      keine Weitergabe. Was gespeichert wird, steht im <a href="${BASE}/privacy">Datenschutz</a>.
    </p>
    <button class="btn btn--primary" type="button" id="cookieOk">Verstanden</button>
  </div>
</div>`;

export const COOKIE_KEY = "rlnexus.cookies";

export function bindFooter(): void {
    document.body.insertAdjacentHTML("beforeend", FOOTER_HTML + COOKIE_HTML);

    // Der Weg zurueck auf die Hauptseite. Die Adresse steht im Kopf der Seite -
    // sie kommt aus SITE_PUBLIC_URL in der .env und wird beim Ausliefern
    // eingesetzt (siehe utils/dashboard.ts). Fehlt sie, fehlt der Link.
    const site = maybe<HTMLMetaElement>('meta[name="rlnexus-site"]')?.content.trim();
    const nav = maybe<HTMLElement>("#footerNav");

    if (site && nav) nav.prepend(link("", "Webseite", site));

    const bar = maybe<HTMLElement>("#cookieBar");
    const ok = maybe<HTMLButtonElement>("#cookieOk");

    if (!bar || !ok) return;

    // Ein privates Fenster oder abgeschaltete Speicherung darf die Seite nicht
    // mitreissen - dann erscheint der Hinweis eben jedes Mal.
    let seen = false;

    try {
        seen = localStorage.getItem(COOKIE_KEY) === "1";
    } catch {
        seen = false;
    }

    bar.hidden = seen;

    ok.addEventListener("click", () => {
        bar.hidden = true;

        try {
            localStorage.setItem(COOKIE_KEY, "1");
        } catch {
            // Dann kommt der Hinweis beim naechsten Mal wieder. Kein Beinbruch.
        }
    });
}
