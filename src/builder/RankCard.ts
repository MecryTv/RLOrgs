import { readdir } from "node:fs/promises";
import path from "path";
import { Canvas, GlobalFonts, Image, SKRSContext2D, createCanvas, loadImage } from "@napi-rs/canvas";
import { IPrimeProfile } from "../interfaces/services/prime/IPrimeService";
import {
    CARD_HEIGHT,
    CARD_WIDTH,
    CAREER_COLORS,
    CAREER_LABELS,
    CAREER_ORDER,
    COLORS,
    FONT_ROOT,
    GAP,
    PAD,
    PLATFORM_ICON_ROOT,
    PLAYLIST_SUBTITLES,
    RankIconFile,
    RewardIconFile,
    RewardTier,
    STAT_ICON_ROOT,
    TierColor,
} from "../constants/RankCard";
import { PLACEMENT_MATCHES, REWARD_WINS_PER_LEVEL, RewardName } from "../constants/Prime";
import logger from "../utils/logger";

/**
 * Die Rang-Karte als PNG.
 *
 * Gezeichnet mit @napi-rs/canvas. Der Vorlage aus der Typografie-Datei folgend:
 * Oxanium für Namen, Ränge und Zahlen, Rajdhani für Labels, Orbitron als Akzent
 * beim Season-Reward.
 *
 * Ein Hinweis zur Schriftregistrierung: die Vorlage nennt registerFont() aus dem
 * Paket "canvas". @napi-rs/canvas heißt das GlobalFonts.registerFromPath() -
 * dieselbe Sache, anderer Name. Das Gewicht wählt danach wie gewohnt der
 * font-Shorthand ("800 64px Oxanium").
 */

/** Was auf der Karte steht. Alles Nutzerbezogene kommt von außen, nichts geraten. */
export interface IRankCardData {
    profile: IPrimeProfile;
    /** Der Discord-Name, falls das Konto verknüpft ist. null bei einer Suche. */
    discordName: string | null;
    /** URL des Discord-Avatars. null heißt: Plattform-Symbol statt Bild. */
    avatarURL: string | null;
}

/* ----------------------------------------------------------
   Schriften und Bilder
   ---------------------------------------------------------- */
let fonts: Promise<void> | null = null;

/**
 * Registriert die Schriften einmal je Prozess.
 *
 * Der Familienname kommt aus dem Dateinamen vor dem Bindestrich, das Gewicht
 * liest Skia aus der Datei selbst. Deshalb reicht es, alle Schnitte unter
 * demselben Namen anzumelden - "800 64px Oxanium" findet dann den ExtraBold.
 *
 * Gibt ein Promise zurueck und kein void: die Dateien werden gelesen, und wer
 * vorher zeichnet, bekommt eine Systemschrift. Genau einmal ausgefuehrt wird es
 * trotzdem - das gemerkte Promise ist die Sperre.
 */
export function RegisterFonts(): Promise<void> {
    fonts ??= readdir(FONT_ROOT)
        .then((files) => {
            for (const file of files.filter((name) => name.toLowerCase().endsWith(".ttf"))) {
                const family = file.split("-")[0] as string;

                if (!GlobalFonts.registerFromPath(path.join(FONT_ROOT, file), family)) {
                    logger.warn(`🖋️  Schrift nicht ladbar: ${file}`);
                }
            }
        })
        .catch((error) => {
            // Ohne die Dateien fällt Skia auf eine Systemschrift zurück. Die
            // Karte sieht dann anders aus, entsteht aber - das ist besser als
            // ein Command, der mit einem Fehler abbricht.
            logger.warn(`🖋️  Schriften nicht gefunden (${FONT_ROOT}): ${String(error)}`);
        });

    return fonts;
}

// Bilder ändern sich nicht - einmal laden reicht für die Laufzeit des Prozesses.
const images = new Map<string, Image | null>();

async function image(file: string): Promise<Image | null> {
    const cached = images.get(file);

    if (cached !== undefined) return cached;

    try {
        const loaded = await loadImage(file);

        images.set(file, loaded);

        return loaded;
    } catch (error) {
        // Ein fehlendes Bild kostet sein Symbol, nicht die ganze Karte.
        logger.warn(`🖼️  Bild nicht ladbar: ${file} (${String(error)})`);
        images.set(file, null);

        return null;
    }
}

/**
 * Der sichtbare Bereich eines Bildes.
 *
 * Manche Symbole liegen als kleines Motiv auf einer viel groesseren, leeren
 * Leinwand - epicgames.png etwa fuellt nur 16 % der Breite. Wer so ein Bild
 * einfach in ein Feld zeichnet, skaliert die Leere mit und bekommt einen Fleck.
 * Deshalb wird einmal gemessen, wo ueberhaupt etwas steht, und danach nur
 * dieser Ausschnitt gezeichnet.
 */
