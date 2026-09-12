import ChronicleLogger from "../handler/ChronicleLogger";
import LogLevel from "../enums/LogLevel";

const logger = new ChronicleLogger({
    namespace: "bot",
    level: process.argv.includes("--dev") ? LogLevel.DEBUG : LogLevel.INFO,
    reportVersionsOf: ["discord.js"],
    version: "1.0.0",
    developer: "MecryTv",
    engine: "Node.js + Discord.js",
    language: "TypeScript",
});

export default logger;
export { ChronicleLogger, LogLevel };