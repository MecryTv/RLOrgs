/** Die eine Abfrage, von der jede Seite lebt: /api/me. */
import { IPayload } from "../interfaces/IUser.js";
import { BASE, url } from "./Base.js";

// Läuft schon eine Umleitung zum Login? Dann ist ein leeres Ergebnis kein
// Fehler, sondern der Weg dorthin - und die Seite soll keine Fehlermeldung
// zeigen, die im nächsten Moment ohnehin verschwindet.
let leaving = false;

export function redirecting(): boolean {
    return leaving;
}

export async function load(): Promise<IPayload | null> {
    let response: Response;

    try {
        response = await fetch(url("/api/me"), { headers: { Accept: "application/json" } });
    } catch {
        return null;
    }

    // Sitzung abgelaufen oder von Discord zurückgezogen: direkt neu anmelden.
    if (response.status === 401) {
        leaving = true;
        window.location.href = `${BASE}/login?return=${encodeURIComponent(window.location.pathname)}`;

        return null;
    }

    if (!response.ok) return null;

    return (await response.json()) as IPayload;
}
