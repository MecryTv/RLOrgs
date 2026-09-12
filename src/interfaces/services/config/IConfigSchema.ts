export type FieldType = "string" | "number" | "boolean" | "object" | "array";

export interface IFieldSchema {
    type: FieldType;
    optional?: boolean;
    of?: IFieldSchema;
    shape?: Record<string, IFieldSchema>;
    entries?: IFieldSchema;
}

export type IConfigSchema = Record<string, IFieldSchema>;
