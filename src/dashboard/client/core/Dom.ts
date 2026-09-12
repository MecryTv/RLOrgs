/**
 * Die kleinen Handgriffe am Dokument.
 *
 * need() wirft, wenn ein Element fehlt: eine Seite, der ihr Geruest fehlt,
 * soll laut scheitern statt still halb zu funktionieren. maybe() ist der Weg
 * fuer alles, was es nur auf manchen Seiten gibt.
 */

export const SVG_NS = "http://www.w3.org/2000/svg";

/* ----------------------------------------------------------
   Kleine Helfer
   ---------------------------------------------------------- */
export function need<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);

    if (!element) throw new Error(`Element ${selector} fehlt im Dokument.`);

    return element;
}

export function maybe<T extends Element>(selector: string): T | null {
    return document.querySelector<T>(selector);
}

export function clone(id: string): HTMLElement {
    const template = need<HTMLTemplateElement>(id);
    const first = template.content.firstElementChild;

    if (!first) throw new Error(`Vorlage ${id} ist leer.`);

    return first.cloneNode(true) as HTMLElement;
}

export function icon(name: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    const use = document.createElementNS(SVG_NS, "use");

    use.setAttribute("href", name);
    svg.appendChild(use);

    return svg;
}

export function link(className: string, label: string, href: string, external = false): HTMLAnchorElement {
    const anchor = document.createElement("a");

    anchor.className = className;
    anchor.href = href;
    anchor.textContent = label;

    if (external) {
        anchor.target = "_blank";
        anchor.rel = "noopener";
    }

    return anchor;
}

export function ghost(symbol: string, label: string): HTMLButtonElement {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "btn btn--ghost";
    button.setAttribute("aria-label", label);
    button.appendChild(icon(symbol));

    return button;
}

// Kennt der Bot die Mitgliederliste, stehen Menschen und Bots getrennt da.
// Kennt er sie nicht, bleibt es bei der Gesamtzahl - eine geschätzte Aufteilung
// wäre erfunden.

export function picture(source: string, className: string): HTMLImageElement {
    const image = document.createElement("img");

    image.className = className;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    // Fehlt eine Datei, verschwindet nur das Bild - der Text daneben bleibt.
    image.addEventListener("error", () => image.remove());
    image.src = source;

    return image;
}
