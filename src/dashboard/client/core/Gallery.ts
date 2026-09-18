/**
 * Der Weg zur Galerie des Bots: Fehlertexte und der Upload mit Fortschritt.
 *
 * Beides brauchen zwei Seiten - die Galerie selbst und die Bildauswahl im
 * Nachrichten-Editor. Es steht deshalb hier und nicht in einer von beiden.
 */

import { BASE } from "./Base.js";

/**
 * MAX_IMAGE_BYTES aus src/constants/Gallery.ts (8 MiB). Der Client kann von dort
 * nicht importieren; check:dashboard vergleicht beide Zahlen.
 */
export const MAX_UPLOAD_BYTES = 8388608;

export function megabytes(bytes: number): string {
    return `${(bytes / 1048576).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

// Warum eine Antwort abgelehnt wurde. Vorbild: FAILED in Guild.ts - derselbe
// Gedanke (Sitzung/Recht/Ansturm/Datenbank werden zu einem deutschen Satz statt
// zum rohen "Unauthorized"/"Forbidden"), eigener Wortlaut für die Galerie.
export const FAILED: Record<number, string> = {
    401: "Deine Sitzung ist abgelaufen, lade die Seite neu.",
    403: "Diesen Server darfst du nicht verwalten.",
    // Fastify antwortet englisch ("Payload Too Large"), bevor die Route läuft.
    413: `Zu groß – höchstens ${megabytes(MAX_UPLOAD_BYTES)}.`,
    429: "Zu viele Anfragen auf einmal, warte einen Moment.",
    503: "Der Bot erreicht gerade seine Datenbank nicht.",
};

/**
 * 400/415 zeigen die Meldung der Route selbst (data.error), ein unbekannter
 * Code einen festen Rückfalltext.
 */
export function reasonOf(status: number, data: { error?: string }): string {
    return FAILED[status] ?? data.error ?? `Der Bot hat abgelehnt (${status}).`;
}

/**
 * Liest eine abgelehnte Antwort. null heißt Erfolg; der Rumpf ist dann noch
 * ungelesen, der Aufrufer liest ihn selbst (ein Response-Rumpf lässt sich nur
 * einmal lesen).
 */
export async function failureText(response: Response): Promise<string | null> {
    if (response.ok) return null;

    return reasonOf(response.status, (await response.json().catch(() => ({}))) as { error?: string });
}

export interface IUploadTarget {
    category: string;
    subcategory: string | null;
}

/** "upload": Bytes sind unterwegs. "shrink": der Bot verkleinert. */
export type UploadPhase = "upload" | "shrink";

/**
 * Ein Bild in ein Album legen. XMLHttpRequest statt fetch: nur er meldet, wie
 * weit der Upload ist. Zurück kommt der Grund einer Ablehnung oder die ID des
 * neuen Bildes.
 */
export function uploadImage(
    guildId: string,
    target: IUploadTarget,
    file: File,
    onProgress: (phase: UploadPhase, fraction: number) => void
): Promise<{ error: string | null; id?: string }> {
    const query = new URLSearchParams({ category: target.category, name: file.name });

    if (target.subcategory) query.set("subcategory", target.subcategory);

    return new Promise((resolve) => {
        const request = new XMLHttpRequest();

        request.open("POST", `${BASE}/api/guild/${encodeURIComponent(guildId)}/gallery/image?${query}`);
        request.setRequestHeader("Content-Type", file.type);
        request.setRequestHeader("Accept", "application/json");
        request.responseType = "json";

        request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) onProgress("upload", event.loaded / event.total);
        });

        // Alle Bytes sind beim Bot - ab jetzt verkleinert er.
        request.upload.addEventListener("load", () => onProgress("shrink", 1));

        request.addEventListener("load", () => {
            const data = (request.response ?? {}) as { error?: string; image?: { id?: string } };
            const ok = request.status >= 200 && request.status < 300;

            resolve(ok ? { error: null, id: data.image?.id } : { error: reasonOf(request.status, data) });
        });

        request.addEventListener("error", () => resolve({ error: "Der Bot antwortet gerade nicht." }));
        request.send(file);
    });
}
