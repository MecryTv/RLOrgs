import { Collection } from "discord.js";
import Command from "../../structures/Command";
import { IConfig } from "../config/IConfig";

export default interface IBotClient {
    config: IConfig;

    commands: Collection<string, Command>;
    cooldowns: Collection<string, Collection<string, number>>;
    developerMode: boolean;

    Init(): void;
    LoadContructionHandlers(): Promise<void>;
}