import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import IDashboardSession from "../interfaces/services/dashboard/IDashboardSession";
import { SessionOf } from "./dashboard";

export interface IStaffCheck {
    session: IDashboardSession;
}

/**
 * Lässt nur Administratoren und Developer durch.
 *
 * Gibt entweder die Sitzung zurück oder hat die Antwort bereits verschickt - der
 * Aufrufer prüft auf null und ist fertig. Ein 404 statt eines 403 wäre hier
 * unnötig: dass es das Admin-Dashboard gibt, ist kein Geheimnis, und ein klarer
 * Statuscode erspart die Fehlersuche.
 */
export async function StaffOnly(
    client: BotClient,
    request: FastifyRequest,
    reply: FastifyReply
): Promise<IDashboardSession | null> {
    const session = SessionOf(client, request);

    if (!session) {
        await reply.code(401).send({ error: "Unauthorized" });

        return null;
    }

    if (!(await client.dashboardService.IsStaff(session.userId))) {
        await reply.code(403).send({ error: "Forbidden", hint: "Nur für Administratoren und Developer." });

        return null;
    }

    return session;
}

/**
 * Schreibende Aufrufe nehmen ausschließlich JSON entgegen.
 *
 * Zusammen mit dem SameSite=Lax-Cookie ist das der CSRF-Schutz: ein Formular auf
 * einer fremden Seite kann nur die einfachen Inhaltstypen schicken, und bei
 * application/json verlangt der Browser vorher eine Preflight-Anfrage, die hier
 * nirgends beantwortet wird. Das Cookie käme bei einem fremden POST ohnehin
 * nicht mit.
 */
export function WantsJSON(request: FastifyRequest): boolean {
    return (request.headers["content-type"] ?? "").toLowerCase().includes("application/json");
}
