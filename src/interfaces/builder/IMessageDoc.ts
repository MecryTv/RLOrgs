/**
 * Eine Nachricht, wie der Editor im Dashboard sie baut und der Bot sie sendet.
 * Genau das, was ComponentV2Builder kann - nichts darüber hinaus.
 *
 * Eine Bildquelle ist eine Galerie-ID ("<guild>/<album>/<datei>"), eine
 * https-URL oder einer der Platzhalter {user.avatar} und {guild.icon}.
 */
export type IMessageBlock =
    | { type: "text"; body: string }
    | { type: "image"; images: string[] }
    | { type: "separator"; big?: boolean; line?: boolean }
    | { type: "section"; body: string; thumbnail: string };

export interface IMessageDoc {
    /** Akzentfarbe des Containers als #rrggbb. */
    accent?: string;
    blocks: IMessageBlock[];
}
