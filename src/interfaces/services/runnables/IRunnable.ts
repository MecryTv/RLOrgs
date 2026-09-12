import BotClient from "../../../client/BotClient";
import TaskTypes from "../../../enums/TaskTypes";

export default interface IRunnable {
    client: BotClient;

    name: string;
    description: string;
    type: TaskTypes;
    enabled: boolean;

    time: string | null;
    date: string | null;
    expression: string | null;

    Execute(): Promise<void>;
}
