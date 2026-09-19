import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { DefaultStreamConfig } from "../constants/Streams";
import { IStreamConfig, IStreamNotifier, IStreamState, StreamPlatform } from "../interfaces/services/community/ICommunity";

export interface IStreamNotifierRow {
    id: number;
    guild_id: string;
    platform: StreamPlatform;
    account_id: string;
    account_name: string;
    account_login: string | null;
    avatar: string | null;
    enabled: number;
    config: IStreamConfig | string;
    state: IStreamState | string;
    created_by: string;
    created_at: number | string;
}

function ToNotifier(row: IStreamNotifierRow): IStreamNotifier {
    return {
        id: Number(row.id),
        guildId: row.guild_id,
        platform: row.platform,
        accountId: row.account_id,
        accountName: row.account_name,
        accountLogin: row.account_login,
        avatar: row.avatar,
        enabled: Boolean(Number(row.enabled)),
        config: { ...DefaultStreamConfig(row.platform), ...Unpack<Partial<IStreamConfig>>(row.config, {}) },
        state: Unpack<IStreamState>(row.state, {}),
        createdBy: row.created_by,
        createdAt: Number(row.created_at),
    };
}

/** Die Streamer und Kanäle, die ein Server verfolgt. */
export default class StreamNotifiers extends Model<IStreamNotifierRow> {
    readonly Table: TableName = TABLES.streamNotifiers;
    readonly Key = ["id"] as const;

    async Create(input: Pick<IStreamNotifier, "guildId" | "platform" | "accountId" | "accountName" | "accountLogin" | "avatar" | "config" | "state" | "createdBy">): Promise<IStreamNotifier> {
        const result = await this.Insert({
            guild_id: input.guildId,
            platform: input.platform,
            account_id: input.accountId,
            account_name: input.accountName.slice(0, 100),
            account_login: input.accountLogin?.slice(0, 100) ?? null,
            avatar: input.avatar?.slice(0, 512) ?? null,
            enabled: 1,
            config: JSON.stringify(input.config),
            state: JSON.stringify(input.state),
            created_by: input.createdBy,
            created_at: Date.now(),
        });

        return (await this.Get(Number(result.insertId)))!;
    }

    async Get(id: number): Promise<IStreamNotifier | null> {
        const row = await this.Find(id);

        return row ? ToNotifier(row) : null;
    }

    async OfGuild(guildId: string, platform: StreamPlatform): Promise<IStreamNotifier[]> {
        return (await this.Where({ guild_id: guildId, platform }, "id ASC")).map(ToNotifier);
    }

    /** Alle eingeschalteten einer Plattform - für den minütlichen Lauf, am Cache vorbei. */
    async Active(platform: StreamPlatform): Promise<IStreamNotifier[]> {
        const rows = await this.db.Query<IStreamNotifierRow>(`SELECT * FROM \`${this.Table}\` WHERE platform = ? AND enabled = 1`, [platform]);

        return rows.map(ToNotifier);
    }

    async SaveConfig(id: number, config: IStreamConfig, enabled: boolean): Promise<void> {
        await this.Update([id], { config: JSON.stringify(config), enabled: enabled ? 1 : 0 } as Partial<IStreamNotifierRow>);
    }

    async SaveState(id: number, state: IStreamState): Promise<void> {
        await this.Update([id], { state: JSON.stringify(state) } as Partial<IStreamNotifierRow>);
    }

    /** Name und Bild ändern sich bei Twitch und YouTube - die ID bleibt. */
    async Rename(id: number, name: string, login: string | null, avatar: string | null): Promise<void> {
        await this.Update([id], { account_name: name.slice(0, 100), account_login: login?.slice(0, 100) ?? null, avatar: avatar?.slice(0, 512) ?? null });
    }
}
