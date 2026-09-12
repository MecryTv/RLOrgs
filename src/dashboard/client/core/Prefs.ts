/** Einstellungen: ein Schluessel, ein Objekt, im Browser des Nutzers. */

/* ----------------------------------------------------------
   Einstellungen: ein Schlüssel, ein Objekt, im Browser des Nutzers
   ---------------------------------------------------------- */
export const systemReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface IPrefs {
    sound: boolean;
    volume: number;
    motion: boolean;
    toasts: boolean;
}

export const PREFS_KEY = "rlnexus.prefs";
export const PREFS_DEFAULT: IPrefs = {
    sound: true,
    volume: 60,
    motion: true,
    toasts: true,
};

// Das Projekt hieß einmal RLOrgs. Wer von damals noch Einstellungen im Browser
// hat, soll sie behalten: beim ersten Laden zieht der alte Schlüssel einmal auf
// den neuen um und wird dann gelöscht.
export function migrateKey(from: string, to: string): void {
    try {
        const old = window.localStorage.getItem(from);

        if (old !== null && window.localStorage.getItem(to) === null) window.localStorage.setItem(to, old);
        if (old !== null) window.localStorage.removeItem(from);
    } catch {
        // Kein Speicher, kein Umzug - dann gelten die Standardwerte.
    }
}

migrateKey("rlorgs.prefs", "rlnexus.prefs");

// Das alte Postfach lag im Browser. Es liegt jetzt beim Bot - der Rest kann weg.
try {
    window.localStorage.removeItem("rlorgs.notes");
    window.localStorage.removeItem("rlnexus.notes");
} catch {
    // Kein Speicher, nichts aufzuräumen.
}

// Im privaten Modus wirft localStorage - dann gelten für diese Sitzung schlicht
// die Standardwerte. Unbekannte oder fehlende Felder füllt der Spread auf.
export function readPrefs(): IPrefs {
    try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        const read: IPrefs = raw ? { ...PREFS_DEFAULT, ...(JSON.parse(raw) as Partial<IPrefs>) } : { ...PREFS_DEFAULT };

        // Aus der Zeit mit waehlbarer Akzentfarbe steht bei manchen noch ein
        // Feld "theme" im Speicher. Es wird nicht mehr gelesen und soll beim
        // naechsten Speichern auch nicht wieder mitgeschrieben werden.
        delete (read as IPrefs & { theme?: unknown }).theme;

        return read;
    } catch {
        return { ...PREFS_DEFAULT };
    }
}

export const prefs = readPrefs();

export function savePrefs(): void {
    try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // Kein Speicher, keine Erinnerung - die Einstellung gilt für diese Sitzung.
    }
}

// Das System darf Bewegung immer abschalten, die Einstellung nur zusätzlich.
export function motionOff(): boolean {
    return systemReduced || !prefs.motion;
}

export function applyMotion(): void {
    document.body.classList.toggle("no-motion", !prefs.motion);
}