const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();

/** Kantenlaenge des Rasters, auf dem gemessen wird. */
const PROBE_SIZE = 256;

function contentBox(key: string, source: Image): { x: number; y: number; w: number; h: number } {
    const known = boxes.get(key);

    if (known) return known;

    // Gemessen wird auf einer verkleinerten Kopie, nicht auf dem Original. Ein
    // Rang-Abzeichen ist 1381x1381 - das sind 1,9 Millionen Bildpunkte, und die
    // einzeln durchzugehen kostete gemessene 1,4 Sekunden je Bild. Fuer einen
    // Rahmen, der danach ohnehin skaliert wird, reicht ein Raster von 256.
    const scale = Math.min(1, PROBE_SIZE / Math.max(source.width, source.height));
    const pw = Math.max(1, Math.round(source.width * scale));
    const ph = Math.max(1, Math.round(source.height * scale));

    const probe = createCanvas(pw, ph);
    const ctx = probe.getContext("2d");

    ctx.drawImage(source, 0, 0, pw, ph);

    const data = ctx.getImageData(0, 0, pw, ph).data;

    let x0 = pw;
    let y0 = ph;
    let x1 = -1;
    let y1 = -1;

    // Flach ueber den Puffer statt verschachtelt: dieselbe Rechnung, aber ohne
    // die Multiplikation je Bildpunkt - das allein macht den Faktor 50 aus.
    for (let i = 3, p = 0; i < data.length; i += 4, p += 1) {
        // Beim Verkleinern verwischen harte Kanten; der Schwellwert liegt
        // deshalb niedrig, damit keine duenne Aussenkante verloren geht.
        if ((data[i] as number) <= 2) continue;

        const x = p % pw;
        const y = (p - x) / pw;

        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
    }

    // Eine Rasterzelle Sicherheitsabstand, dann zurueck in die Originalmasse.
    const box =
        x1 < 0
            ? { x: 0, y: 0, w: source.width, h: source.height }
            : {
                  x: Math.max(0, Math.floor((x0 - 1) / scale)),
                  y: Math.max(0, Math.floor((y0 - 1) / scale)),
                  w: 0,
                  h: 0,
              };

    if (x1 >= 0) {
        box.w = Math.min(source.width - box.x, Math.ceil((x1 + 2) / scale) - box.x);
        box.h = Math.min(source.height - box.y, Math.ceil((y1 + 2) / scale) - box.y);
    }

    boxes.set(key, box);

    return box;
}

/** Zeichnet nur das Motiv, mittig und seitenverhaeltnistreu in ein Quadrat. */
function drawIcon(ctx: SKRSContext2D, key: string, source: Image, x: number, y: number, size: number): void {
    const box = contentBox(key, source);
    const scale = size / Math.max(box.w, box.h);
    const w = box.w * scale;
    const h = box.h * scale;

    ctx.drawImage(source, box.x, box.y, box.w, box.h, x + (size - w) / 2, y + (size - h) / 2, w, h);
}

/**
 * Dasselbe, aber mit einem Schein in der Rangfarbe dahinter.
 *
 * Die Abzeichen sind dunkles Metall auf dunklem Grund und gingen darin unter.
 * Der Schein hebt sie ab, ohne sie einzufaerben - zweimal gezeichnet, damit er
 * dicht genug wird, um wirklich zu tragen.
 */
function drawGlowingIcon(
    ctx: SKRSContext2D,
    key: string,
    source: Image,
    x: number,
    y: number,
    size: number,
    color: string
): void {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.34;

    drawIcon(ctx, key, source, x, y, size);
    drawIcon(ctx, key, source, x, y, size);

    ctx.restore();

    // Ohne Schatten noch einmal obendrauf: sonst wirkt das Motiv selbst weich.
    drawIcon(ctx, key, source, x, y, size);
}

/**
 * Ein Symbol in einer Farbe.
 *
 * Die Karriere-Symbole liegen als schwarze PNGs vor - auf dunklem Grund wären
 * sie unsichtbar. source-in ersetzt jede Farbe durch die gewünschte und behält
 * nur die Deckkraft, also die Form.
 */
function tinted(key: string, source: Image, size: number, color: string): Canvas {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");

    drawIcon(ctx, key, source, 0, 0, size);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);

    return canvas;
}

/* ----------------------------------------------------------
   Zeichen-Handgriffe
   ---------------------------------------------------------- */

/** Ein Rechteck mit abgeschrägten Ecken - die Grundform des ganzen HUD. */
function bevelPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, cut: number): void {
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + w - cut, y);
    ctx.lineTo(x + w, y + cut);
    ctx.lineTo(x + w, y + h - cut);
    ctx.lineTo(x + w - cut, y + h);
    ctx.lineTo(x + cut, y + h);
    ctx.lineTo(x, y + h - cut);
    ctx.lineTo(x, y + cut);
    ctx.closePath();
}

