import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { DefaultModConfig } from "../constants/Moderation";
import { IModConfig } from "../interfaces/services/moderation/IModeration";

export interface IModSettingsRow {
    guild_id: string;
    config: Partial<IModConfig> | string;
    created_at: Date;
    updated_at: Date;
}

/** Die Einstellungen der Moderation je Server - eine JSON-Zeile wie bei den Tickets. */
export default class ModSettings extends Model<IModSettingsRow> {
    readonly Table: TableName = TABLES.modSettings;
    readonly Key = ["guild_id"] as const;

    /** Immer vollständig: was eine ältere Zeile nicht kennt, kommt aus den Standardwerten. */
    async Of(guildId: string): Promise<IModConfig> {
        const row = await this.Find(guildId);

        return { ...DefaultModConfig(), ...structuredClone(Unpack<Partial<IModConfig>>(row?.config, {})) };
    }

    async Save(guildId: string, config: IModConfig): Promise<void> {
        await this.Upsert({ guild_id: guildId, config: JSON.stringify(config) }, ["config"]);
    }
}
