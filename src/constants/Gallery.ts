import path from "path";
import { lookup } from "node:dns";
import { BlockList, isIP, LookupFunction } from "node:net";

export const GALLERY_ROOT = path.join(process.cwd(), "src", "images");

export const DEFAULT_SCOPE = "default";

export const PRIVATE_SCOPE = "privacy";

export const IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
} as const;

export type ImageExtension = keyof typeof IMAGE_TYPES;

/**
 * Die Obergrenze fuer ein Bild - fuer den Download aus dem Netz wie fuer den
 * Upload aus dem Dashboard. Die Zahl steht hier und nur hier.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Die Typen, die ein Upload tragen darf - ohne Dubletten.
 *
 * Als string[] und nicht als literal getyptes Array: der einzige Zweck ist der
 * Vergleich mit einem Inhaltstyp aus einer Anfrage (ein einfacher string), und
 * genau dafuer braucht es die Weite.
 */
export const UPLOAD_TYPES: string[] = [...new Set(Object.values(IMAGE_TYPES))];

export function IsScope(value: string): boolean {
    return value === DEFAULT_SCOPE || /^\d{17,20}$/.test(value);
}

export function SanitizeName(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

export function IsImageFile(file: string): boolean {
    return path.extname(file).toLowerCase() in IMAGE_TYPES;
}

export function TypeOf(file: string): string | null {
    return IMAGE_TYPES[path.extname(file).toLowerCase() as ImageExtension] ?? null;
}

export function ResolveImagePath(relative: string): string | null {
    const file = path.resolve(GALLERY_ROOT, relative);

    if (!file.startsWith(GALLERY_ROOT + path.sep)) return null;

    return TypeOf(file) ? file : null;
}

/**
 * Was als internes Netz gilt - eine Liste fuer beide Stellen, die danach fragen:
 * IsPrivateHost (die eingetippte URL, vorab) und LookupPublic (die Adresse, zu der
 * wirklich verbunden wird). Zwei Listen liefen irgendwann auseinander.
 *
 * IPv4-gemappte IPv6-Adressen (::ffff:127.0.0.1, von der URL als ::ffff:7f00:1
 * geschrieben) gleicht BlockList selbst mit den IPv4-Regeln ab - so steht es in
 * der Node-Doku, unter Node 24.15 nachgeprueft, und check:gallery haelt es fest.
 * Ohne das kaeme 127.0.0.1 in IPv6-Schreibweise einfach durch.
 */
const INTERNAL_NETWORKS: Array<[network: string, prefix: number]> = [
    ["0.0.0.0", 8], // "dieses Netz" - wer zu 0.0.0.0 verbindet, landet beim eigenen Rechner
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // Carrier-grade NAT, dort wohnen auch Tailscale & Co.
    ["127.0.0.0", 8],
    ["169.254.0.0", 16], // Link-local, darunter die Metadaten-Dienste der Clouds
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
    // :: (das IPv6-Gegenstueck zu 0.0.0.0), ::1 und die veralteten IPv4-kompatiblen
    // ::a.b.c.d - ein Linux mit aktivem sit0 fuehrt ::127.0.0.1 als eigene Adresse.
    ["::", 96],
    ["fc00::", 7], // Unique local
    ["fe80::", 10], // Link-local
];

const INTERNAL = new BlockList();

for (const [network, prefix] of INTERNAL_NETWORKS) {
    INTERNAL.addSubnet(network, prefix, isIP(network) === 6 ? "ipv6" : "ipv4");
}

export function IsInternalAddress(address: string): boolean {
    const family = isIP(address);

    // Keine IP-Adresse - das liefert kein Resolver, der funktioniert. BlockList
    // antwortete darauf still mit false, also lieber gleich sperren.
    if (family === 0) return true;

    return INTERNAL.check(address, family === 6 ? "ipv6" : "ipv4");
}

// Nur der schnelle Weg fuer eine lesbare Meldung, bevor ueberhaupt etwas
// passiert. Die Sperre, auf die es ankommt, sitzt in LookupPublic.
export function IsPrivateHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;

    return isIP(host) !== 0 && IsInternalAddress(host);
}

/**
 * dns.lookup mit Pruefung - fuer den https.Agent, ueber den AddImage herunterlaedt.
 *
 * Die Pruefung sitzt hier, im Moment des Verbindens, und nicht vorab in
 * ParseSource: IsPrivateHost sieht nur den Namen, den jemand eingetippt hat. Ein
 * oeffentlicher Name kann auf 10.0.0.5 oder 169.254.169.254 zeigen, und DNS darf
 * beim zweiten Fragen anders antworten als beim ersten (Rebinding). Wer vor der
 * Anfrage selbst aufloest und prueft, prueft also eine Adresse, zu der danach
 * womoeglich gar nicht verbunden wird. Diesen lookup ruft Node unmittelbar vor
 * dem Verbinden, fuer die erste Anfrage wie fuer jede Weiterleitung - und die
 * Adresse, die er zurueckgibt, ist die, zu der verbunden wird. Bitte nicht zu
 * einer Vorab-Pruefung "vereinfachen".
 *
 * Node ruft ihn in zwei Formen: mit all: false zurueck an (err, address, family),
 * mit all: true (Happy Eyeballs, unter Node 24 der Standard) an (err, addresses).
 * Im zweiten Fall probiert Node jede Adresse der Liste, deshalb sperrt schon eine
 * einzige interne die ganze Antwort.
 *
 * Eine nackte IP in der URL erreicht diesen lookup nie - Node verbindet dann
 * sofort. Die faengt ParseSource bzw. CheckRedirect am Text ab.
 */
export const LookupPublic: LookupFunction = (hostname, options, callback) => {
    lookup(hostname, options, (error, address, family) => {
        if (error) return callback(error, address, family);

        const addresses = typeof address === "string" ? [address] : address.map((entry) => entry.address);

        // Ohne die Adresse im Text - der landet sonst bis im Discord-Panel.
        if (addresses.some(IsInternalAddress)) return callback(new Error("Diese Adresse liegt im internen Netz."), "");

        callback(null, address, family);
    });
};

export function ParseSource(url: string): URL {
    let source: URL;

    try {
        source = new URL(url);
    } catch {
        throw new Error("Das ist keine gültige URL.");
    }

    if (source.protocol !== "https:") throw new Error("Nur https-URLs werden akzeptiert.");
    if (IsPrivateHost(source.hostname)) throw new Error("Diese Adresse liegt im internen Netz.");

    return source;
}

/**
 * Fuer axios' beforeRedirect: jeder Sprung muss dieselben Regeln erfuellen wie die
 * eingetippte URL. Zwei Luecken schliesst nur diese Stelle, nicht LookupPublic:
 * - ein Sprung auf http: liefe ueber den http-Agent, an dem LookupPublic nicht haengt;
 * - ein Sprung auf eine nackte IP (https://127.0.0.1/) fragt kein DNS, Node
 *   verbindet ohne lookup. Bei einer IP ist der Text aber schon die Adresse - hier
 *   gibt es nichts, was sich zwischen Pruefen und Verbinden noch aendern koennte.
 */
export function CheckRedirect(options: { href?: string }): void {
    ParseSource(options.href ?? "");
}
