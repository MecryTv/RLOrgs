import { Events } from "discord.js";
import BotClient from "../client/BotClient";
import IEvent from "../interfaces/events/IEvent";
import IEventOptions from "../interfaces/events/IEventOptions";

export default class Event implements IEvent {
    client: BotClient;
    name: Events;
    description: string;
    once: boolean;

    constructor(client: BotClient, options: IEventOptions) {
        this.client = client;
        this.name = options.name;
        this.description = options.description;
        this.once = options.once;
    }

    async Execute(...args: any[]): Promise<void> {}
}