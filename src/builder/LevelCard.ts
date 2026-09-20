import { SKRSContext2D, createCanvas, loadImage } from "@napi-rs/canvas";
import { RegisterFonts } from "./RankCard";
import { COLORS } from "../constants/RankCard";
import { LEVELS_ACCENT } from "../constants/Levels";

/**
 * Die Level-Karte als PNG - Avatar, Level, Platz und ein Fortschrittsbalken.
 *
 * Kleiner als die Rang-Karte und nur mit den Zahlen aus der eigenen Datenbank;
 * geladen wird nichts außer dem Avatar. Schriften und Farben sind dieselben,
 * damit beide Karten zusammenpassen.
 */

export interface ILevelCardData {
    name: string;
    avatarURL: string | null;
    level: number;
    xp: number;
    into: number;
    need: number;
    rank: number;
    total: number;
    messages: number;
    voiceMinutes: number;
}

const WIDTH = 900;
const HEIGHT = 300;
const PAD = 28;
const CUT = 16;

function bevel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, cut: number): void {
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

function number(value: number): string {
    return value.toLocaleString("de-DE");
}

/** "3 Std. 20 Min." aus Minuten - für die Zeit im Sprachkanal. */
function minutes(value: number): string {
    if (value < 60) return `${value} Min.`;

    const hours = Math.floor(value / 60);

    return `${hours} Std.${value % 60 ? ` ${value % 60} Min.` : ""}`;
}

export async function RenderLevelCard(data: ILevelCardData): Promise<Buffer> {
    await RegisterFonts();

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    ctx.textBaseline = "alphabetic";

    // Hintergrund mit einem Hauch Farbe von links unten.
    ctx.fillStyle = COLORS.base;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const glow = ctx.createLinearGradient(0, HEIGHT, WIDTH, 0);

    glow.addColorStop(0, "rgba(138,77,255,0.18)");
    glow.addColorStop(0.55, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = COLORS.panel;
    bevel(ctx, PAD, PAD, WIDTH - PAD * 2, HEIGHT - PAD * 2, CUT);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Avatar
    const size = 132;
    const ax = PAD + 34;
    const ay = HEIGHT / 2 - size / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = "#151a22";
    ctx.fillRect(ax, ay, size, size);

    if (data.avatarURL) {
        try {
            const avatar = await loadImage(data.avatarURL);

            ctx.drawImage(avatar, ax, ay, size, size);
        } catch {
            // Ohne Avatar bleibt der graue Kreis - die Karte entsteht trotzdem.
        }
    }

    ctx.restore();
    ctx.beginPath();
    ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
    ctx.strokeStyle = LEVELS_ACCENT;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Name und Zahlen
    const left = ax + size + 32;
    const right = WIDTH - PAD - 34;

    ctx.fillStyle = COLORS.text;
    ctx.font = "800 40px Oxanium";
    ctx.textAlign = "left";
    ctx.fillText(data.name.slice(0, 20), left, ay + 44);

    ctx.font = "600 20px Rajdhani";
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(`${number(data.messages)} Nachrichten · ${minutes(data.voiceMinutes)} im Voice`, left, ay + 74);

    ctx.textAlign = "right";
    ctx.font = "600 22px Rajdhani";
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText("LEVEL", right - 96, ay + 30);
    ctx.fillText("PLATZ", right, ay + 30);

    ctx.font = "800 46px Oxanium";
    ctx.fillStyle = LEVELS_ACCENT;
    ctx.fillText(String(data.level), right - 96, ay + 74);
    ctx.fillStyle = data.rank === 1 ? COLORS.red : COLORS.blue;
    ctx.fillText(data.rank > 0 ? `#${data.rank}` : "–", right, ay + 74);

    // Fortschrittsbalken
    const barX = left;
    const barY = ay + size - 44;
    const barW = right - left;
    const barH = 22;
    const share = data.need > 0 ? Math.max(0, Math.min(1, data.into / data.need)) : 1;

    ctx.fillStyle = "rgba(255,255,255,0.07)";
    bevel(ctx, barX, barY, barW, barH, 6);
    ctx.fill();

    if (share > 0) {
        const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);

        fill.addColorStop(0, LEVELS_ACCENT);
        fill.addColorStop(1, COLORS.blue);

        ctx.save();
        bevel(ctx, barX, barY, barW, barH, 6);
        ctx.clip();
        ctx.fillStyle = fill;
        ctx.fillRect(barX, barY, Math.max(8, barW * share), barH);
        ctx.restore();
    }

    ctx.font = "600 20px Rajdhani";
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(`${number(data.into)} / ${number(data.need)} bis Level ${data.level + 1}`, barX, barY + barH + 26);

    ctx.textAlign = "right";
    ctx.fillText(`${number(data.xp)} Punkte${data.total ? ` · von ${number(data.total)}` : ""}`, right, barY + barH + 26);

    return canvas.toBuffer("image/png");
}
