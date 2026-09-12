import { AnsiCode } from "../../constants/Colors";
import LogLevel from "../../enums/LogLevel";
import { ISessionEntry } from "./ISessionManifest";

export type ShutdownTask = (signal: string) => void | Promise<void>;

export type LogArgs = unknown[];

export interface IModuleDiffInput {
    commandNames?: string[];
    eventFiles?: string[];
}

export default interface ILogger {
    log(level: string, message: string, color: AnsiCode, ...args: LogArgs): void;
    setLevel(level: LogLevel | string): void;
    getTimestamp(): string;

    error(message: string, ...args: LogArgs): void;
    warn(message: string, ...args: LogArgs): void;
    info(message: string, ...args: LogArgs): void;
    debug(message: string, ...args: LogArgs): void;

    success(message: string, ...args: LogArgs): void;
    server(message: string, ...args: LogArgs): void;
    user(message: string, ...args: LogArgs): void;
    tasks(message: string, ...args: LogArgs): void;
    guardian(type: string, message: string, ...args: LogArgs): void;
    http(method: string, url: string, status: number, ...args: LogArgs): void;
    trace(functionName: string, step: string, data?: unknown): void;

    banner(message: string, color?: AnsiCode): void;
    box(message: string, color?: AnsiCode): void;
    table(data: unknown, title?: string | null): void;

    reportModuleDiff(input?: IModuleDiffInput): void;
    reportFileChanges(): void;
    beforeExit(task: ShutdownTask): void;

    getSessionsDirectory(): string;
    getCurrentSessionNumber(): number;
    getCurrentSessionFile(): string | null;
    getSessionHistory(): ISessionEntry[];
    getSessionsPerPage(): number;
    getSessionStartedAt(): Date | null;
    getGitCommit(): string | null;
}