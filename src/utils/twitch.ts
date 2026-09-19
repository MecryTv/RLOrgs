/**
 * Die Twitch-API (Helix) mit einem App-Token - mehr braucht der Notifier nicht:
 * wer ist live, wie heißt jemand, gibt es ein VOD. Der Token hält etwa zwei
 * Monate und wird bei 401 einmal neu geholt. Siehe docs/Notifiers.md.
 */

export interface ITwitchUser {
    id: string;
    login: string;
    display_name: string;
    profile_image_url: string;
}

export interface ITwitchStream {
    id: string;
    user_id: string;
    user_login: string;
    user_name: string;
    game_name: string;
    title: string;
    viewer_count: number;
    started_at: string;
    /** Mit {width}x{height} darin - Preview() setzt sie ein. */
    thumbnail_url: string;
}

interface ITwitchVideo {
    id: string;
    stream_id: string | null;
    url: string;
}

const API = "https://api.twitch.tv/helix";
const TIMEOUT = 10_000;

export class TwitchError extends Error {}

export default class TwitchApi {
    private token: { value: string; expires: number } | null = null;

    constructor(
        private readonly clientId: string,
        private readonly secret: string
    ) {}

    /** Ohne Client-ID und Secret kein Twitch - das Dashboard sagt es dann. */
    get Ready(): boolean {
        return Boolean(this.clientId && this.secret);
    }

    private async Token(fresh = false): Promise<string> {
        if (!fresh && this.token && this.token.expires > Date.now()) return this.token.value;

        const params = new URLSearchParams({ client_id: this.clientId, client_secret: this.secret, grant_type: "client_credentials" });
        const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: "POST", signal: AbortSignal.timeout(TIMEOUT) });

        if (!response.ok) throw new TwitchError(`Twitch lehnt die App ab (${response.status}) - stimmen TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET?`);

        const body = (await response.json()) as { access_token: string; expires_in: number };

        // Eine Minute Luft, damit er nicht mitten in einer Abfrage abläuft.
        this.token = { value: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 };

        return this.token.value;
    }

    private async Get<T>(path: string, params: [string, string][], retry = true): Promise<T[]> {
        if (!this.Ready) throw new TwitchError("Für Twitch fehlen TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET in der .env.");

        const query = new URLSearchParams(params);
        const response = await fetch(`${API}${path}?${query}`, {
            headers: { "Client-Id": this.clientId, Authorization: `Bearer ${await this.Token(!retry)}` },
            signal: AbortSignal.timeout(TIMEOUT),
        });

        if (response.status === 401 && retry) return this.Get(path, params, false);
        if (!response.ok) throw new TwitchError(`Twitch antwortet mit ${response.status}.`);

        return ((await response.json()) as { data: T[] }).data;
    }

    async UserByLogin(login: string): Promise<ITwitchUser | null> {
        const [user] = await this.Get<ITwitchUser>("/users", [["login", login]]);

        return user ?? null;
    }

    /** Wer von diesen gerade live ist - 100 je Abfrage, wie Twitch es erlaubt. */
    async Streams(userIds: string[]): Promise<ITwitchStream[]> {
        const streams: ITwitchStream[] = [];

        for (let index = 0; index < userIds.length; index += 100) {
            const batch = userIds.slice(index, index + 100);

            streams.push(...(await this.Get<ITwitchStream>("/streams", batch.map((id): [string, string] => ["user_id", id]))));
        }

        return streams;
    }

    async Users(userIds: string[]): Promise<ITwitchUser[]> {
        const users: ITwitchUser[] = [];

        for (let index = 0; index < userIds.length; index += 100) {
            users.push(...(await this.Get<ITwitchUser>("/users", userIds.slice(index, index + 100).map((id): [string, string] => ["id", id]))));
        }

        return users;
    }

    /** Das VOD eines Streams - nur, wenn der Streamer Übertragungen speichert. */
    async Vod(userId: string, streamId: string): Promise<string | null> {
        const videos = await this.Get<ITwitchVideo>("/videos", [["user_id", userId], ["type", "archive"], ["first", "5"]]).catch(() => []);

        return videos.find((video) => video.stream_id === streamId)?.url ?? null;
    }
}

/** Das Vorschaubild in 1280x720 - mit Zeitstempel, sonst zeigt Discord ewig dasselbe Bild. */
export function Preview(stream: Pick<ITwitchStream, "thumbnail_url">, at: number): string {
    return `${stream.thumbnail_url.replace("{width}", "1280").replace("{height}", "720")}?t=${Math.floor(at / 60_000)}`;
}
