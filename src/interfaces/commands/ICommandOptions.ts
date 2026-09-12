import Category from "../../enums/Category";

export default interface ICommandOptions {
    name: string;
    description: string;
    category: Category;
    cooldown: number;
    developerOnly: boolean;
}