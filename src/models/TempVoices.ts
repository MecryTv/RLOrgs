import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { DefaultVoiceSettings } from "../constants/Voice";
import { ITempVoice, IVoiceSettings } from "../interfaces/services/voice/IVoice";

export interface ITempVoiceRow {
    channel_id: string;
    guild_id: string;
    hub_id: number | null;
    owner_id: string;
    settings: IVoiceSettings | string;
    created_at: number | string;
}

function ToTemp(row: ITempVoiceRow): ITempVoice {
    return {
        channelId: row.channel_id,
        guildId: row.guild_id,
        hubId: row.hub_id === null ? null : Number(row.hub_id),
        ownerId: row.owner_id,
        settings: { ...DefaultVoiceSettings(), ...Unpack<Partial<IVoiceSettings>>(row.settings, {}) },
        createdAt: Number(row.created_at),
    };
}

/** Die Sprachkanäle, die gerade offen sind. */
export default class TempVoices extends Model<ITempVoiceRow> {
    readonly Table: TableName = TABLES.tempVoices;
    readonly Key = ["channel_id"] as const;

    async Create(input: Pick<ITempVoice, "channelId" | "guildId" | "hubId" | "ownerId" | "settings">): Promise<ITempVoice> {
        await this.Insert({
            channel_id: input.channelId,
            guild_id: input.guildId,
            hub_id: input.hubId,
            owner_id: input.ownerId,
            settings: JSON.stringify(input.settings),
            created_at: Date.now(),
        });

        return (await this.Get(input.channelId))!;
    }

    async Get(channelId: string): Promise<ITempVoice | null> {
        const row = await this.Find(channelId);

        return row ? ToTemp(row) : null;
    }

    async OfGuild(guildId: string): Promise<ITempVoice[]> {
        return (await this.Where({ guild_id: guildId }, "created_at ASC")).map(ToTemp);
    }

    /** Alle offenen Kanäle - beim Start, um aufzuräumen, was den Neustart nicht überlebt hat. */
    async All(): Promise<ITempVoice[]> {
        const rows = await this.db.Query<ITempVoiceRow>(`SELECT * FROM \`${this.Table}\``);

        return rows.map(ToTemp);
    }

    async Save(channelId: string, settings: IVoiceSettings, ownerId?: string): Promise<void> {
        await this.Update([channelId], {
            settings: JSON.stringify(settings),
            ...(ownerId ? { owner_id: ownerId } : {}),
        } as Partial<ITempVoiceRow>);
    }

    async Remove(channelId: string): Promise<void> {
        await this.Delete(channelId);
    }
}
