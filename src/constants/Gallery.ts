import path from "path";
import { isIP } from "node:net";

export const GALLERY_ROOT = path.join(process.cwd(), "src", "images");

export const DEFAULT_SCOPE = "default";

export const PRIVATE_SCOPE = "privacy";

export const IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
} as const;

export type ImageExtension = keyof typeof IMAGE_TYPES;

export function IsScope(value: string): boolean {
    return value === DEFAULT_SCOPE || /^\d{17,20}$/.test(value);
}

export function SanitizeName(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

export function IsImageFile(file: string): boolean {
    return path.extname(file).toLowerCase() in IMAGE_TYPES;
}

export function TypeOf(file: string): string | null {
    return IMAGE_TYPES[path.extname(file).toLowerCase() as ImageExtension] ?? null;
}

export function ResolveImagePath(relative: string): string | null {
    const file = path.resolve(GALLERY_ROOT, relative);

    if (!file.startsWith(GALLERY_ROOT + path.sep)) return null;

    return TypeOf(file) ? file : null;
}

export function IsPrivateHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;

    const version = isIP(host);

    if (version === 4) {
        const [first, second] = host.split(".").map(Number);

        return (
            first === 0 ||
            first === 10 ||
            first === 127 ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168)
        );
    }

    if (version === 6) {
        return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
    }

    return false;
}

export function ParseSource(url: string): URL {
    let source: URL;

    try {
        source = new URL(url);
    } catch {
        throw new Error("Das ist keine gültige URL.");
    }

    if (source.protocol !== "https:") throw new Error("Nur https-URLs werden akzeptiert.");
    if (IsPrivateHost(source.hostname)) throw new Error("Diese Adresse liegt im internen Netz.");

    return source;
}