/** Strich mit Schein. Der Schatten ist hier das Leuchten, nicht der Schatten. */
function glow(ctx: SKRSContext2D, color: string, blur: number, draw: () => void): void {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    draw();
    ctx.restore();
}

/**
 * Ein dunkles Panel mit leuchtender Kante - der Baustein, aus dem die Karte
 * besteht.
 */
function panel(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    options: { cut?: number; border?: string; fill?: string; glow?: number; width?: number } = {}
): void {
    const cut = options.cut ?? 18;

    ctx.save();
    bevelPath(ctx, x, y, w, h, cut);
    ctx.fillStyle = options.fill ?? "rgba(6, 9, 13, 0.78)";
    ctx.fill();
    ctx.restore();

    const border = options.border ?? COLORS.red;

    glow(ctx, border, options.glow ?? 14, () => {
        bevelPath(ctx, x, y, w, h, cut);
        ctx.strokeStyle = border;
        ctx.lineWidth = options.width ?? 2;
        ctx.stroke();
    });
}

/** Text, der notfalls kleiner wird, statt aus seinem Feld zu laufen. */
function fitText(ctx: SKRSContext2D, text: string, max: number, size: number, font: string): number {
    let current = size;

    ctx.font = `${font} ${current}px`;

    while (ctx.measureText(text).width > max && current > 12) {
        current -= 2;
        ctx.font = `${font} ${current}px`;
    }

    return current;
}

/**
 * Grossbuchstaben mit Sperrung - die HUD-Labels der Vorlage.
 *
 * Canvas kann das selbst. Hier stand vorher eine Schleife, die jeden Buchstaben
 * einzeln setzte und einzeln mass; ohne Kerning kamen dabei sichtbare Luecken
 * mitten in Woertern heraus ("ASS ISTS"). letterSpacing macht dasselbe richtig
 * und misst auch richtig.
 */
function tracked(ctx: SKRSContext2D, text: string, x: number, y: number, spacing: number): void {
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = "0px";
}

function trackedWidth(ctx: SKRSContext2D, text: string, spacing: number): number {
    ctx.letterSpacing = `${spacing}px`;

    const width = ctx.measureText(text).width;

    ctx.letterSpacing = "0px";

    return width;
}

/** Eine kleine Flamme für die Serie. Gezeichnet, weil Emoji hier nicht rendern. */
function flame(ctx: SKRSContext2D, x: number, y: number, size: number, color: string): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = color;

    // Aussenflamme: eine Spitze oben, eine ausholende Zunge links, breite Basis.
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.bezierCurveTo(13, 5, 17, 7, 18.5, 11);
    ctx.bezierCurveTo(20.5, 16, 17.5, 24, 12, 24);
    ctx.bezierCurveTo(6.5, 24, 3.5, 19.5, 4.5, 14.5);
    ctx.bezierCurveTo(5.2, 11, 7.5, 9.5, 8, 6.5);
    ctx.bezierCurveTo(9.5, 9, 10.5, 9.5, 11, 8);
    ctx.bezierCurveTo(11.6, 6, 12.2, 3, 13, 0);
    ctx.closePath();
    ctx.fill();

    // Der helle Kern - macht aus der Silhouette erst eine Flamme.
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.beginPath();
    ctx.moveTo(12.5, 11);
    ctx.bezierCurveTo(14.5, 14, 15.5, 16, 15.5, 18.5);
    ctx.bezierCurveTo(15.5, 21.5, 14, 22.5, 12, 22.5);
    ctx.bezierCurveTo(10, 22.5, 8.5, 21, 8.5, 18.5);
    ctx.bezierCurveTo(8.5, 16, 11, 14.5, 12.5, 11);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

/* ----------------------------------------------------------
   Die einzelnen Blöcke
   ---------------------------------------------------------- */

/**
 * Der Hintergrund, komplett gezeichnet.
 *
 * Vorher lag hier ein fertiges Bild. Es sah nach KI aus - weiche, beliebige
 * Formen ohne Bezug zum Raster, auf das die Panels danach gelegt wurden. Ein
 * gezeichneter Grund hat den umgekehrten Vorteil: er kennt die Maße der Karte
 * und kann sich daran ausrichten.
 *
 * Aufbau von unten nach oben, nach der Vorgabe "clean > maximal viele Effekte":
 *
 *   1. Grundton mit leichtem Verlauf     - kein flaches Schwarz
 *   2. zwei weiche Lichter               - rot unten rechts, blau oben links
 *   3. schräge Bänder                    - Tiefe, ohne etwas darzustellen
 *   4. Raster                            - kaum sichtbar, gibt der Fläche Halt
 *   5. Neonlinien in den Ecken           - die einzigen scharfen Kanten
 *   6. Vignette                          - zieht den Blick nach innen
 */
