import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { DefaultMessageDoc, DefaultSchedule } from "../constants/Messages";
import { ICustomButton, ICustomMessage, ISchedule } from "../interfaces/services/messages/IMessages";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";

export interface ICustomMessageRow {
    id: number;
    guild_id: string;
    name: string;
    doc: IMessageDoc | string;
    buttons: ICustomButton[] | string;
    channel_id: string | null;
    message_id: string | null;
    schedule: ISchedule | string;
    created_by: string;
    created_at: number | string;
    updated_at: number | string;
}

function ToMessage(row: ICustomMessageRow): ICustomMessage {
    return {
        id: Number(row.id),
        guildId: row.guild_id,
        name: row.name,
        doc: Unpack<IMessageDoc>(row.doc, DefaultMessageDoc()),
        buttons: Unpack<ICustomButton[]>(row.buttons, []),
        channelId: row.channel_id,
        messageId: row.message_id,
        schedule: { ...DefaultSchedule(), ...Unpack<Partial<ISchedule>>(row.schedule, {}) },
        createdBy: row.created_by,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    };
}

/** Die eigenen Nachrichten eines Servers. */
export default class CustomMessages extends Model<ICustomMessageRow> {
    readonly Table: TableName = TABLES.customMessages;
    readonly Key = ["id"] as const;

    async Create(input: Pick<ICustomMessage, "guildId" | "name" | "doc" | "buttons" | "channelId" | "schedule" | "createdBy">): Promise<ICustomMessage> {
        const now = Date.now();
        const result = await this.Insert({
            guild_id: input.guildId,
            name: input.name,
            doc: JSON.stringify(input.doc),
            buttons: JSON.stringify(input.buttons),
            channel_id: input.channelId,
            message_id: null,
            schedule: JSON.stringify(input.schedule),
            created_by: input.createdBy,
            created_at: now,
            updated_at: now,
        });

        return (await this.Get(Number(result.insertId)))!;
    }

    async Get(id: number): Promise<ICustomMessage | null> {
        const row = await this.Find(id);

        return row ? ToMessage(row) : null;
    }

    async OfGuild(guildId: string): Promise<ICustomMessage[]> {
        return (await this.Where({ guild_id: guildId }, "id DESC")).map(ToMessage);
    }

    async Save(id: number, patch: Partial<Pick<ICustomMessage, "name" | "doc" | "buttons" | "channelId" | "messageId" | "schedule">>): Promise<void> {
        const row: Partial<ICustomMessageRow> = { updated_at: Date.now() };

        if (patch.name !== undefined) row.name = patch.name;
        if (patch.doc !== undefined) row.doc = JSON.stringify(patch.doc);
        if (patch.buttons !== undefined) row.buttons = JSON.stringify(patch.buttons);
        if (patch.channelId !== undefined) row.channel_id = patch.channelId;
        if (patch.messageId !== undefined) row.message_id = patch.messageId;
        if (patch.schedule !== undefined) row.schedule = JSON.stringify(patch.schedule);

        await this.Update([id], row);
    }

    async Remove(id: number): Promise<void> {
        await this.Delete(id);
    }

    /** Was bis jetzt raus soll - für den Lauf jede Minute. */
    async Due(now: number): Promise<ICustomMessage[]> {
        const rows = await this.db.Query<ICustomMessageRow>(
            `SELECT * FROM \`${this.Table}\` WHERE JSON_EXTRACT(schedule, '$.next') IS NOT NULL AND JSON_EXTRACT(schedule, '$.next') <= ?`,
            [now]
        );

        return rows.map(ToMessage);
    }
}
