// Was zu einem eingeloggten Browser gehört. Steckt verschlüsselt im Cookie
// selbst (siehe utils/seal.ts) - deshalb übersteht eine Anmeldung den Neustart
// des Bots, und es gibt keinen Sitzungsspeicher, der volllaufen könnte.
export default interface IDashboardSession {
    id: string;
    userId: string;
    username: string;
    // Der @-Name bei Discord. "handle" und "email" fehlen in Cookies, die vor
    // dem E-Mail-Scope ausgestellt wurden - deshalb optional statt Pflicht,
    // sonst würde jede laufende Sitzung mit einem 401 abgewiesen.
    handle?: string;
    email?: string | null;
    avatar: string | null;
    accessToken: string;
    // Beim Anmelden hatte das Discord-Konto Zwei-Faktor eingeschaltet. Steht als
    // Merkmal in der Sitzung, weil sonst jeder Seitenaufruf Discord danach
    // fragen müsste. Es ist damit eine Momentaufnahme: wer den Schutz später
    // abschaltet, kommt bis zum Ablauf des Cookies weiter herein.
    mfa: true;
    expiresAt: number;
}
