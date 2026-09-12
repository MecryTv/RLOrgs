import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AssertSecret, IsUsableSecret } from "./jwt";

// AES-256-GCM: verschlüsselt *und* signiert in einem. Ein verändertes Byte lässt
// die Entschlüsselung scheitern - eine getrennte Signaturprüfung braucht es nicht.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// Der Schlüssel wird aus SERVER_JWT_SECRET abgeleitet. Ein zweites Geheimnis wäre
// nur eine weitere Sache, die beim Deployment fehlen kann. Das Präfix trennt ihn
// sauber von der JWT-Nutzung desselben Secrets.
function KeyFrom(secret: string): Buffer {
    // Der Text bleibt beim alten Projektnamen: er geht in die Schlüsselableitung
    // ein, und ein anderer Wert würde jedes bestehende Cookie unlesbar machen.
    return createHash("sha256").update(`rlorgs:seal:v1:${secret}`).digest();
}

/**
 * Packt ein Objekt in eine verschlüsselte Zeichenkette, die im Cookie Platz hat.
 * Der Inhalt ist für den Browser undurchsichtig - dort landet kein Klartext-Token.
 */
export function Seal(value: unknown, secret: string): string {
    AssertSecret(secret);

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, KeyFrom(secret), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);

    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/**
 * Gegenstück zu Seal. Gibt null zurück, sobald irgendetwas nicht stimmt:
 * falsches Secret, verändertes Cookie, abgeschnittene Daten oder kaputtes JSON.
 * Ein Fehler ist hier nie eine Ausnahme, sondern schlicht "keine Sitzung".
 */
export function Open<T>(sealed: string, secret: string | undefined): T | null {
    if (!IsUsableSecret(secret) || !sealed) return null;

    try {
        const raw = Buffer.from(sealed, "base64url");

        if (raw.length <= IV_LENGTH + TAG_LENGTH) return null;

        const decipher = createDecipheriv(ALGORITHM, KeyFrom(secret as string), raw.subarray(0, IV_LENGTH));

        decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));

        const body = Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]);

        return JSON.parse(body.toString("utf8")) as T;
    } catch {
        return null;
    }
}
