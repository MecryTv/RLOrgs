/**
 * Epic Account Services (EAS) - der echte Login mit dem Epic-Konto.
 *
 * Client-ID und Secret gibt es im Epic Developer Portal (dev.epicgames.com)
 * unter Product Settings > Clients. Dort muss dieselbe Rueckkehr-Adresse
 * eingetragen sein, die RedirectURI() unten baut - Epic vergleicht sie
 * zeichengenau und weist sonst ab.
 *
 * Warum ueberhaupt Epic und nicht Steam oder PlayStation: jedes
 * Rocket-League-Konto haengt an einem Epic-Konto. Ueber dieses eine Konto
 * liefert Prime die Kennungen aller anderen Plattformen gleich mit
 * (LinkedAccounts) - ein Login reicht also fuer alle fuenf.
 */
export const EPIC_AUTHORIZE_URL = "https://www.epicgames.com/id/authorize";
export const EPIC_TOKEN_URL = "https://api.epicgames.dev/epic/oauth/v2/token";

// "basic_profile" reicht: gebraucht wird nur die Konto-ID. Der Anzeigename
// kommt danach von Prime, das ihn ohnehin fuer die Raenge aufloest.
export const EPIC_SCOPE = "basic_profile";

// Der Tausch von Code gegen Token darf nicht ewig haengen - der Nutzer wartet
// waehrenddessen auf einer leeren Seite.
export const EPIC_TIMEOUT = 10_000;

export const EPIC_STATE_COOKIE = "rlnexus_epic_state";
export const EPIC_STATE_LIFETIME = 10 * 60 * 1000;
