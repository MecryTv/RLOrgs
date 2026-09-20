import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { DefaultVoiceSettings, MAX_PRESETS } from "../constants/Voice";
import { IVoicePreset, IVoiceSettings } from "../interfaces/services/voice/IVoice";

export interface IVoicePresetRow {
    id: number;
    user_id: string;
    name: string;
    config: IVoiceSettings | string;
    is_default: number;
    created_at: number | string;
}

function ToPreset(row: IVoicePresetRow): IVoicePreset {
    return {
        id: Number(row.id),
        userId: row.user_id,
        name: row.name,
        config: { ...DefaultVoiceSettings(), ...Unpack<Partial<IVoiceSettings>>(row.config, {}) },
        isDefault: Boolean(Number(row.is_default)),
        createdAt: Number(row.created_at),
    };
}

/** Die gespeicherten Einstellungen eines Users - sie gelten auf jedem Server. */
export default class VoicePresets extends Model<IVoicePresetRow> {
    readonly Table: TableName = TABLES.voicePresets;
    readonly Key = ["id"] as const;

    async Of(userId: string): Promise<IVoicePreset[]> {
        return (await this.Where({ user_id: userId }, "id ASC")).map(ToPreset);
    }

    async Get(id: number): Promise<IVoicePreset | null> {
        const row = await this.Find(id);

        return row ? ToPreset(row) : null;
    }

    /** Das Preset, das beim nächsten eigenen Kanal von selbst gilt. */
    async Default(userId: string): Promise<IVoicePreset | null> {
        const rows = await this.Where({ user_id: userId, is_default: 1 });

        return rows[0] ? ToPreset(rows[0]) : null;
    }

    /** Legt an oder überschreibt das Preset mit diesem Namen. */
    async Save(userId: string, name: string, config: IVoiceSettings): Promise<IVoicePreset> {
        await this.Upsert(
            { user_id: userId, name: name.slice(0, 60), config: JSON.stringify(config), is_default: 0, created_at: Date.now() },
            ["config"]
        );

        return (await this.Of(userId)).find((preset) => preset.name === name.slice(0, 60))!;
    }

    /** Genau eines ist Standard - die anderen verlieren die Markierung. */
    async SetDefault(userId: string, id: number | null): Promise<void> {
        await this.db.Write(`UPDATE \`${this.Table}\` SET is_default = 0 WHERE user_id = ?`, [userId]);

        if (id !== null) await this.db.Write(`UPDATE \`${this.Table}\` SET is_default = 1 WHERE id = ? AND user_id = ?`, [id, userId]);

        this.db.Bump(this.Table);
    }

    async Remove(id: number): Promise<void> {
        await this.Delete(id);
    }

    get Max(): number {
        return MAX_PRESETS;
    }
}
