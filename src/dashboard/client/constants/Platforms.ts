/** Plattform-Symbole. Die Schluessel sind die Namen, die Prime zurueckgibt. */

import { BASE } from "../core/Base.js";

// Plattform-Symbole. Die Schlüssel sind die Namen, die Prime zurückgibt.
export const PLATFORM_IMAGES: Record<string, string> = {
    "Epic Games": "epicgames",
    Steam: "steam",
    Xbox: "xbox",
    PlayStation: "playstation",
    Nintendo: "switch",
};

/**
 * Das Symbol einer Plattform in einem Rahmen, der es zuschneidet.
 *
 * Hintergrund: epicgames.png bringt einen Haufen leeren Rand mit - 95x107 Pixel
 * Inhalt auf einer Leinwand von 584x427, also 16 % der Breite. object-fit
 * skaliert die ganze Leinwand mit, und das Logo kam entsprechend als Fleck an,
 * waehrend Steam, Xbox und der Rest ihre Flaeche zu 88-100 % fuellen. Der Rahmen
 * schneidet den Rand weg, statt ihn mitzuskalieren; wie weit, sagt die Klasse
 * (siehe .plogo--epicgames in style.css). Die Zahl ist an der Alpha-Bounding-Box
 * der Datei gemessen, nicht geschaetzt.
 *
 * Sauberer waere eine zugeschnittene Datei. Bis dahin steht die Korrektur an
 * einer Stelle statt in jeder Ansicht, die das Logo zeigt.
 */
export function platformIcon(platform: string): HTMLElement | null {
    const file = PLATFORM_IMAGES[platform];

    if (!file) return null;

    const box = document.createElement("span");
    box.className = `plogo plogo--${file}`;

    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => box.remove());
    image.src = `${BASE}/assets/images/rocketleague/plattforms/${file}.png`;

    box.appendChild(image);

    return box;
}
