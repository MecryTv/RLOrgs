const DURATION_PATTERN = /^(\d+)\s*(ms|s|m|h|d|w)$/i;

const DURATION_UNITS: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
};

export function ParseDuration(value: string | null): number | null {
    const match = DURATION_PATTERN.exec(value?.trim() ?? "");
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = DURATION_UNITS[match[2].toLowerCase()];

    return amount > 0 && unit ? amount * unit : null;
}
