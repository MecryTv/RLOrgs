import Model from "../structures/Model";
import { TABLES, TableName, Unpack } from "../constants/Database";
import { DefaultResponseDoc, DefaultResponseSettings } from "../constants/Messages";
import { IAutoResponse, IResponseSettings, MatchMode } from "../interfaces/services/messages/IMessages";
import { IMessageDoc } from "../interfaces/builder/IMessageDoc";

export interface IAutoResponseRow {
    id: number;
    guild_id: string;
    phrase: string;
    match_mode: MatchMode;
    doc: IMessageDoc | string;
    settings: IResponseSettings | string;
    enabled: number;
    uses: number;
    created_by: string;
    created_at: number | string;
}

function ToResponse(row: IAutoResponseRow): IAutoResponse {
    return {
        id: Number(row.id),
        guildId: row.guild_id,
        phrase: row.phrase,
        match: row.match_mode,
        doc: Unpack<IMessageDoc>(row.doc, DefaultResponseDoc()),
        settings: { ...DefaultResponseSettings(), ...Unpack<Partial<IResponseSettings>>(row.settings, {}) },
        enabled: Boolean(Number(row.enabled)),
        uses: Number(row.uses),
        createdBy: row.created_by,
        createdAt: Number(row.created_at),
    };
}

/** Die Stichwörter eines Servers und was der Bot darauf antwortet. */
export default class AutoResponses extends Model<IAutoResponseRow> {
    readonly Table: TableName = TABLES.autoResponses;
    readonly Key = ["id"] as const;

    async Create(input: Pick<IAutoResponse, "guildId" | "phrase" | "match" | "doc" | "settings" | "createdBy">): Promise<IAutoResponse> {
        const result = await this.Insert({
            guild_id: input.guildId,
            phrase: input.phrase,
            match_mode: input.match,
            doc: JSON.stringify(input.doc),
            settings: JSON.stringify(input.settings),
            enabled: 1,
            uses: 0,
            created_by: input.createdBy,
            created_at: Date.now(),
        });

        return (await this.Get(Number(result.insertId)))!;
    }

    async Get(id: number): Promise<IAutoResponse | null> {
        const row = await this.Find(id);

        return row ? ToResponse(row) : null;
    }

    async OfGuild(guildId: string): Promise<IAutoResponse[]> {
        return (await this.Where({ guild_id: guildId }, "id ASC")).map(ToResponse);
    }

    async Save(id: number, patch: Partial<Pick<IAutoResponse, "phrase" | "match" | "doc" | "settings" | "enabled">>): Promise<void> {
        const row: Partial<IAutoResponseRow> = {};

        if (patch.phrase !== undefined) row.phrase = patch.phrase;
        if (patch.match !== undefined) row.match_mode = patch.match;
        if (patch.doc !== undefined) row.doc = JSON.stringify(patch.doc);
        if (patch.settings !== undefined) row.settings = JSON.stringify(patch.settings);
        if (patch.enabled !== undefined) row.enabled = patch.enabled ? 1 : 0;

        await this.Update([id], row);
    }

    async Used(id: number): Promise<void> {
        await this.db.Write(`UPDATE \`${this.Table}\` SET uses = uses + 1 WHERE id = ?`, [id]);
        this.db.Bump(this.Table);
    }

    async Remove(id: number): Promise<void> {
        await this.Delete(id);
    }
}
