import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";

export interface IModuleSettingsRow {
    guild_id: string;
    module: string;
    config: Record<string, unknown> | string;
    created_at: Date;
    updated_at: Date;
}

/** Einstellungen eines Moduls je Server, die zu keinem einzelnen Eintrag gehören - eine JSON-Zeile. */
export default class ModuleSettings extends Model<IModuleSettingsRow> {
    readonly Table: TableName = TABLES.moduleSettings;
    readonly Key = ["guild_id", "module"] as const;

    /** Immer vollständig: was fehlt, kommt aus fallback. */
    async Of<T extends object>(guildId: string, module: string, fallback: T): Promise<T> {
        const row = await this.Find(guildId, module);

        return { ...fallback, ...structuredClone(Unpack<Partial<T>>(row?.config, {})) };
    }

    async Save(guildId: string, module: string, config: object): Promise<void> {
        await this.Upsert({ guild_id: guildId, module, config: JSON.stringify(config) }, ["config"]);
    }
}
