import BotClient from "../client/BotClient";
import TaskTypes from "../enums/TaskTypes";
import IRunnable from "../interfaces/services/runnables/IRunnable";
import IRunnableOptions from "../interfaces/services/runnables/IRunnableOptions";

export default abstract class Runnable implements IRunnable {
    client: BotClient;
    name: string;
    description: string;
    type: TaskTypes;
    enabled: boolean;

    time: string | null;
    date: string | null;
    expression: string | null;

    constructor(client: BotClient, options: IRunnableOptions) {
        this.client = client;
        this.name = options.name;
        this.description = options.description;
        this.type = options.type;
        this.enabled = options.enabled ?? true;

        this.time = "time" in options ? options.time : null;
        this.date = "date" in options ? options.date : null;
        this.expression = "expression" in options ? options.expression : null;
    }

    abstract Execute(): Promise<void>;
}
