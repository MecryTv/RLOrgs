import LogLevel from "../../enums/LogLevel";


export default interface ILoggerOptions {
    namespace?: string;
    rootDirectory?: string;
    logDirectory?: string;
    level?: LogLevel;
    sessionTracking?: boolean;
    maxLinesPerPart?: number;
    maxBytesPerPart?: number;
    sessionsPerPage?: number;
    shutdownTimeoutMs?: number;
    reportVersionsOf?: string[];
    scanExtensions?: string[];
    scanExcludeDirs?: string[];
    version?: string;
    developer?: string;
    engine?: string;
    language?: string;
}