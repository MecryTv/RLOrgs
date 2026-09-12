import Model from "../structures/Model";
import { OrNull, TABLES, TableName } from "../constants/Database";

/** Gruppen, die in der Datenbank stehen. "developer" und "testphase" nicht - siehe Migration 002. */
export const STORED_GROUPS = ["administrator", "partner", "premium"] as const;

export type StoredGroup = (typeof STORED_GROUPS)[number];

export function IsStoredGroup(value: unknown): value is StoredGroup {
    return typeof value === "string" && (STORED_GROUPS as readonly string[]).includes(value);
}

export interface IDashboardGroupRow {
    user_id: string;
    group_name: StoredGroup;
    granted_by: string | null;
    granted_at: Date;
    note: string | null;
}

/**
 * Wer im Dashboard welche Gruppe hat. Vergeben wird das unter /dashboard/admins,
 * nicht mehr über eine ID-Liste in der Konfiguration.
 */
export default class DashboardGroups extends Model<IDashboardGroupRow> {
    readonly Table: TableName = TABLES.groups;
    readonly Key = ["user_id"] as const;

    /** Die Gruppe eines Nutzers, oder null. Läuft über den Cache. */
    async Of(userId: string): Promise<StoredGroup | null> {
        const row = await this.Find(userId);

        return row?.group_name ?? null;
    }

    /** Alle vergebenen Gruppen, für die Übersicht im Admin-Dashboard. */
    async All(): Promise<IDashboardGroupRow[]> {
        return this.Where({}, "FIELD(group_name, 'administrator', 'partner', 'premium'), granted_at ASC");
    }

    /**
     * Vergibt eine Gruppe oder wechselt sie.
     *
     * Die Notiz wird nur angefasst, wenn wirklich eine mitkommt: sonst wäre sie
     * beim bloßen Wechsel der Gruppe verschwunden, ohne dass jemand sie gelöscht
     * hätte. Ein leerer Text ist ausdrücklich ein Löschen.
     */
    async Grant(userId: string, group: StoredGroup, grantedBy: string, note?: string): Promise<void> {
        const row: Partial<IDashboardGroupRow> = { user_id: userId, group_name: group, granted_by: grantedBy };
        const update: (keyof IDashboardGroupRow & string)[] = ["group_name", "granted_by"];

        if (note !== undefined) {
            row.note = OrNull(note);
            update.push("note");
        }

        await this.Upsert(row, update);
    }

    /** Zurück in die Testphase. Meldet false, wenn es nichts zu entziehen gab. */
    async Revoke(userId: string): Promise<boolean> {
        const result = await this.Delete(userId);

        return result.affectedRows > 0;
    }

    /** Wie viele je Gruppe - eine Abfrage statt einer je Gruppe. */
    async Counts(): Promise<Record<StoredGroup, number>> {
        const counts = { administrator: 0, partner: 0, premium: 0 };

        const rows = await this.db.Cached(this.Table, "counts", () =>
            this.db.Query<{ group_name: StoredGroup; total: number }>(
                `SELECT group_name, COUNT(*) AS total FROM \`${this.Table}\` GROUP BY group_name`
            )
        );

        for (const row of rows) counts[row.group_name] = Number(row.total);

        return counts;
    }
}
