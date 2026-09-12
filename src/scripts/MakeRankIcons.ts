/**
 * Verkleinerte Rang-Abzeichen fürs Dashboard.
 *
 *   npm run icons:ranks
 *
 * Die Originale sind 1381×1381 Pixel groß und bis zu 220 KB schwer - gedacht für
 * die Rang-Karte, die der Bot in Discord postet. Die Rang-Verteilung im Dashboard
 * zeigt sie 30 Pixel breit. Neun davon zu laden kostete dort fast ein Megabyte,
 * und jedes entpackt sich auf über sieben Megabyte im Speicher: die letzten kamen
 * so spät, dass ihre Spalten leer aussahen.
 *
 * Dieses Skript legt daneben eine 160er-Fassung ab - klein genug für Listen,
 * groß genug für Bildschirme mit doppelter Auflösung. Kommen neue Abzeichen
 * dazu, einmal laufen lassen.
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE = path.join(process.cwd(), "src", "dashboard", "public", "assets", "images", "rocketleague", "rlranks");
const TARGET = path.join(SOURCE, "small");
const SIZE = 160;

async function main(): Promise<void> {
    const files = (await readdir(SOURCE)).filter((name) => name.toLowerCase().endsWith(".png"));

    if (files.length === 0) {
        console.log(`\n❌ Keine Abzeichen in ${SOURCE}\n`);

        process.exit(1);
    }

    await mkdir(TARGET, { recursive: true });

    let before = 0;
    let after = 0;

    for (const name of files.sort()) {
        const source = await readFile(path.join(SOURCE, name));
        const image = await loadImage(source);
        const canvas = createCanvas(SIZE, SIZE);
        const ctx = canvas.getContext("2d");

        // Ohne das Glätten wird aus 1381 Pixeln beim Verkleinern ein Treppenmuster.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, 0, 0, SIZE, SIZE);

        const small = await canvas.encode("png");

        await writeFile(path.join(TARGET, name), small);

        before += source.length;
        after += small.length;

        console.log(`  ${name.padEnd(24)} ${(source.length / 1024).toFixed(0).padStart(4)} KB → ${(small.length / 1024).toFixed(0)} KB`);
    }

    console.log(
        `\n✅ ${files.length} Abzeichen in ${path.relative(process.cwd(), TARGET)}: ` +
            `${(before / 1024 / 1024).toFixed(1)} MB → ${(after / 1024).toFixed(0)} KB\n`
    );
}

void main();
