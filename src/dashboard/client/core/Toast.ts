/** Kurze Meldungen unten rechts. */

import { icon, maybe } from "./Dom.js";
import { prefs } from "./Prefs.js";

/* ----------------------------------------------------------
   Toasts
   ---------------------------------------------------------- */
export const TOAST_MAX = 3;

/**
 * Ein offener modaler Dialog liegt in der obersten Ebene des Browsers - alles
 * andere verschwindet dahinter, auch die Einblendungen. Deshalb ziehen sie zu
 * einem offenen Dialog um und danach wieder zurück.
 */
export function toastHost(): HTMLElement | null {
    const host = maybe<HTMLElement>("#toasts");

    if (!host) return null;

    const open = document.querySelector<HTMLDialogElement>("dialog[open]");
    const wanted: HTMLElement = open ?? document.body;

    if (host.parentElement !== wanted) wanted.appendChild(host);

    return host;
}

export function toast(kind: "info" | "invite", title: string, body: string): void {
    const host = toastHost();

    if (!host || !prefs.toasts) return;

    while (host.children.length >= TOAST_MAX && host.firstElementChild) host.firstElementChild.remove();

    const element = document.createElement("div");
    element.className = kind === "invite" ? "toast toast--invite" : "toast";

    const mark = document.createElement("span");
    mark.className = "toast__mark";
    mark.appendChild(icon(kind === "invite" ? "#i-plus" : "#i-check"));

    const text = document.createElement("div");
    const heading = document.createElement("b");
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = body;
    text.append(heading, paragraph);

    const close = document.createElement("button");
    close.className = "toast__x";
    close.setAttribute("aria-label", "Schließen");
    close.appendChild(icon("#i-x"));

    const bar = document.createElement("span");
    bar.className = "toast__bar";

    element.append(mark, text, close, bar);
    host.appendChild(element);

    const timer = window.setTimeout(dismiss, 3600);

    function dismiss(): void {
        window.clearTimeout(timer);
        element.classList.add("is-out");
        window.setTimeout(() => element.remove(), 220);
    }

    close.addEventListener("click", dismiss);
}
