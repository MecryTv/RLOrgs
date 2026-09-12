export interface ISessionEntry {
    sessionNumber: number;
    files: string[];
    startedAt: string;
    endedAt: string | null;
    exitReason: string | null;
    crashed: boolean;
    commandCount: number | null;
    eventCount: number | null;
}

export default interface ISessionManifest {
    totalRestarts: number;
    lastStartedAt: string | null;
    lastEndedAt: string | null;
    lastCommandNames: string[];
    lastEventFiles: string[];
    lastFileHashes: Record<string, string>;
    sessions: ISessionEntry[];
}