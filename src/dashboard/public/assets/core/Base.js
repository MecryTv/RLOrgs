/**
 * Der Pfad, unter dem das Dashboard haengt.
 *
 * Im Entwicklungsmodus liegt alles unter `/dashboard`, im Betrieb hat das
 * Dashboard eine eigene Domain (dashboard.nexus-emb.de) und liegt damit direkt
 * an der Wurzel. Beides steht im Backend in `constants/Dashboard.ts`.
 *
 * Hier wird es nicht geraten und auch nicht vom Server eingesetzt, sondern
 * abgelesen: dieses Modul liegt immer unter `<wurzel>/assets/core/Base.js`,
 * zwei Ebenen darueber steht die Wurzel. Damit stimmt der Pfad auch dann, wenn
 * das Dashboard einmal woanders haengt - und keine Seite muss ihn mitgeben.
 */
const ROOT = new URL("../..", import.meta.url).pathname;
/** "/dashboard" im Entwicklungsmodus, "" auf der eigenen Domain. */
export const BASE = ROOT.replace(/\/+$/, "");
/** Ein Pfad im Dashboard: `url("/api/me")` wird zu `/dashboard/api/me` bzw. `/api/me`. */
export function url(path) {
    return `${BASE}${path}`;
}
