import axios from "axios";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { SessionExpired } from "../services/DashboardService";
import { ClearCookie, DASHBOARD_PATH, SESSION_COOKIE } from "../constants/Dashboard";
import { SNOWFLAKE } from "../constants/Discord";
import { MAX_IMAGE_BYTES, UPLOAD_TYPES } from "../constants/Gallery";
import { WantsJSON } from "../utils/admin";
import { SessionOf } from "../utils/dashboard";
import logger from "../utils/logger";

/** Was hinter /gallery/ stehen darf. Alles andere ist 400, noch vor den Rechten. */
const ACTIONS = new Set(["category", "category/delete", "image", "image/url", "image/move", "image/delete"]);

interface IBody {
    category?: unknown;
    subcategory?: unknown;
    image?: unknown;
    url?: unknown;
}

function Text(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function MimeOf(request: FastifyRequest): string {
    return String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Alles, was die Galerie eines Servers veraendert - sechs Aktionen unter einem
 * Pfad. Die Rechtepruefung steht damit einmal da statt sechsmal, und die
 * Galerie-ID mit ihren Schraegstrichen passt in keinen Pfad-Parameter.
 */
export default class DashboardApiGalleryEdit extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: "POST",
            path: `${DASHBOARD_PATH}/api/guild/:id/gallery/*`,
            description: "Legt an, laedt hoch, verschiebt und loescht in der Galerie eines Servers",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 60, timeWindow: "1 minute" },
            // Die einzige Route, die ein Bild als Body annimmt - und damit die
            // einzige, die mehr als Fastifys 1 MiB braucht. Der Parser in
            // Server.ts traegt absichtlich kein eigenes Limit: sonst puffert
            // jede POST-Route 8 MB, bevor sie die Sitzung ueberhaupt ansieht.
            bodyLimit: MAX_IMAGE_BYTES,
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const service = this.client.dashboardService;
        const session = SessionOf(this.client, request);

        if (!session) return reply.code(401).send({ error: "Unauthorized" });

        const { id } = request.params as { id?: string };

        if (!id || !SNOWFLAKE.test(id)) return reply.code(404).send({ error: "Not Found" });

        // Erst die Adresse, dann der Inhalt, dann die Rechte: eine Aktion, die es
        // nicht gibt, soll keinen Umlauf zu Discord kosten. Nebenbei ist die 400
        // so auch ohne gueltige Sitzung erreichbar - check:dashboard prueft sie.
        const action = (request.params as { "*"?: string })["*"] ?? "";

        if (!ACTIONS.has(action)) return reply.code(400).send({ error: "Unbekannte Aktion." });

        // Derselbe CSRF-Schutz wie bei den anderen schreibenden Routen (WantsJSON
        // in utils/admin.ts): nur Inhaltstypen, fuer die ein fremder Browser erst
        // eine Preflight-Anfrage stellen muesste. Der Upload traegt statt JSON
        // sein Bild - image/* ist genauso wenig ein einfacher Typ.
        const upload = action === "image";

        if (upload ? !UPLOAD_TYPES.includes(MimeOf(request)) : !WantsJSON(request)) {
            return reply.code(415).send({ error: upload ? "Nur Bilder" : "Nur application/json" });
        }

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

        try {
            const result = await this.Run(id, action, request);

            if (result === null) return reply.code(400).send({ error: "Es fehlen Angaben." });

            logger.user(`🖼️  Galerie ${action} auf ${id} (von ${session.userId})`);

            return reply.header("Cache-Control", "no-store").send({ ok: true, ...result });
        } catch (error) {
            // Was der Dienst ablehnt, ist eine Angabe des Nutzers: seine Fehler
            // sind schlichte Error-Objekte ohne code, mit einem Text fuer Menschen.
            // Ein Download, der scheitert, gehoert ebenfalls dazu. Alles andere -
            // eine volle Platte, fehlende Rechte - traegt einen code und oft einen
            // absoluten Pfad im Text. Das geht nicht an den Browser, sondern als
            // 500 ins Log (RouteManager.Dispatch).
            if (axios.isAxiosError(error)) {
                return reply.code(400).send({ error: "Das Bild ließ sich von dieser Adresse nicht laden." });
            }

            if (error instanceof Error && !("code" in error)) {
                return reply.code(400).send({ error: error.message });
            }

            throw error;
        }
    }

    private async Run(
        guildId: string,
        action: string,
        request: FastifyRequest
    ): Promise<Record<string, unknown> | null> {
        const gallery = this.client.galleryService;
        const body = (typeof request.body === "object" && !Buffer.isBuffer(request.body)
            ? request.body ?? {}
            : {}) as IBody;

        const category = Text(body.category);
        const subcategory = Text(body.subcategory);

        if (action === "category") {
            if (!category) return null;

            return { created: await gallery.CreateCategory({ guildId, category, subcategory }) };
        }

        if (action === "category/delete") {
            if (!category) return null;

            return { removed: await gallery.DeleteCategory({ guildId, category, subcategory }) };
        }

        if (action === "image") {
            const mime = MimeOf(request);

            // Der Typ ist in Handle schon geprueft; ein Buffer muss es trotzdem
            // sein, sonst hat kein Bild-Parser den Body gelesen.
            if (!Buffer.isBuffer(request.body)) return null;

            const query = request.query as { category?: string; subcategory?: string; name?: string };
            const target = Text(query.category);

            if (!target) return null;

            return {
                image: await gallery.AddUpload(
                    { guildId, category: target, subcategory: Text(query.subcategory) },
                    request.body,
                    mime,
                    Text(query.name) ?? "bild"
                ),
            };
        }

        if (action === "image/url") {
            const url = Text(body.url);

            if (!url || !category) return null;

            return { image: await gallery.AddImage({ guildId, category, subcategory }, url) };
        }

        if (action === "image/move") {
            const image = Text(body.image);

            // Nur in der eigenen Galerie: eine ID aus einem fremden Server waere
            // ein Griff in dessen Verzeichnis.
            if (!image || !category || !image.startsWith(`${guildId}/`)) return null;

            return { moved: await gallery.MoveImage(image, { category, subcategory }) };
        }

        if (action === "image/delete") {
            const image = Text(body.image);

            if (!image || !image.startsWith(`${guildId}/`)) return null;

            return { removed: await gallery.DeleteImage(image) };
        }

        return null;
    }
}
