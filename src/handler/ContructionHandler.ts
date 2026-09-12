import BotClient from "../client/BotClient";
import IConstructionHandler from "../interfaces/handlers/IContructionHandler";
import { glob } from "glob";
import path from "path";
import { pathToFileURL } from "node:url";
import Command from "../structures/Command";
import { REST, Routes } from "discord.js";
import logger from "../utils/logger";
import Event from "../structures/Event";

export default class ConstructionHandler implements IConstructionHandler {
    client: BotClient;

    constructor(client: BotClient) {
        this.client = client;
    }

    async LoadEvents(): Promise<void> {
    const files = await glob("**/*.{ts,js}", {
        cwd: path.join(__dirname, "../events"),
        absolute: true,
    });

    let loaded = 0;

    for (const file of files) {
        const imported = await import(pathToFileURL(file).href);
        const EventClass = imported.default?.default ?? imported.default;

        if (typeof EventClass !== "function") {
            logger.error(`Event at ${file} has no default export.`);
            continue;
        }

        const event: Event = new EventClass(this.client);

        if (!event.name) {
            logger.error(`Event at ${file} is missing a name.`);
            continue;
        }

        const execute = (...args: any[]) => event.Execute(...args);

        const emitter = this.client as unknown as {
            on(name: string, listener: (...args: any[]) => void): void;
            once(name: string, listener: (...args: any[]) => void): void;
        };

        if (event.once) emitter.once(event.name, execute);
        else emitter.on(event.name, execute);

        loaded++;
    }

    logger.info(`🚀  ${loaded} Events loaded`);
}

    async LoadCommands(): Promise<void> {
        const files = await glob("**/*.{ts,js}", {
            cwd: path.join(__dirname, "../commands"),
            absolute: true,
        });

        for (const file of files) {
            const imported = await import(pathToFileURL(file).href);
            const CommandClass = imported.default?.default ?? imported.default;

            if (typeof CommandClass !== "function") {
                logger.error(`Command at ${file} has no default export.`);
                continue;
            }

            const command: Command = new CommandClass(this.client);

            if (!command.name || !command.data) {
                logger.error(`Command at ${file} is missing a name or data.`);
                continue;
            }

            this.client.commands.set(command.name, command);
        }

        const { developerMode, config } = this.client;
        const clientId = developerMode ? config.DEV_CLIENT_ID : config.CLIENT_ID;
        const rest = new REST().setToken(developerMode ? config.DEV_CLIENT_TOKEN : config.CLIENT_TOKEN);

        // Teilen sich Dev und Prod eine Application, stehen die global registrierten Befehle
        // neben den Guild-Befehlen des Dev-Modus - Discord zeigt dann jeden davon doppelt.
        if (config.CLIENT_ID === config.DEV_CLIENT_ID) {
            logger.warn("⚠️  CLIENT_ID und DEV_CLIENT_ID sind identisch - Befehle erscheinen im Dev-Server doppelt. Lege im Developer Portal eine eigene Dev-Application an.");
        }

        const globalCommands = this.client.commands.filter((cmd) => !cmd.developerOnly);
        const devCommands = this.client.commands.filter((cmd) => cmd.developerOnly);

        if (!developerMode) {
            await rest.put(Routes.applicationCommands(clientId), {
                body: globalCommands.map((cmd) => cmd.data.toJSON()),
            });
        }

        const guildCommands = developerMode ? this.client.commands : devCommands;

        await rest.put(Routes.applicationGuildCommands(clientId, config.DEV_GUILD_ID), {
            body: guildCommands.map((cmd) => cmd.data.toJSON()),
        });
        logger.info(`🚀  ${guildCommands.size} Guild Commands loaded (${devCommands.size} developer-only)`);
    }
}