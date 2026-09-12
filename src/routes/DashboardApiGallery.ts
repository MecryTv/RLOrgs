import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { SessionOf } from "../utils/dashboard";

/**
 * Was in der Galerie eines Servers liegt: seine Kategorien samt Unterordnern und
 * die Bilder darin. Die Default-Bilder kommen mit, damit die Bildauswahl auch
 * ohne eigene Uploads etwas zu zeigen hat.
 */
export default class DashboardApiGallery extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "GET",
            path: `${DASHBOARD_PATH}/api/guild/:id/gallery`,
            description: "Liefert Kategorien und Bilder der Galerie eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 120, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id?: string };

        if (!id || !SNOWFLAKE.test(id)) return reply.code(404).send({ error: "Not Found" });

        try {
            if (!(await service.CanManage(session, id))) {
                return reply.code(403).send({ error: "Forbidden", hint: "Nur wer den Server verwalten darf." });
            }
        } catch (error) {
            if (!(error instanceof SessionExpired)) throw error;

            return reply
                .header("Set-Cookie", ClearCookie(SESSION_COOKIE, service.Secure))
                .code(401)
                .send({ error: "Unauthorized" });
        }

        const gallery = this.client.galleryService;

        // Auch leere Alben: ohne das verschwaende ein frisch angelegtes Album
        // sofort wieder aus der Liste, und "Anlegen" saehe aus, als taete es
        // nichts. Das Discord-Panel blendet leere Alben aus, das Dashboard nicht.
        const all = { requireImages: false };

        // GetCategories(id) liefert Vorlagen und Server schon zusammen - ein
        // zweiter Aufruf fuer "default" haette jede Vorlage doppelt gezeigt.
        const categories = await gallery.GetCategories(id, all);

        // Unterordner je Name nur einmal abfragen: GetSubcategories schaut
        // ebenfalls in beide Bereiche, und ein Name kann in beiden vorkommen.
        const names = [...new Set(categories.map((entry) => entry.name))];
        const nested = (await Promise.all(names.map((name) => gallery.GetSubcategories(id, name, all)))).flat();

        // Unterordner stehen gleichberechtigt in derselben Liste; ihr Feld
        // "parent" sagt, wohin sie gehoeren.
        const folders = [...categories, ...nested];

        const images = (
            await Promise.all(
                folders.map((entry) =>
                    gallery.GetImages({
                        guildId: entry.guildId,
                        category: entry.parent ?? entry.name,
                        subcategory: entry.parent ? entry.name : null,
                    })
                )
            )
        ).flat();

        return reply.header("Cache-Control", "no-store").send({ categories: folders, images });
    }
}
