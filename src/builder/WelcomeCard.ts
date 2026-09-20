import { SKRSContext2D, createCanvas, loadImage } from "@napi-rs/canvas";
import { RegisterFonts } from "./RankCard";
import { COLORS } from "../constants/RankCard";
import { CARD_HEIGHT, CARD_WIDTH } from "../constants/Welcome";
import { IWelcomeCard } from "../interfaces/services/welcome/IWelcome";

/**
 * Die Begrüßungskarte als PNG.
 *
 * Aufbau: Hintergrund (eigenes Bild oder Farbverlauf), darüber ein dunkler
 * Schleier, links der Avatar, rechts drei Zeilen. Jedes Stück lässt sich
 * abschalten - die Karte rückt dann zusammen, statt Löcher zu lassen.
 */

export interface IWelcomeCardData {
    card: IWelcomeCard;
    /** Die fertigen Zeilen - Platzhalter sind schon ersetzt. */
    title: string;
    subtitle: string;
    footer: string;
    avatarURL: string | null;
    iconURL: string | null;
    /** Dateipfad des Hintergrunds, sofern hochgeladen. */
    backgroundPath: string | null;
}

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

/** Schneidet den Text ab, wenn er nicht in die Breite passt. */
function fit(ctx: SKRSContext2D, text: string, max: number): string {
    if (ctx.measureText(text).width <= max) return text;

    let cut = text;

    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);

    return `${cut}…`;
}

export async function RenderWelcomeCard(data: IWelcomeCardData): Promise<Buffer> {
    await RegisterFonts();

    const { card } = data;
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const ctx = canvas.getContext("2d");
    const accent = /^#[0-9a-f]{6}$/i.test(card.accent) ? card.accent : "#00afff";

    ctx.textBaseline = "alphabetic";

    // Hintergrund: eigenes Bild, sonst ein Verlauf aus der Akzentfarbe.
    const background = data.backgroundPath ? await loadImage(data.backgroundPath).catch(() => null) : null;

    if (background) {
        // Bild füllend einpassen, ohne es zu verzerren.
        const scale = Math.max(CARD_WIDTH / background.width, CARD_HEIGHT / background.height);
        const width = background.width * scale;
        const height = background.height * scale;

        ctx.drawImage(background, (CARD_WIDTH - width) / 2, (CARD_HEIGHT - height) / 2, width, height);
    } else {
        const gradient = ctx.createLinearGradient(0, CARD_HEIGHT, CARD_WIDTH, 0);

        gradient.addColorStop(0, COLORS.base);
        gradient.addColorStop(1, `${accent}44`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    }

    // Der Schleier hält den Text lesbar, egal wie hell das Bild ist.
    ctx.fillStyle = `rgba(5,6,8,${Math.min(90, Math.max(0, card.dim)) / 100})`;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Rahmen in der Akzentfarbe.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, CARD_WIDTH - 6, CARD_HEIGHT - 6);

    const pad = 48;
    const size = 168;
    const avatarX = pad;
    const avatarY = CARD_HEIGHT / 2 - size / 2;

    if (card.avatar) {
        ctx.save();

        if (card.avatarShape === "circle") {
            ctx.beginPath();
            ctx.arc(avatarX + size / 2, avatarY + size / 2, size / 2, 0, Math.PI * 2);
            ctx.closePath();
        } else {
            bevel(ctx, avatarX, avatarY, size, size, 22);
        }

        ctx.clip();
        ctx.fillStyle = "#151a22";
        ctx.fillRect(avatarX, avatarY, size, size);

        if (data.avatarURL) {
            const avatar = await loadImage(data.avatarURL).catch(() => null);

            if (avatar) ctx.drawImage(avatar, avatarX, avatarY, size, size);
        }

        ctx.restore();

        if (card.avatarRing) {
            ctx.strokeStyle = accent;
            ctx.lineWidth = 5;

            if (card.avatarShape === "circle") {
                ctx.beginPath();
                ctx.arc(avatarX + size / 2, avatarY + size / 2, size / 2, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                bevel(ctx, avatarX, avatarY, size, size, 22);
                ctx.stroke();
            }
        }
    }

    // Text: links neben dem Avatar oder mittig über die ganze Karte.
    const left = card.avatar ? avatarX + size + 36 : pad;
    const right = CARD_WIDTH - pad - (card.icon && data.iconURL ? 96 : 0);
    const width = Math.max(120, right - left);

    ctx.textAlign = card.align === "center" ? "center" : "left";

    const anchor = card.align === "center" ? CARD_WIDTH / 2 : left;
    const lines: { text: string; font: string; color: string; gap: number }[] = [];
    const titleSize = Math.min(72, Math.max(28, Math.round(card.titleSize)));

    if (data.title) lines.push({ text: data.title, font: `800 ${titleSize}px Oxanium`, color: COLORS.text, gap: Math.round(titleSize * 0.72) });
    if (data.subtitle) lines.push({ text: data.subtitle, font: "600 26px Rajdhani", color: COLORS.textDim, gap: 34 });
    if (card.footer && data.footer) lines.push({ text: data.footer, font: "600 22px Rajdhani", color: accent, gap: 30 });

    const block = lines.reduce((sum, line) => sum + line.gap, 0);
    let y = CARD_HEIGHT / 2 - block / 2 + (lines[0]?.gap ?? 0);

    for (const line of lines) {
        ctx.font = line.font;
        ctx.fillStyle = line.color;
        ctx.fillText(fit(ctx, line.text, card.align === "center" ? CARD_WIDTH - pad * 2 : width), anchor, y);
        y += line.gap;
    }

    // Server-Icon oben rechts.
    if (card.icon && data.iconURL) {
        const icon = await loadImage(data.iconURL).catch(() => null);

        if (icon) {
            const box = 64;
            const x = CARD_WIDTH - pad - box;
            const top = pad - 12;

            ctx.save();
            ctx.beginPath();
            ctx.arc(x + box / 2, top + box / 2, box / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(icon, x, top, box, box);
            ctx.restore();
        }
    }

    return canvas.toBuffer("image/png");
}
