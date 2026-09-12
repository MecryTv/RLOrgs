import { Interaction } from "discord.js";

export default interface IGuardian {
    Initialize(): void;

    GenErrorID(): string;
    ReportError(error: Error, interaction: Interaction | null, type?: string): Promise<void>;

    HandleCommand(errorMSG: string, interaction: Interaction | null, type?: string): Promise<void>;
    HandleEvent(errorMSG: string, context: { eventName?: string }): Promise<void>;
    HandleGeneric(errorMSG: string, type?: string, stackTrace?: string | null): Promise<void>;
    HandleRLAPI(errorMSG: string, context: { endpoint?: string }): Promise<void>;
    HandleRunnable(errorMSG: string, context: { taskName?: string; stack?: string }): Promise<void>;
    HandleServer(errorMSG: string, context: { route?: string; stack?: string }): Promise<void>;
}
