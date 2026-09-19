import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { AssetTypeOf, DASHBOARD_PATH, ResolveAssetPath } from "../constants/Dashboard";
import { SendFile } from "../utils/dashboard";

// Kein Cache-Eintrag ohne Rückfrage: sonst hält der Browser nach jedem Frontend-Build
// noch die alte app.js fest und die Seite bleibt scheinbar kaputt.
const CACHE_CONTROL = "no-cache";

// Bilder ändern sich nicht mit dem Bau. Ein Tag Cache spart auf der
// Tracking-Seite zwei Dutzend Rückfragen je Aufruf - die Rang-Abzeichen liegen
// seit dem Umzug unter assets/images und kämen sonst bei jedem Laden erneut.
const IMAGE_CACHE = "public, max-age=86400";

// Was sich nie ändert, darf der Browser ein Jahr behalten, ohne nachzufragen:
// Stücke mit Prüfsumme im Namen (assets/chunks), Schriften und Adressen mit
// ?v=<Prüfsumme> - die setzen die HTML-Seiten an app.js und style.css.
const IMMUTABLE = "public, max-age=31536000, immutable";

function CacheFor(file: string, versioned: boolean): string {
    if (versioned || /[\\/]chunks[\\/]/.test(file) || file.endsWith(".woff2")) return IMMUTABLE;

    return (AssetTypeOf(file) ?? "").startsWith("image/") ? IMAGE_CACHE : CACHE_CONTROL;
}

function SafeDecode(value: string): string | null {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

export default class DashboardAssets extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/assets/*`,
            description: "Liefert CSS, JavaScript und Bilder des Dashboards aus",
            prefixed: false,
            // CSS, JS und Bilder sind keine Geheimnisse - die Daten hängen an /api/me.
            requiresAuth: false,
            rateLimit: { max: 300, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const params = request.params as { "*"?: string };
        const relative = SafeDecode(params["*"] ?? "");
        const file = relative ? ResolveAssetPath(relative) : null;

        if (!file) return reply.code(403).send({ error: "Forbidden" });

        const { v } = request.query as { v?: string };

        return SendFile(reply, file, CacheFor(file, typeof v === "string" && /^[0-9a-f]{6,40}$/.test(v)));
    }
}
