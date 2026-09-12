import BotClient from "../client/BotClient";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { EPIC_AUTHORIZE_URL, EPIC_SCOPE, EPIC_TIMEOUT, EPIC_TOKEN_URL } from "../constants/Epic";
import { IPrimeProfile } from "../interfaces/services/prime/IPrimeService";

/** Was der Tausch von Code gegen Token liefert - gebraucht wird davon eines. */
interface ITokenResponse {
    account_id?: string;
    error?: string;
    errorMessage?: string;
}

export function EpicConfigured(client: BotClient): boolean {
    return Boolean(client.config.EPIC_CLIENT_ID && client.config.EPIC_CLIENT_SECRET);
}

/**
 * Die Rueckkehr-Adresse. Sie muss im Epic Developer Portal zeichengenau so
 * eingetragen sein - ein fehlender Schraegstrich reicht fuer ein "invalid
 * redirect_uri", noch bevor der Nutzer sein Passwort sieht.
 *
 * Sie folgt der Basis-Adresse des Servers und nicht direkt SERVER_PUBLIC_URL:
 * im Entwicklungsmodus ist das localhost samt "/dashboard", im Betrieb die
 * eigene Domain ohne Praefix. Beide gehoeren im Portal hinterlegt - genau wie
 * bei Discord, siehe DashboardService.RedirectURI.
 */
export function EpicRedirectURI(client: BotClient): string {
    return `${client.server.BaseURL}${DASHBOARD_PATH}/link/epic/callback`;
}

export function EpicAuthorizeURL(client: BotClient, state: string): string {
    const query = new URLSearchParams({
        client_id: client.config.EPIC_CLIENT_ID,
        redirect_uri: EpicRedirectURI(client),
        response_type: "code",
        scope: EPIC_SCOPE,
        state,
    });

    return `${EPIC_AUTHORIZE_URL}?${query}`;
}

/**
 * Code gegen Konto-ID.
 *
 * Mehr als die ID wird nicht gebraucht: Prime nimmt die 32-stellige Epic-ID
 * genauso wie einen Anzeigenamen und liefert Namen, Plattformen und Raenge in
 * einem Aufruf. Ein zweiter Weg zu Epic waere also nur eine weitere Stelle,
 * die kaputtgehen kann.
 *
 * Gibt null zurueck, wenn Epic den Code ablehnt - das ist der Normalfall bei
 * einem abgelaufenen oder doppelt eingeloesten Code, kein Ausfall.
 */
export async function EpicExchange(client: BotClient, code: string): Promise<string | null> {
    const secret = Buffer.from(`${client.config.EPIC_CLIENT_ID}:${client.config.EPIC_CLIENT_SECRET}`).toString(
        "base64"
    );

    const response = await fetch(EPIC_TOKEN_URL, {
        method: "POST",
        headers: {
            Authorization: `Basic ${secret}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            // Epic prueft die Adresse ein zweites Mal gegen die aus dem ersten
            // Schritt. Sie muss deshalb dieselbe sein, nicht nur eine gueltige.
            redirect_uri: EpicRedirectURI(client),
            scope: EPIC_SCOPE,
        }),
        signal: AbortSignal.timeout(EPIC_TIMEOUT),
    });

    const body = (await response.json().catch(() => ({}))) as ITokenResponse;

    if (!response.ok || !body.account_id) return null;

    return body.account_id;
}

/**
 * Alles, was nach einem erfolgreich aufgeloesten Epic-Konto passieren muss.
 *
 * Es gibt zwei Wege hierher - die echte Anmeldung und den Namen als Notweg -
 * und beide muessen dasselbe hinterlassen. Deshalb steht es hier einmal.
 *
 * Verknuepft wird ausschliesslich Epic. Die Plattformen, die Prime am Konto
 * haengen sieht, werden bewusst nicht mitgeschrieben: fuer PlayStation und
 * Nintendo gibt es keinen oeffentlichen Login, und die Raenge sind auf allen
 * Plattformen ohnehin dieselben - siehe Migration 007.
 */
export async function EpicAdopt(client: BotClient, userId: string, profile: IPrimeProfile): Promise<void> {
    await client.accounts.Link(userId, "epic", profile.accountId, profile.name, true);

    await client.ranks.Snapshot(userId, profile.ranks);
    await client.ranks.SaveProfile(userId, profile.seasonLevel, profile.seasonWins, profile.stats, profile.club);
}
