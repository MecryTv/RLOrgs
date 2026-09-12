import path from "path";
import { Interaction } from "discord.js";
import BotClient from "./client/BotClient";
import IGuardian from "./interfaces/services/guardian/IGuardian";
import ComponentV2Builder from "./builder/ComponentV2Builder";
import logger from "./utils/logger";

export default class Guardian implements IGuardian {
    client: BotClient;

    constructor(client: BotClient) {
        this.client = client;
    }

    Initialize(): void {
        this._initializeGlobalHandlers();
        logger.guardian("info", "✅  Guardian is operational");
    }

    private _initializeGlobalHandlers(): void {
        process.on("unhandledRejection", (reason) => {
            logger.guardian("error", "Unhandled Rejection erfasst:", reason);

            const error =
                reason instanceof Error
                    ? reason
                    : new Error(String(reason ?? "Unbekannter Promise Rejection Grund"));

            this.ReportError(error, null, "Unhandled Rejection").catch(() => {});
        });

        process.on("uncaughtException", (err, origin) => {
            logger.guardian("error", `Uncaught Exception erfasst: ${err}`, `Origin: ${origin}`);

            this.ReportError(err, null, "Uncaught Exception")
                .catch(() => {})
                .finally(() => process.exit(1));
        });
    }

    private _clamp(value: string | undefined, max: number): string {
        const text = value?.trim();
        if (!text) return "N/A";
        return text.length > max ? `${text.substring(0, max)}…` : text;
    }

    private async _sendUserReply(interaction: Interaction, errorId: string): Promise<void> {
        if (!interaction.isRepliable()) return;

        try {
            const replyMSG = new ComponentV2Builder({ accentColor: "Red" })
                .title("🛠️ | Oops, da ist etwas schiefgelaufen")
                .separator()
                .text(`Ein unerwarteter Fehler ist aufgetreten.\n**Fehler ID:** \`${errorId}\``)
                .subtext("Melde dich beim Team und gib die Fehler ID an, damit dir schnell geholfen wird.")
                .toMessage({ ephemeral: true });

            if (interaction.replied || interaction.deferred) await interaction.followUp(replyMSG);
            else await interaction.reply(replyMSG);
        } catch (error) {
            logger.guardian("error", `Fehler beim Senden der Antwort an den Benutzer: ${error}`);
        }
    }

    private _parseStackForLocation(error: Error) {
        if (!error.stack) return null;

        const stackLines = error.stack.split("\n").slice(1);
        const relevantLine = stackLines.find((line) => !line.includes("Guardian."));

        if (!relevantLine) return null;

        const locationMatch = relevantLine.match(/\((.*?)\)/);

        if (!locationMatch || !locationMatch[1]) return null;

        const fullPath = locationMatch[1];
        const parts = fullPath.split(":");
        const line = parts[parts.length - 2] || "N/A";
        const filePath = parts.slice(0, parts.length - 2).join(":") || "N/A";
        const fileName = path.basename(filePath) || "N/A";

        return { fileName, filePath, line };
    }

    GenErrorID(): string {
        const timestamp = Math.floor(Date.now() / 1000);
        const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
        return `EarthCraft-${timestamp}-${randomPart}`;
    }

    async ReportError(error: Error, interaction: Interaction | null, type = "Unknown Error"): Promise<void> {
        const errorCode = (error as Error & { code?: number | string }).code;
        const normalizedCode = typeof errorCode === "string" ? Number(errorCode) : errorCode;

        if (typeof normalizedCode === "number" && [10062, 10008, 40060].includes(normalizedCode)) {
            return logger.guardian(
                "warn",
                `Ignored expired/already-acknowledged interaction [${errorCode}] in ${type} (Nutzer war vermutlich zu langsam oder hat doppelt geklickt).`
            );
        }

        const errorId = this.GenErrorID();

        logger.guardian("error", `Fehler gefunden [ID: ${errorId}] | Type: ${type}:`, error);

        const location = this._parseStackForLocation(error);
        if (location) {
            logger.guardian(
                "error",
                `📍 Error location: ${location.fileName} (line: ${location.line}) | Path: ${location.filePath}`
            );
        }

        // Der Fehlerbericht geht derzeit nur in Konsole und Logdatei. Der Weg
        // nach Discord kommt zurück, sobald er ordentlich gebaut ist - der alte
        // Ein-Kanal-Ansatz über ERROR_LOG_CHANNEL_ID ist raus.
        if (interaction) await this._sendUserReply(interaction, errorId);
    }

    async HandleCommand(
        errorMSG: string,
        interaction: Interaction | null,
        type = "Command Logic Error"
    ): Promise<void> {
        await this.ReportError(new Error(errorMSG), interaction, type);
    }

    async HandleEvent(errorMSG: string, context: { eventName?: string }): Promise<void> {
        const type = context?.eventName ? `Event Logic Error: ${context.eventName}` : "Event Logic Error";
        await this.ReportError(new Error(errorMSG), null, type);
    }

    async HandleGeneric(errorMSG: string, type = "Generic Error", stackTrace: string | null = null): Promise<void> {
        const error = new Error(errorMSG);
        if (stackTrace) error.stack = stackTrace;
        await this.ReportError(error, null, type);
    }

    async HandleRLAPI(errorMSG: string, context: { endpoint?: string }): Promise<void> {
        const error = new Error(errorMSG);
        const type = context?.endpoint ? `RLAPI Error: ${context.endpoint}` : "RLAPI Error";
        await this.ReportError(error, null, type);
    }

    async HandleRunnable(errorMSG: string, context: { taskName?: string; stack?: string }): Promise<void> {
        const error = new Error(errorMSG);
        if (context?.stack) error.stack = context.stack;
        const type = context?.taskName ? `Runnable Error: ${context.taskName}` : "Runnable Error";
        await this.ReportError(error, null, type);
    }

    async HandleServer(errorMSG: string, context: { route?: string; stack?: string }): Promise<void> {
        const error = new Error(errorMSG);
        if (context?.stack) error.stack = context.stack;
        const type = context?.route ? `Server Error: ${context.route}` : "Server Error";
        await this.ReportError(error, null, type);
    }
}
