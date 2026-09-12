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
