import { IConfigSchema, IFieldSchema } from "../interfaces/services/config/IConfigSchema";

export const OPTION: IFieldSchema = {
    type: "object",
    shape: {
        name: { type: "string" },
        description: { type: "string" },
        value: { type: "string" },
        emoji: { type: "string" },
        channel_type: { type: "string", optional: true },
    },
};

export const OPTIONS: IFieldSchema = { type: "array", of: OPTION };

// Pro JSON-Datei in src/config ein Eintrag. Leer heißt: alles erlaubt.
export const CONFIG_SCHEMAS: Record<string, IConfigSchema> = {};

export function ValidateField(value: unknown, schema: IFieldSchema, path: string, errors: string[]): void {
    if (value === undefined || value === null) {
        if (!schema.optional) errors.push(`${path} fehlt`);
        return;
    }

    if (schema.type === "array") {
        if (!Array.isArray(value)) {
            errors.push(`${path} muss ein Array sein (ist ${typeof value})`);
            return;
        }

        if (schema.of) value.forEach((item, index) => ValidateField(item, schema.of!, `${path}[${index}]`, errors));

        return;
    }

    if (schema.type === "object") {
        if (typeof value !== "object" || Array.isArray(value)) {
            errors.push(`${path} muss ein Objekt sein (ist ${Array.isArray(value) ? "Array" : typeof value})`);
            return;
        }

        const record = value as Record<string, unknown>;

        if (schema.shape) {
            for (const [key, field] of Object.entries(schema.shape)) {
                ValidateField(record[key], field, `${path}.${key}`, errors);
            }
        }

        if (schema.entries) {
            for (const [key, item] of Object.entries(record)) {
                ValidateField(item, schema.entries, `${path}.${key}`, errors);
            }
        }

        return;
    }

    if (typeof value !== schema.type) errors.push(`${path} muss ${schema.type} sein (ist ${typeof value})`);
}

export function ValidateEntry(entry: unknown, schema: IConfigSchema | undefined, path: string): string[] {
    const errors: string[] = [];
    const shape: Record<string, IFieldSchema> = { pagination: { type: "boolean" }, ...(schema ?? {}) };

    ValidateField(entry, { type: "object", shape }, path, errors);

    return errors;
}
