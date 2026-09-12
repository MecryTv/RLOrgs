import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { IJWTPayload } from "../interfaces/server/IJWT";

const ALGORITHM = "HS256";
const TYPE = "JWT";

export const MIN_SECRET_LENGTH = 32;

function Encode(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function Decode(value: string): any {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function Signature(data: string, secret: string): string {
    return createHmac("sha256", secret).update(data).digest("base64url");
}

export function GenerateSecret(): string {
    return randomBytes(48).toString("base64url");
}

export function IsUsableSecret(secret: string | undefined): boolean {
    return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

export function AssertSecret(secret: string | undefined): void {
    if (IsUsableSecret(secret)) return;

    throw new Error(
        `SERVER_JWT_SECRET fehlt oder ist kürzer als ${MIN_SECRET_LENGTH} Zeichen. ` +
            `Ein neues erzeugst du mit: npm run token -- --secret`
    );
}

export function CreateToken(secret: string, subject: string, lifetime: number, scope: string[] = []): string {
    AssertSecret(secret);

    if (!subject.trim()) throw new Error("Ein Token braucht einen Empfänger (--sub).");
    if (!Number.isFinite(lifetime) || lifetime <= 0) throw new Error("Die Gültigkeit muss größer als 0 sein.");

    const issued = Math.floor(Date.now() / 1000);

    const payload: IJWTPayload = {
        sub: subject.trim(),
        iat: issued,
        exp: issued + Math.floor(lifetime / 1000),
    };

    if (scope.length > 0) payload.scope = scope;

    const data = `${Encode({ alg: ALGORITHM, typ: TYPE })}.${Encode(payload)}`;

    return `${data}.${Signature(data, secret)}`;
}

export function VerifyToken(token: string, secret: string | undefined): IJWTPayload | null {
    if (!IsUsableSecret(secret)) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;

    const expected = Buffer.from(Signature(`${header}.${body}`, secret as string));
    const received = Buffer.from(signature);

    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

    try {
        const decoded = Decode(header);
        if (decoded?.alg !== ALGORITHM || decoded?.typ !== TYPE) return null;

        const payload = Decode(body) as IJWTPayload;

        if (typeof payload?.sub !== "string" || typeof payload?.exp !== "number") return null;
        if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

        return payload;
    } catch {
        return null;
    }
}
