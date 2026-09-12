/** Ein Rang aus /api/tracking. */

/** Ein Rang, wie ihn /api/track liefert. */
export interface IRank {
    key: string;
    label: string;
    mmr: number;
    tier: number;
    tierName: string;
    division: number;
    divisionName: string | null;
    matches: number;
    streak: number;
    placement: boolean;
    placementMatches: number;
}
