import TaskTypes from "../../../enums/TaskTypes";

interface IRunnableBaseOptions {
    name: string;
    description: string;
    enabled?: boolean;
}

export interface IDailyRunnableOptions extends IRunnableBaseOptions {
    type: TaskTypes.DAILY;
    time: string;
}

export interface IOnceRunnableOptions extends IRunnableBaseOptions {
    type: TaskTypes.ONCE;
    date: string;
    time: string;
}

export interface IIntervalRunnableOptions extends IRunnableBaseOptions {
    type: TaskTypes.INTERVAL;
    expression: string;
}

type IRunnableOptions = IDailyRunnableOptions | IOnceRunnableOptions | IIntervalRunnableOptions;

export default IRunnableOptions;
