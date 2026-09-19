import path from "path";
import { FastifyReply, FastifyRequest } from "fastify";
import BotClient from "../client/BotClient";
import Route from "../structures/Route";
import { IsImageSource } from "../builder/MessageDoc";
import { DASHBOARD_PATH } from "../constants/Dashboard";
import { ResolveImagePath } from "../constants/Gallery";
import { CORE_ACTIONS, MAX_NOTE, MAX_REASON, PRIORITIES, TicketAction, TicketPriority } from "../constants/Tickets";
import { ITicket } from "../interfaces/services/tickets/ITicket";
import { ILiveAccess } from "../services/LiveService";
import { TicketError } from "../services/TicketService";
import { WantsJSON } from "../utils/admin";
import { PersonOf, SearchMembers } from "../utils/dashboard";
import { LiveGate, LiveTicket } from "../utils/live";

interface IBody {
    action?: unknown;
    content?: unknown;
    gallery?: unknown;
    priority?: unknown;
    reason?: unknown;
    option?: unknown;
    user?: unknown;
    seconds?: unknown;
    text?: unknown;
    at?: unknown;
    query?: unknown;
}

interface IPerson {
    id: string;
    name: string;
    avatar: string | null;
}

const MAX_GALLERY = 10;

function Text(value: unknown, max: number): string {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Ein Ticket in Live Tickets. GET: die letzten Nachrichten, mit ?before=<id>
 * weiter zurück. POST: schreiben (Text, Bilder aus der Galerie) und dieselben
 * Aktionen wie im Menü unter dem Ticket - über dieselben Wege im TicketService.
 */
export default class DashboardApiLiveTicket extends Route {
    constructor(client: BotClient) {
        super(client, {
            method: ["GET", "POST"],
            path: `${DASHBOARD_PATH}/api/guild/:id/live/:ticket`,
            description: "Verlauf und Aktionen eines Tickets in Live Tickets",
            prefixed: false,
            requiresAuth: false,
            rateLimit: { max: 120, timeWindow: "1 minute" },
        });
    }

    async Handle(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
        const writing = request.method === "POST";

        if (writing && !WantsJSON(request)) return reply.code(415).send({ error: "Nur application/json" });

        const access = await LiveGate(this.client, request, reply);

        if (!access) return reply;

        const ticket = await LiveTicket(this.client, access, request, reply);

        if (!ticket) return reply;

        reply.header("Cache-Control", "no-store");

        if (!writing) {
            const { before } = request.query as { before?: string };

            return reply.send(await this.client.liveService.History(access, ticket, before && /^\d{17,20}$/.test(before) ? before : undefined));
        }

        try {
            return reply.send({ ok: true, ...(await this.Act(access, ticket, (request.body ?? {}) as IBody)) });
        } catch (error) {
            if (error instanceof TicketError) return reply.code(400).send({ error: error.message });

            throw error;
        }
    }

    private async Act(access: ILiveAccess, ticket: ITicket, body: IBody): Promise<Record<string, unknown>> {
        const service = this.client.ticketService;
        const context = await service.Context(ticket.id);
        const member = access.member;
        const action = body.action;

        if (action === "send") {
            await service.SendAsMember(context, member, Text(body.content, 2000), this.Gallery(access.guild.id, body.gallery));

            return {};
        }

        // Wie das Menü unter dem Ticket: Schließen, Übernehmen, Zurückgeben, Hinzufügen
        // und Entfernen gehören fest dazu, der Rest nur, wenn der Server ihn eingeschaltet hat.
        const allowed = (key: TicketAction): void => {
            if (!CORE_ACTIONS.includes(key) && !access.config.actions.includes(key)) {
                throw new TicketError("Diese Aktion ist auf diesem Server nicht eingeschaltet.");
            }
        };

        switch (action) {
            case "claim":
                await service.Claim(context, member);
                return {};

            case "unclaim":
                await service.Unclaim(context, member);
                return {};

            case "priority":
                allowed("priority");

                if (!PRIORITIES.includes(body.priority as TicketPriority)) throw new TicketError("Diese Stufe gibt es nicht.");

                await service.SetPriority(context, member, body.priority as TicketPriority);
                return {};

            case "transfer":
                allowed("transfer");
                await service.Transfer(context, member, Text(body.option, 100));
                return {};

            case "members":
                // Die Suche für "Benutzer hinzufügen".
                return { members: await this.Search(access, ticket, Text(body.query, 100)) };

            case "add_user":
            case "remove_user": {
                const id = Text(body.user, 20);
                const user = /^\d{17,20}$/.test(id) ? await this.client.users.fetch(id).catch(() => null) : null;

                if (!user) throw new TicketError("Diesen User finde ich nicht.");

                if (action === "add_user") await service.AddUser(context, member, user);
                else await service.RemoveUser(context, member, user);

                return {};
            }

            case "freeze":
                allowed("freeze");
                return { frozen: await service.ToggleFreeze(context, member) };

            case "slowmode":
                allowed("slowmode");
                await service.SetSlowmode(context, member, Number(body.seconds));
                return {};

            case "staff_note":
                allowed("staff_note");
                await service.AddNote(context, member, Text(body.text, MAX_NOTE));
                return {};

            case "schedule_meeting": {
                allowed("schedule_meeting");

                const at = Number(body.at);

                if (!Number.isFinite(at)) throw new TicketError("Wähle Datum und Uhrzeit.");

                await service.Schedule(context, member, at, Text(body.text, 300));
                return {};
            }

            case "blacklist":
                allowed("blacklist");
                await service.Blacklist(context, member, Text(body.reason, MAX_REASON));
                return {};

            case "anonymous_mode":
                allowed("anonymous_mode");
                return { anonymous: await service.ToggleAnonymous(context, member) };

            case "tldr_summary":
                allowed("tldr_summary");
                // Die Eckdaten kennt die Seite schon - dazu kommen die Team-Notizen.
                return { notes: this.Notes(access, context.ticket) };

            case "media_vault":
                allowed("media_vault");
                return { items: await service.Vault(context, member) };

            case "close": {
                const reason = Text(body.reason, MAX_REASON);

                await service.Close(context, member, reason ? `${reason} (Dashboard)` : "Im Dashboard geschlossen");
                return {};
            }

            default:
                throw new TicketError("Unbekannte Aktion.");
        }
    }

    /** Für "Benutzer hinzufügen": Mitglieder nach Name oder ID - ohne Bots und ohne, wer schon im Ticket ist. */
    private async Search(access: ILiveAccess, ticket: ITicket, query: string): Promise<IPerson[]> {
        const inside = new Set([ticket.openerId, ...ticket.members]);

        return (await SearchMembers(access.guild, query)).filter((entry) => !inside.has(entry.id)).map(PersonOf);
    }

    private Notes(access: ILiveAccess, ticket: ITicket): { by: string; at: number; text: string }[] {
        return ticket.notes.slice(-20).map((note) => ({
            by: access.guild.members.cache.get(note.by)?.displayName ?? this.client.users.cache.get(note.by)?.displayName ?? "jemand vom Team",
            at: note.at,
            text: note.text,
        }));
    }

    /** Bilder aus der Galerie als Anhänge - nur eigene Alben und Vorlagen, wie im Nachrichten-Editor. */
    private Gallery(guildId: string, input: unknown): { attachment: string; name: string }[] {
        if (!Array.isArray(input)) return [];

        return input
            .filter((id): id is string => typeof id === "string" && !id.startsWith("https://") && !id.startsWith("{") && IsImageSource(id, guildId))
            .slice(0, MAX_GALLERY)
            .map((id) => ResolveImagePath(id))
            .filter((file): file is string => file !== null)
            .map((file) => ({ attachment: file, name: path.basename(file) }));
    }
}
