import { Collection } from "discord.js";
import Runnable from "../../../structures/Runnable";
import IRunnable from "./IRunnable";

export interface ITaskState {
    nextRun: Date | null;
    lastRun: Date | null;
    retryCount: number;
    isRunning: boolean;
}

export default interface IRunnableService {
    runnables: Collection<string, Runnable>;

    Initialize(): Promise<void>;
    Stop(): void;

    State(name: string): ITaskState | null;
    ProcessDueTasks(): Promise<void>;
    RunNow(name: string): Promise<boolean>;
    CalculateNextRun(runnable: IRunnable, from?: Date): Date | null;
}
