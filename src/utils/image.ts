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
