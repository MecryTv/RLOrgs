import { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import BotClient from "../../client/BotClient";
import Category from "../../enums/Category";
import SlashCommandData from "../../types/ISlashCommandData";

export default interface ICommand {
    client: BotClient;
    name: string;
    description: string;
    category: Category;
    cooldown: number;
    developerOnly: boolean;
    data: SlashCommandData;

    Execute(interaction: ChatInputCommandInteraction): Promise<void>;
    AutoComplete(interaction: AutocompleteInteraction): Promise<void>;
}