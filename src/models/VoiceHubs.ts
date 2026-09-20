import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { DefaultHubConfig } from "../constants/Voice";
import { IHubConfig, IVoiceHub } from "../interfaces/services/voice/IVoice";

export interface IVoiceHubRow {
    id: number;
    guild_id: string;
    channel_id: string;
    config: IHubConfig | string;
    created_by: string;
    created_at: number | string;
}

function ToHub(row: IVoiceHubRow): IVoiceHub {
    return {
        id: Number(row.id),
        guildId: row.guild_id,
        channelId: row.channel_id,
        config: { ...DefaultHubConfig(), ...Unpack<Partial<IHubConfig>>(row.config, {}) },
        createdBy: row.created_by,
        createdAt: Number(row.created_at),
    };
}

/** Die "Hier klicken"-Kanäle eines Servers. */
export default class VoiceHubs extends Model<IVoiceHubRow> {
    readonly Table: TableName = TABLES.voiceHubs;
    readonly Key = ["id"] as const;

    async Create(input: Pick<IVoiceHub, "guildId" | "channelId" | "config" | "createdBy">): Promise<IVoiceHub> {
        const result = await this.Insert({
            guild_id: input.guildId,
            channel_id: input.channelId,
            config: JSON.stringify(input.config),
            created_by: input.createdBy,
            created_at: Date.now(),
        });

        return (await this.Get(Number(result.insertId)))!;
    }

    async Get(id: number): Promise<IVoiceHub | null> {
        const row = await this.Find(id);

        return row ? ToHub(row) : null;
    }

    async OfGuild(guildId: string): Promise<IVoiceHub[]> {
        return (await this.Where({ guild_id: guildId }, "id ASC")).map(ToHub);
    }

    /** Ist dieser Sprachkanal ein Hub? Der Beitritt fragt das bei jedem Wechsel. */
    async ByChannel(channelId: string): Promise<IVoiceHub | null> {
        const rows = await this.Where({ channel_id: channelId });

        return rows[0] ? ToHub(rows[0]) : null;
    }

    async SaveConfig(id: number, config: IHubConfig): Promise<void> {
        await this.Update([id], { config: JSON.stringify(config) } as Partial<IVoiceHubRow>);
    }
}
