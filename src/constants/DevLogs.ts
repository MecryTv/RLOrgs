import path from "path";

export const PAGE_SIZE = 1500;

export const MAX_SEARCH_RESULTS = 30;

export const MAX_SEARCH_TERM = 100;

export const MAX_INLINE_BYTES = 5 * 1024 * 1024;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const RESET = "\x1b[0m";
const RED = "\x1b[0;31m";
const YELLOW = "\x1b[0;33m";
const GREEN = "\x1b[0;32m";

export function ResolveLogPath(directory: string, file: string): string | null {
    if (!file) return null;

    const root = path.resolve(directory);
    const full = path.resolve(root, file);

    return full.startsWith(root + path.sep) ? full : null;
}

export function FormatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "?";

    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);

    const parts: string[] = [];

    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${total % 60}s`);

    return parts.join(" ");
}

export function Colorize(line: string): string {
    if (line.includes("ERROR")) return `${RED}${line}${RESET}`;
    if (line.includes("WARN")) return `${YELLOW}${line}${RESET}`;
    if (line.includes("SESSION")) return `${GREEN}${line}${RESET}`;

    return line;
}

export function Clamp(value: number, max: number): number {
    return Math.min(Math.max(value, 0), Math.max(max, 0));
}

export function PagesFor(size: number): number {
    return Math.max(Math.ceil(size / PAGE_SIZE), 1);
}
