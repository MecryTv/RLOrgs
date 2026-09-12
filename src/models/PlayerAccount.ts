import Model from "../structures/Model";
import { OrNull, Platform, TABLES, TableName } from "../constants/Database";

export interface IPlayerAccountRow {
    user_id: string;
    platform: Platform;
    account_id: string;
    display_name: string | null;
    verified: number;
    linked_at: Date;
    changed_at: Date;
}

/** Was einer Änderung im Weg steht - oder eben nicht. */
export interface ICooldown {
    /** true, wenn jetzt geändert werden darf. */
    open: boolean;
    /** Millisekunden bis zur nächsten erlaubten Änderung. 0, wenn offen. */
    waitMs: number;
    /** Wann es wieder geht - ISO-8601, null wenn es jetzt geht. */
    until: string | null;
}

/**
 * Verknüpfte Spielerkonten: Discord-Nutzer zu Epic, Steam, Xbox, PSN oder Switch.
 *
 * "verified" ist 1, sobald die Rocket-League-API den Namen bestätigt hat - beim
 * Epic-Konto passiert genau das beim Verknüpfen.
 */
export default class PlayerAccount extends Model<IPlayerAccountRow> {
    readonly Table: TableName = TABLES.accounts;
    readonly Key = ["user_id", "platform"] as const;

    async Of(userId: string): Promise<IPlayerAccountRow[]> {
        return this.Where({ user_id: userId }, "`platform` ASC");
    }

    async On(userId: string, platform: Platform): Promise<IPlayerAccountRow | null> {
        return this.Find(userId, platform);
    }

    /**
     * Verknüpft ein Konto oder wechselt es. "changed_at" wird ausdrücklich
     * mitgeschrieben - daran hängt die Sperrfrist.
     */
    async Link(
        userId: string,
        platform: Platform,
        accountId: string,
        displayName?: string,
        verified = false
    ): Promise<void> {
        await this.Upsert(
            {
                user_id: userId,
                platform,
                account_id: accountId,
                display_name: OrNull(displayName),
                verified: verified ? 1 : 0,
                changed_at: new Date(),
            },
            ["account_id", "display_name", "verified", "changed_at"]
        );
    }

    async Unlink(userId: string, platform: Platform): Promise<boolean> {
        const result = await this.Delete(userId, platform);

        return result.affectedRows > 0;
    }

    /**
     * Wie lange eine Änderung noch gesperrt ist.
     *
     * Gerechnet wird gegen changed_at. Gibt es noch keine Verknüpfung, ist der
     * Weg frei - die Sperre gilt dem Wechseln, nicht dem ersten Verbinden.
     */
    async Cooldown(userId: string, platform: Platform, windowMs: number): Promise<ICooldown> {
        const open: ICooldown = { open: true, waitMs: 0, until: null };
        const row = await this.On(userId, platform);

        if (!row) return open;

        const changed = new Date(row.changed_at).getTime();

        // Ein unlesbarer Zeitstempel darf niemanden aussperren.
        if (Number.isNaN(changed)) return open;

        const until = changed + windowMs;
        const waitMs = until - Date.now();

        if (waitMs <= 0) return open;

        return { open: false, waitMs, until: new Date(until).toISOString() };
    }

    /** Rückwärts: welcher Discord-Nutzer steckt hinter diesem Spielernamen? */
    async Owner(platform: Platform, accountId: string): Promise<string | null> {
        const rows = await this.Where({ platform, account_id: accountId });

        return rows[0]?.user_id ?? null;
    }
}
