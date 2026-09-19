import {
    AnyThreadChannel,
    ChannelFlags,
    ChannelType,
    DiscordAPIError,
    ForumChannel,
    Guild,
    GuildBasedChannel,
    MediaChannel,
    Message,
    MessageCreateOptions,
} from "discord.js";
import { LRUCache } from "lru-cache";

/**
 * Log-Ziele: wohin der Bot Transcripts und Moderations-Fälle schickt. Ein
 * Textkanal, ein Ankündigungskanal - oder ein Thread, vor allem ein Beitrag in
 * einem Forum. Für Discord ist ein Thread auch nur ein Kanal mit eigener ID;
 * gespeichert wird deshalb wie bisher nur eine ID.
 */

export interface ILogThread {
    id: string;
    name: string;
    parentId: string;
    parentName: string;
    archived: boolean;
}

export interface ILogTargets {
    channels: { id: string; name: string }[];
    forums: { id: string; name: string }[];
    threads: ILogThread[];
}

/** Was der Nutzer falsch gewählt hat - die Routen machen daraus eine 400. */
export class LogTargetError extends Error {}

export function IsLogTarget(channel: GuildBasedChannel | null | undefined): boolean {
    return (
        channel?.type === ChannelType.GuildText ||
        channel?.type === ChannelType.GuildAnnouncement ||
        channel?.type === ChannelType.PublicThread ||
        channel?.type === ChannelType.AnnouncementThread
    );
}

function IsForum(channel: GuildBasedChannel | null | undefined): channel is ForumChannel | MediaChannel {
    return channel?.type === ChannelType.GuildForum || channel?.type === ChannelType.GuildMedia;
}

function Entry(thread: AnyThreadChannel): ILogThread {
    return {
        id: thread.id,
        name: thread.name,
        parentId: thread.parentId ?? "",
        parentName: thread.parent?.name ?? "",
        archived: Boolean(thread.archived),
    };
}

// ponytail: eine Minute je Server - ein in Discord neu angelegter Beitrag
// erscheint spätestens dann; hier angelegte stehen sofort drin.
const lists = new LRUCache<string, ILogTargets>({ max: 500, ttl: 60_000 });

/**
 * Was ein Auswahlfeld für Logs anbietet: Textkanäle und die Beiträge aller
 * Foren - die aktiven und je Forum die 25 zuletzt archivierten. Die schon
 * eingestellten Ziele (current) stehen immer dabei, auch wenn sie längst
 * archiviert sind. Alles Gefundene landet nebenbei im Cache von discord.js -
 * so erkennt die Prüfung beim Speichern die Threads wieder.
 */
export async function LogTargets(guild: Guild, current: (string | null)[] = []): Promise<ILogTargets> {
    let list = lists.get(guild.id);

    if (!list) {
        const forums = [...guild.channels.cache.values()].filter(IsForum);

        await guild.channels.fetchActiveThreads().catch(() => null);
        await Promise.all(forums.map((forum) => forum.threads.fetchArchived({ type: "public", limit: 25 }).catch(() => null)));

        const channels = [...guild.channels.cache.values()];
        const forumIds = new Set(forums.map((forum) => forum.id));

        list = {
            channels: channels
                .filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
                .sort((a, b) => ("position" in a && "position" in b ? a.position - b.position : 0))
                .map((channel) => ({ id: channel.id, name: channel.name })),
            forums: forums.map((forum) => ({ id: forum.id, name: forum.name })),
            threads: channels
                .filter((channel): channel is AnyThreadChannel => channel.isThread() && forumIds.has(channel.parentId ?? "") && IsLogTarget(channel))
                .map(Entry)
                // Aktive zuerst, dann nach Namen.
                .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "de")),
        };

        lists.set(guild.id, list);
    }

    for (const id of current) {
        if (!id || list.channels.some((channel) => channel.id === id) || list.threads.some((thread) => thread.id === id)) continue;

        const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));

        if (channel?.isThread() && IsLogTarget(channel)) list = { ...list, threads: [...list.threads, Entry(channel)] };
    }

    return list;
}

/**
 * Holt ein Ziel in den Cache, bevor eine Prüfung es sucht - archivierte
 * Threads kennt discord.js sonst nicht. Ohne gültige ID passiert nichts.
 */
export async function WarmLogTarget(guild: Guild, id: unknown): Promise<void> {
    if (typeof id !== "string" || !/^\d{17,20}$/.test(id) || guild.channels.cache.has(id)) return;

    await guild.channels.fetch(id).catch(() => null);
}

/** Legt in einem Forum einen Beitrag für Logs an und gibt ihn zurück. */
export async function CreateLogThread(guild: Guild, forumId: unknown, name: string, text: string): Promise<ILogThread> {
    const forum = typeof forumId === "string" ? guild.channels.cache.get(forumId) : undefined;

    if (!IsForum(forum)) throw new LogTargetError("Dieses Forum gibt es auf dem Server nicht.");

    // Verlangt das Forum einen Tag, bekommt der Beitrag den ersten.
    const tag = forum.flags.has(ChannelFlags.RequireTag) ? forum.availableTags[0]?.id : undefined;

    try {
        const thread = await forum.threads.create({ name, message: { content: text }, appliedTags: tag ? [tag] : [] });

        lists.delete(guild.id);

        return Entry(thread);
    } catch (error) {
        if (error instanceof DiscordAPIError && (error.code === 50013 || error.code === 50001)) {
            throw new LogTargetError(`Mir fehlt das Recht, in #${forum.name} Beiträge zu erstellen.`);
        }

        throw error;
    }
}

/**
 * Schickt etwas an ein Log-Ziel. Ein archivierter Thread wacht dabei von selbst
 * auf; ein gesperrter nur mit "Threads verwalten". null: ging nicht.
 */
export async function SendLog(guild: Guild, channelId: string | null, payload: MessageCreateOptions): Promise<Message | null> {
    if (!channelId) return null;

    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));

    if (!IsLogTarget(channel) || !channel?.isTextBased()) return null;

    return channel.send(payload).catch(() => null);
}
