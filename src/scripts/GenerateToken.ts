import { IConfig } from "../interfaces/config/IConfig";
import LoadConfig from "../utils/config";
import { CreateToken, GenerateSecret, VerifyToken } from "../utils/jwt";
import { ParseDuration } from "../utils/duration";

const USAGE = [
    "Benutzung:",
    "  npm run token -- --secret                     Erzeugt ein neues SERVER_JWT_SECRET",
    "  npm run token -- --sub <name> [Optionen]      Erzeugt einen Token",
    "",
    "Optionen:",
    "  --expires <dauer>   Gültigkeit, z.B. 30d, 12h, 90m. Standard: SERVER_JWT_EXPIRES_IN",
    "  --scope <a,b>       Kommagetrennte Berechtigungen, landen im Token",
].join("\n");

function Argument(name: string): string | null {
    const index = process.argv.indexOf(`--${name}`);
    if (index === -1) return null;

    const value = process.argv[index + 1];

    return value && !value.startsWith("--") ? value : null;
}

function Fail(message: string): never {
    console.error(`\n${message}\n`);
    process.exit(1);
}

function Main(): void {
    if (process.argv.includes("--secret")) {
        console.log("\nNeues Secret - trage es in der .env unter SERVER_JWT_SECRET ein:\n");
        console.log(`  ${GenerateSecret()}\n`);
        console.log("Achtung: alle bereits ausgegebenen Tokens werden damit ungültig.\n");

        return;
    }

    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        console.log(`\n${USAGE}\n`);

        return;
    }

    let config: IConfig;

    try {
        config = LoadConfig();
    } catch (error) {
        Fail(error instanceof Error ? error.message : String(error));
    }

    const subject = Argument("sub");
    if (!subject) Fail(`Es fehlt --sub.\n\n${USAGE}`);

    const wanted = Argument("expires") ?? config.SERVER_JWT_EXPIRES_IN;
    const lifetime = ParseDuration(wanted);

    if (!lifetime) Fail(`"${wanted}" ist keine gültige Dauer. Erlaubt sind z.B. 30d, 12h, 90m, 45s.`);

    const scope = (Argument("scope") ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

    let token: string;

    try {
        token = CreateToken(config.SERVER_JWT_SECRET, subject, lifetime, scope);
    } catch (error) {
        Fail(error instanceof Error ? error.message : String(error));
    }

    const payload = VerifyToken(token, config.SERVER_JWT_SECRET);

    console.log("");
    console.log(`  Empfänger : ${payload?.sub}`);
    console.log(`  Gültig bis: ${new Date((payload?.exp ?? 0) * 1000).toLocaleString("de-DE")}`);
    console.log(`  Scopes    : ${payload?.scope?.join(", ") || "-"}`);
    console.log("");
    console.log(token);
    console.log("");
    console.log("  Verwendung:  Authorization: Bearer <token>");
    console.log("");
}

Main();
