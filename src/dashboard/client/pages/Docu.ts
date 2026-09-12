/** Das Inhaltsverzeichnis der Dokumentation. */

import { maybe } from "../core/Dom.js";

/**
 * Das Inhaltsverzeichnis der Doku markiert, wo man gerade liest.
 *
 * Springen tun die Anker von selbst - dafuer braucht es kein Skript. Was fehlt,
 * ist die Antwort auf "wo bin ich": auf einer langen Seite ist ein Verzeichnis
 * ohne diese Marke nur eine Liste von Links.
 *
 * Gerechnet wird ueber die Scrollposition, nicht ueber einen
 * IntersectionObserver. Der beobachtet Ueberschriften, und eine Ueberschrift ist
 * ein paar Zeilen hoch: zwischen zwei Abschnitten ist keine im Bild, und die
 * Marke faellt weg. Gesucht ist aber die letzte Ueberschrift oberhalb der
 * Lesekante - die gibt es immer.
 */
export function bindDocNav(): void {
    const nav = maybe<HTMLElement>("#docNav");

    if (!nav) return;

    const entries: { id: string; link: HTMLAnchorElement; head: HTMLElement }[] = [];

    for (const link of nav.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const href = link.getAttribute("href") ?? "";

        if (!href.startsWith("#")) continue;

        const head = document.getElementById(href.slice(1));

        if (head) entries.push({ id: href.slice(1), link, head });
    }

    if (entries.length === 0) return;

    function paint(): void {
        // Die Lesekante: knapp unter der Kopfzeile. Was darueber steht, ist
        // durch; der letzte durchgelaufene Abschnitt ist der, in dem man liest.
        const edge = 120;
        let current = entries[0] as (typeof entries)[number];

        for (const entry of entries) {
            if (entry.head.getBoundingClientRect().top <= edge) current = entry;
        }

        // Ganz unten gewinnt der letzte Abschnitt, auch wenn seine Ueberschrift
        // noch nicht ueber die Kante gewandert ist - weiter geht es nicht.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
            current = entries[entries.length - 1] as (typeof entries)[number];
        }

        for (const entry of entries) {
            if (entry === current) entry.link.setAttribute("aria-current", "true");
            else entry.link.removeAttribute("aria-current");
        }
    }

    // Direkt am Scroll-Ereignis, ohne requestAnimationFrame dazwischen: neun
    // getBoundingClientRect auf einer statischen Seite kosten nichts, und rAF
    // laeuft in einem Tab im Hintergrund gar nicht erst - dann bliebe die Marke
    // beim Zurueckwechseln auf dem falschen Abschnitt stehen.
    window.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", paint, { passive: true });

    paint();
}
