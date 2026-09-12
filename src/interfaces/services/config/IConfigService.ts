import { StringSelectMenuOptionBuilder } from "discord.js";
import IConfigEntry from "./IConfigEntry";
import IConfigOption from "./IConfigOption";
import IConfigPage from "./IConfigPage";

export type ConfigChangeHandler = (name: string) => void;

export default interface IConfigService {
    readonly Root: string;
    readonly Size: number;
    readonly Keys: string[];
    readonly IsLoaded: boolean;
    readonly IsWatching: boolean;

    Initialize(): Promise<void>;
    Reload(name?: string): Promise<number>;

    Watch(): boolean;
    Unwatch(): void;
    OnChange(handler: ConfigChangeHandler): () => void;

    Has(key: string): boolean;
    Get<T extends IConfigEntry = IConfigEntry>(key: string): T[] | null;
    GetOne<T extends IConfigEntry = IConfigEntry>(key: string): T | null;
    Require<T extends IConfigEntry = IConfigEntry>(key: string): T;

    Options(key: string, field: string): IConfigOption[];
    Option(key: string, field: string, value: string): IConfigOption | null;
    Page(key: string, field: string, page?: number, size?: number): IConfigPage;
    SelectOptions(key: string, field: string, page?: number): StringSelectMenuOptionBuilder[];
    Value<T>(key: string, route: string, fallback: T): T;
}
