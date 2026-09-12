/**
 * Kopfzeile und Filterleiste bekommen erst beim Scrollen einen Grund. Oben
 * stehen beide durchsichtig auf dem Hintergrund, wie der Kopf der Webseite.
 */
import { maybe } from "../core/Dom.js";
export function watchScroll() {
    // Ueber die Klasse, nicht die id: Doku und Datenschutz tragen ihre Kopfzeile
    // ohne id und blieben sonst auch beim Scrollen durchsichtig.
    const topbar = maybe(".topbar");
    if (!topbar)
        return;
    // Nur die Serverliste hat eine Filterleiste. Angedockt ist sie, sobald sie
    // die Unterkante der Kopfzeile erreicht - das +1 faengt krumme Pixel bei
    // Browser-Zoom ab.
    const controls = maybe(".controls");
    const update = () => {
        topbar.classList.toggle("is-stuck", window.scrollY > 8);
        if (controls) {
            const docked = controls.getBoundingClientRect().top <= topbar.offsetHeight + 1;
            controls.classList.toggle("is-stuck", docked);
        }
    };
    window.addEventListener("scroll", update, { passive: true });
    update();
}