function drawBackground(ctx: SKRSContext2D): void {
    // --- 1. Grundton ----------------------------------------------------
    const base = ctx.createLinearGradient(0, 0, CARD_WIDTH * 0.6, CARD_HEIGHT);
    base.addColorStop(0, "#0a0e14");
    base.addColorStop(0.55, COLORS.base);
    base.addColorStop(1, "#07090d");

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // --- 2. Zwei Lichter -------------------------------------------------
    // Rot unten rechts, wo in der Vorlage das Auto stand: die Ecke bleibt warm,
    // ohne dass dort etwas Erkennbares liegt.
    const warm = ctx.createRadialGradient(
        CARD_WIDTH * 0.86,
        CARD_HEIGHT * 0.78,
        0,
        CARD_WIDTH * 0.86,
        CARD_HEIGHT * 0.78,
        CARD_WIDTH * 0.62
    );
    warm.addColorStop(0, "rgba(255, 30, 45, 0.22)");
    warm.addColorStop(0.45, "rgba(190, 20, 35, 0.09)");
    warm.addColorStop(1, "rgba(255, 30, 45, 0)");

    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    const cool = ctx.createRadialGradient(
        CARD_WIDTH * 0.08,
        -CARD_HEIGHT * 0.1,
        0,
        CARD_WIDTH * 0.08,
        -CARD_HEIGHT * 0.1,
        CARD_WIDTH * 0.5
    );
    cool.addColorStop(0, "rgba(0, 130, 200, 0.14)");
    cool.addColorStop(1, "rgba(0, 130, 200, 0)");

    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // --- 3. Schraege Baender ---------------------------------------------
    // Immer derselbe Winkel wie die abgeschraegten Panel-Ecken. Dadurch wirkt
    // der Grund wie derselbe Bauplan, nur eine Ebene tiefer.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const bands: [number, number, number, string][] = [
        // x am oberen Rand, Breite, Neigung, Farbe
        [-260, 300, 0.55, "rgba(255, 255, 255, 0.016)"],
        [220, 170, 0.55, "rgba(255, 60, 70, 0.028)"],
        [980, 420, 0.55, "rgba(255, 255, 255, 0.014)"],
        [1420, 190, 0.55, "rgba(0, 175, 255, 0.020)"],
    ];

    for (const [x, width, slant, color] of bands) {
        const shift = CARD_HEIGHT * slant;

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + width, 0);
        ctx.lineTo(x + width + shift, CARD_HEIGHT);
        ctx.lineTo(x + shift, CARD_HEIGHT);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    }

    ctx.restore();

    // --- 4. Raster --------------------------------------------------------
    // So schwach, dass man es nicht sieht, sondern nur merkt: die Flaeche wirkt
    // nicht mehr leer, ohne dass etwas darauf steht.
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.022)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x <= CARD_WIDTH; x += 64) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CARD_HEIGHT);
    }

    for (let y = 0; y <= CARD_HEIGHT; y += 64) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(CARD_WIDTH, y + 0.5);
    }

    ctx.stroke();
    ctx.restore();

    // --- 5. Neonlinien ----------------------------------------------------
    // Nur in den Ecken, und nur wenige: sie sollen den Rahmen andeuten, nicht
    // mit den Panels darueber konkurrieren.
    const corner = (points: [number, number][], color: string, width: number, alpha: number): void => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(...(points[0] as [number, number]));

        for (const point of points.slice(1)) ctx.lineTo(...point);

        ctx.stroke();
        ctx.restore();
    };

    corner(
        [
            [0, 150],
            [0, 34],
            [16, 14],
            [300, 14],
            [326, 0],
        ],
        COLORS.red,
        2.5,
        0.55
    );

    corner(
        [
            [CARD_WIDTH, CARD_HEIGHT - 150],
            [CARD_WIDTH, CARD_HEIGHT - 34],
            [CARD_WIDTH - 16, CARD_HEIGHT - 14],
            [CARD_WIDTH - 300, CARD_HEIGHT - 14],
            [CARD_WIDTH - 326, CARD_HEIGHT],
        ],
        COLORS.red,
        2.5,
        0.55
    );

    // Zwei kurze Striche als Akzent, wie Markierungen auf einem Messgeraet.
    corner(
        [
            [CARD_WIDTH - 120, 16],
            [CARD_WIDTH - 40, 16],
        ],
        COLORS.blue,
        2,
        0.4
    );
    corner(
        [
            [40, CARD_HEIGHT - 16],
            [120, CARD_HEIGHT - 16],
        ],
        COLORS.blue,
        2,
        0.4
    );

    // --- 6. Vignette ------------------------------------------------------
    const vignette = ctx.createRadialGradient(
        CARD_WIDTH / 2,
        CARD_HEIGHT / 2,
        CARD_HEIGHT * 0.3,
        CARD_WIDTH / 2,
        CARD_HEIGHT / 2,
        CARD_WIDTH * 0.72
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");

    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

/** Kopf: Avatar, Club-Tag, Name, Discord-Name und der Season-Reward. */
async function drawHeader(ctx: SKRSContext2D, data: IRankCardData): Promise<void> {
    const { profile } = data;
    const top = PAD;
    const height = 244;

    panel(ctx, PAD, top, CARD_WIDTH - PAD * 2, height, { cut: 26, glow: 22 });

    // --- Avatar ---------------------------------------------------------
    const cx = PAD + 108;
    const cy = top + height / 2;
    const radius = 74;

    const avatar = data.avatarURL ? await image(data.avatarURL) : null;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(8, 13, 18, 0.9)";
    ctx.fill();
    ctx.clip();

    if (avatar) {
        ctx.drawImage(avatar, cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
        const file = path.join(PLATFORM_ICON_ROOT, "epicgames.png");
        const platform = await image(file);

        if (platform) ctx.drawImage(tinted(file, platform, 92, COLORS.text), cx - 46, cy - 46);
    }

    ctx.restore();

    glow(ctx, COLORS.red, 24, () => {
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.red;
        ctx.lineWidth = 3;
        ctx.stroke();
    });

    // --- Name und Club --------------------------------------------------
    const textX = cx + radius + 44;
    let nameY = cy + 14;

    if (profile.club) {
        ctx.fillStyle = COLORS.red;
        ctx.font = "700 34px Oxanium";
        ctx.textBaseline = "alphabetic";
        glow(ctx, COLORS.red, 16, () => ctx.fillText(`[${profile.club?.tag}]`, textX, cy - 52));
    } else {
        nameY = cy - 4;
    }

    const nameSize = fitText(ctx, profile.name, 560, 76, "800");
    ctx.font = `800 ${nameSize}px Oxanium`;
    ctx.fillStyle = COLORS.text;
    glow(ctx, "rgba(255, 60, 70, 0.55)", 18, () => ctx.fillText(profile.name, textX, nameY));

    if (data.discordName) {
        ctx.font = "500 34px Rajdhani";
        ctx.fillStyle = COLORS.textDim;
        ctx.fillText(`@${data.discordName}`, textX, nameY + 44);
    }

    // --- Season Reward --------------------------------------------------
    const boxW = 420;
    const boxH = 172;
    const boxX = CARD_WIDTH - PAD - boxW - 22;
    const boxY = top + (height - boxH) / 2;

    panel(ctx, boxX, boxY, boxW, boxH, { cut: 18, border: COLORS.red, glow: 16, fill: "rgba(5, 8, 12, 0.82)" });

    ctx.font = "600 21px Rajdhani";
    ctx.fillStyle = COLORS.text;
    tracked(ctx, "SEASON REWARD LEVEL", boxX + 26, boxY + 38, 2.4);

    const level = profile.seasonLevel;
    const rewardIcon = await image(RewardIconFile(level));

    // Die Stufe traegt die Farbe ihres hoechsten Rangs - derselbe, den das
    // Abzeichen zeigt.
    const rewardColor = TierColor(RewardTier(level));

    if (rewardIcon) drawGlowingIcon(ctx, RewardIconFile(level), rewardIcon, boxX + 22, boxY + 52, 76, rewardColor);
    const rewardText = RewardName(level).toUpperCase();
    const rewardSize = fitText(ctx, rewardText, boxW - 130, 40, "700");

    ctx.font = `700 ${rewardSize}px Oxanium`;
    ctx.fillStyle = rewardColor;
    glow(ctx, rewardColor, 14, () => ctx.fillText(rewardText, boxX + 108, boxY + 96));

    // --- Fortschritt zur nächsten Stufe ---------------------------------
    const wins = Math.min(profile.seasonWins, REWARD_WINS_PER_LEVEL);
    const ratio = level > 0 ? wins / REWARD_WINS_PER_LEVEL : 0;
    const barX = boxX + 108;
    const barY = boxY + 116;
    const barW = boxW - 108 - 100;

    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    bevelPath(ctx, barX, barY, barW, 16, 5);
    ctx.fill();

    if (ratio > 0) {
        const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        fill.addColorStop(0, COLORS.rankBlue);
        fill.addColorStop(1, COLORS.blue);

        ctx.fillStyle = fill;
        glow(ctx, COLORS.blue, 14, () => {
            bevelPath(ctx, barX, barY, Math.max(16, barW * ratio), 16, 5);
            ctx.fill();
        });
    }

    ctx.font = "700 26px Orbitron";
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`${Math.round(ratio * 100)}%`, barX + barW + 16, barY + 15);
}

/** Die Überschrift über den drei Rang-Karten. */
async function drawRankedHeading(ctx: SKRSContext2D, y: number): Promise<void> {
    const file = path.join(STAT_ICON_ROOT, "wins.png");
    const icon = await image(file);

    if (icon) ctx.drawImage(tinted(file, icon, 46, COLORS.text), PAD + 8, y - 36);

    ctx.font = "800 50px Oxanium";
    ctx.fillStyle = COLORS.text;
    glow(ctx, "rgba(255,60,70,0.5)", 16, () => ctx.fillText("RANKED", PAD + 68, y));

    ctx.font = "500 24px Rajdhani";
    ctx.fillStyle = COLORS.textDim;
    const width = trackedWidth(ctx, "ROCKET LEAGUE", 5.5);
    tracked(ctx, "ROCKET LEAGUE", PAD + 70, y + 30, 5.5);

    // Eine dünne Linie, die vom Titel bis zum rechten Rand läuft.
    const lineX = PAD + 80 + Math.max(width, 220);

    glow(ctx, COLORS.red, 10, () => {
        ctx.beginPath();
        ctx.moveTo(lineX, y - 12);
        ctx.lineTo(CARD_WIDTH - PAD - 10, y - 12);
        ctx.strokeStyle = "rgba(255, 30, 45, 0.55)";
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

/** Eine der drei Playlist-Karten. */
async function drawRankCard(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    rank: IPrimeProfile["ranks"][number]
): Promise<void> {
    panel(ctx, x, y, w, h, { cut: 22, glow: 18, fill: "rgba(7, 11, 16, 0.82)" });

    const inner = x + 30;

    // --- Modus ----------------------------------------------------------
    ctx.font = "800 48px Oxanium";
    ctx.fillStyle = COLORS.text;
    ctx.fillText(rank.key, inner, y + 62);

    ctx.font = "500 25px Rajdhani";
    ctx.fillStyle = COLORS.textDim;
    tracked(ctx, PLAYLIST_SUBTITLES[rank.key] ?? "", inner + 2, y + 92, 4);

    // --- Rang -----------------------------------------------------------
    const rowY = y + 118;
    const rowH = 116;

    panel(ctx, inner - 12, rowY, w - 36, rowH, {
        cut: 14,
        border: "rgba(0, 175, 255, 0.32)",
        glow: 8,
        fill: "rgba(10, 16, 24, 0.72)",
        width: 1.5,
    });

    const icon = await image(RankIconFile(rank.tier, rank.placement));

    const tierColor = TierColor(rank.placement ? 0 : rank.tier);

    if (icon) drawGlowingIcon(ctx, RankIconFile(rank.tier, rank.placement), icon, inner - 2, rowY + 12, 92, tierColor);
    const tierText = rank.placement ? `PLATZIERUNG ${rank.placementMatches}/${PLACEMENT_MATCHES}` : rank.tierName.toUpperCase();
    const tierSize = fitText(ctx, tierText, w - 160, 34, "700");

    ctx.font = `700 ${tierSize}px Oxanium`;
    ctx.fillStyle = tierColor;
    glow(ctx, tierColor, 12, () => ctx.fillText(tierText, inner + 100, rowY + 58));

    // Solange die Platzierungsspiele laufen, steht noch keine Division fest -
    // Prime liefert zwar eine, aber das Spiel zeigt sie selbst nicht.
    const division = rank.placement
        ? `NOCH ${PLACEMENT_MATCHES - rank.placementMatches} SPIELE`
        : rank.divisionName
          ? `DIVISION ${rank.divisionName}`
          : "OHNE DIVISION";

    ctx.font = "500 24px Rajdhani";
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(division, inner + 100, rowY + 90);

    // --- MMR ------------------------------------------------------------
    const footY = rowY + rowH + 30;

    ctx.font = "700 22px Rajdhani";
    ctx.fillStyle = COLORS.textDim;
    tracked(ctx, "MMR", inner, footY, 3);

    ctx.font = "800 64px Oxanium";
    ctx.fillStyle = COLORS.text;
    glow(ctx, "rgba(255, 255, 255, 0.25)", 12, () =>
        ctx.fillText(rank.mmr > 0 ? String(rank.mmr) : "—", inner - 2, footY + 60)
    );

    // --- Serie und Spiele, rechts daneben und bewusst kleiner ------------
    const sideX = x + w - 30;
    const won = rank.streak > 0;
    const streak = Math.abs(rank.streak);

    // Beide Labels rechtsbuendig an derselben Kante - so steht die Spalte
    // ruhig, egal wie lang die Zahlen daneben sind.
    ctx.font = "600 18px Rajdhani";

    const labelX = sideX - Math.max(trackedWidth(ctx, "AKTUELLE STREAK", 2), trackedWidth(ctx, "GESPIELTE SPIELE", 2));
    const streakColor = streak === 0 ? COLORS.textDim : won ? COLORS.win : COLORS.loss;

    ctx.fillStyle = COLORS.textDim;
    tracked(ctx, "AKTUELLE STREAK", labelX, footY - 6, 2);
    tracked(ctx, "GESPIELTE SPIELE", labelX, footY + 44, 2);

    // Wert und Symbol links vom Label, damit die Zahl nicht mit der MMR kollidiert.
    // Jedes Symbol steht auf der Grundlinie seines eigenen Wertes, nicht auf der
    // seines Labels - sonst rutscht die Flamme nach oben zur Ueberschrift und
    // die Trophaee direkt darunter, und beide bilden einen Klumpen.
    //
    // Der Versatz ist genau die Symbolhoehe: dann sitzt die Unterkante auf der
    // Grundlinie, wie bei einem Buchstaben ohne Unterlaenge. Ein Symbol, das
    // darunter hinausragt, sieht neben der Zahl abgesackt aus.
    const streakBaseline = footY + 20;
    const gamesBaseline = footY + 70;

    // Ohne Serie keine Flamme: ein graues Symbol neben einem Strich sagt nichts,
    // es fuellt nur Platz.
    if (streak > 0) flame(ctx, labelX - 46, streakBaseline - 26, 26, streakColor);

    ctx.font = "700 26px Oxanium";
    ctx.fillStyle = streakColor;
    ctx.fillText(streak === 0 ? "—" : `${streak}x`, labelX + 4, streakBaseline);

    const trophyFile = path.join(STAT_ICON_ROOT, "wins.png");
    const trophy = await image(trophyFile);

    if (trophy) ctx.drawImage(tinted(trophyFile, trophy, 24, COLORS.textDim), labelX - 44, gamesBaseline - 24);

    ctx.font = "700 26px Oxanium";
    ctx.fillStyle = COLORS.text;
    ctx.fillText(String(rank.matches), labelX + 4, gamesBaseline);
}

/** Die Karriere-Werte am Fuß der Karte. */
async function drawCareer(ctx: SKRSContext2D, y: number, height: number, profile: IPrimeProfile): Promise<void> {
    panel(ctx, PAD, y, CARD_WIDTH - PAD * 2, height, { cut: 22, glow: 18, fill: "rgba(6, 10, 15, 0.84)" });

    ctx.font = "800 34px Oxanium";
    ctx.fillStyle = COLORS.text;
    ctx.fillText("KARRIERE STATS", PAD + 74, y + 44);

    const chartFile = path.join(STAT_ICON_ROOT, "shots.png");
    const chart = await image(chartFile);

    if (chart) ctx.drawImage(tinted(chartFile, chart, 32, COLORS.red), PAD + 26, y + 16);

    // Die Werte liegen bei Prime unter ihrem Schlüssel - fehlt einer, steht dort
    // eine Null statt einer Lücke.
    const values = new Map(profile.stats.map((stat) => [stat.key, stat.value]));

    const cellW = (CARD_WIDTH - PAD * 2 - 60) / CAREER_ORDER.length;
    const cellY = y + 58;

    for (const [index, key] of CAREER_ORDER.entries()) {
        const cx = PAD + 30 + cellW * index + cellW / 2;
        const file = path.join(STAT_ICON_ROOT, `${key}.png`);
        const icon = await image(file);
        const color = CAREER_COLORS[key] ?? COLORS.text;

        // Das Symbol traegt die Farbe, mit einem Schein darunter - sechs weisse
        // Formen in einer Reihe verschwimmen sonst zu einem Band.
        if (icon) {
            const stamp = tinted(file, icon, 44, color);

            glow(ctx, color, 16, () => ctx.drawImage(stamp, cx - 22, cellY));
            ctx.drawImage(stamp, cx - 22, cellY);
        }

        ctx.textAlign = "center";

        // letterSpacing haengt auch hinter den letzten Buchstaben noch einen
        // Abstand. Bei zentriertem Text zieht das die Zeile nach links - das
        // halbe Spatium gleicht es wieder aus.
        ctx.font = "600 20px Rajdhani";
        ctx.fillStyle = COLORS.textDim;
        ctx.letterSpacing = "2px";
        ctx.fillText(CAREER_LABELS[key] ?? key.toUpperCase(), cx + 1, cellY + 68);
        ctx.letterSpacing = "0px";

        ctx.font = "700 42px Oxanium";
        ctx.fillStyle = COLORS.text;
        glow(ctx, "rgba(255,255,255,0.18)", 10, () =>
            ctx.fillText(new Intl.NumberFormat("de-DE").format(values.get(key) ?? 0), cx, cellY + 112)
        );

        ctx.textAlign = "left";
    }
}

/** "vor 3 Minuten", "vor 2 Stunden" - grob reicht, es geht um die Groessenordnung. */
function ago(iso: string): string {
    const at = Date.parse(iso);

    if (Number.isNaN(at)) return "unbekannt";

    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));

    if (seconds < 90) return "gerade eben";

    const minutes = Math.round(seconds / 60);

    if (minutes < 60) return `vor ${minutes} Minuten`;

    const hours = Math.round(minutes / 60);

    if (hours < 24) return `vor ${hours} Stunde${hours === 1 ? "" : "n"}`;

    const days = Math.round(hours / 24);

    return `vor ${days} Tag${days === 1 ? "" : "en"}`;
}

/**
 * Der Stand am unteren Rand, links.
 *
 * Ohne diese Zeile ist einer Karte nicht anzusehen, ob die Zahlen von jetzt oder
 * von gestern sind - und genau das ist der Fall, wenn Prime gerade nicht
 * antwortet und der gespeicherte Stand einspringt. Dann wird die Zeile orange
 * und sagt auch warum.
 */
function drawFreshness(ctx: SKRSContext2D, profile: IPrimeProfile): void {
    const stale = profile.stale === true;
    const text = stale
        ? `Rocket League antwortet gerade nicht — angezeigt wird der Stand von ${ago(profile.fetchedAt)}`
        : `Stand ${ago(profile.fetchedAt)} · wird alle 10 Minuten erneuert`;

    // Links unten, nicht rechts: rechts unten laeuft die rote Eckklammer des
    // Hintergrunds durch, und der Text lag genau darauf. Links steht dort nur
    // ein kurzer blauer Strich, und der bleibt unter der Grundlinie.
    //
    // Die Grundlinie sitzt mittig im freien Band zwischen Karriere-Leiste und
    // Kartenrand, statt am Rand zu kleben.
    const baseline = CARD_HEIGHT - 30;
    let x = PAD + 4;

    ctx.save();
    ctx.textAlign = "left";

    if (stale) {
        // Ein kleines Warndreieck davor - die Farbe allein traegt die Aussage
        // nicht, wenn jemand sie nicht unterscheiden kann.
        ctx.beginPath();
        ctx.moveTo(x + 9, baseline - 15);
        ctx.lineTo(x + 18, baseline);
        ctx.lineTo(x, baseline);
        ctx.closePath();
        ctx.fillStyle = "#ffa03d";
        ctx.fill();

        ctx.fillStyle = COLORS.base;
        ctx.font = "700 11px Rajdhani";
        ctx.textAlign = "center";
        ctx.fillText("!", x + 9, baseline - 2);

        ctx.textAlign = "left";
        x += 26;
    }

    ctx.font = `${stale ? "600" : "500"} 19px Rajdhani`;
    ctx.fillStyle = stale ? "#ffa03d" : "rgba(168, 176, 188, 0.65)";
    ctx.fillText(text, x, baseline);
    ctx.restore();
}

/* ----------------------------------------------------------
   Die ganze Karte
   ---------------------------------------------------------- */
export async function RenderRankCard(data: IRankCardData): Promise<Buffer> {
    // Erst die Schriften, dann zeichnen - sonst faellt die erste Karte nach dem
    // Start auf eine Systemschrift zurueck.
    await RegisterFonts();

    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const ctx = canvas.getContext("2d");

    ctx.textBaseline = "alphabetic";

    drawBackground(ctx);
    await drawHeader(ctx, data);

    const headingY = PAD + 244 + 74;

    await drawRankedHeading(ctx, headingY);

    const cardsY = headingY + 52;
    const cardsH = 356;
    const cardW = (CARD_WIDTH - PAD * 2 - GAP * 2) / 3;

    // Fehlt eine Playlist, bleibt ihr Platz frei statt die anderen zu verschieben -
    // drei Spalten sind drei Spalten.
    for (const [index, key] of (["1v1", "2v2", "3v3"] as const).entries()) {
        const rank = data.profile.ranks.find((entry) => entry.key === key);

        if (!rank) continue;

        await drawRankCard(ctx, PAD + (cardW + GAP) * index, cardsY, cardW, cardsH, rank);
    }

    const careerY = cardsY + cardsH + GAP;

    // 22px mehr Abstand nach unten als der Rahmen: dort steht der Stand.
    await drawCareer(ctx, careerY, CARD_HEIGHT - careerY - PAD - 22, data.profile);

    drawFreshness(ctx, data.profile);

    return canvas.encode("png");
}
