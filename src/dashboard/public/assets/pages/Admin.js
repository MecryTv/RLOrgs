/** Seite: Administration. */
import { ghost, icon, need } from "../core/Dom.js";
import { ago, numbers } from "../core/Format.js";
import { GROUPS } from "../constants/Groups.js";
import { toast } from "../core/Toast.js";
import { url } from "../core/Base.js";
// Gruppen, die sich hier vergeben lassen. Developer fehlt bewusst: die Liste
// steht in der .env, damit überhaupt jemand die erste Berechtigung hat.
export const GRANTABLE = ["administrator", "partner", "premium"];
export function tile(label, value, hint) {
    const box = document.createElement("div");
    box.className = "tile";
    const big = document.createElement("b");
    big.textContent = value;
    const name = document.createElement("span");
    name.textContent = label;
    box.append(big, name);
    if (hint) {
        const small = document.createElement("i");
        small.textContent = hint;
        box.appendChild(small);
    }
    return box;
}
export function duration(seconds) {
    if (seconds < 60)
        return `${seconds} s`;
    if (seconds < 3600)
        return `${Math.round(seconds / 60)} min`;
    if (seconds < 86400)
        return `${Math.round(seconds / 3600)} h`;
    return `${Math.round(seconds / 86400)} d`;
}
export function paintTiles(data) {
    const host = need("#adminTiles");
    const { database, bot, totals, cache } = { ...data, cache: data.database.cache };
    const tiles = [
        tile("Server mit RL Nexus", numbers.format(bot.guilds), bot.tag ?? "nicht verbunden"),
        tile("Datenbank", database.ready ? "verbunden" : database.configured ? "nicht erreichbar" : "nicht eingerichtet", database.ready ? `${database.name} auf ${database.host}` : "siehe Log"),
        tile("Cache", `${numbers.format(cache.hits)} / ${numbers.format(cache.hits + cache.misses)}`, `Treffer · ${numbers.format(cache.size)} Einträge`),
        tile("Laufzeit", duration(bot.uptime), bot.developerMode ? "Entwicklungsmodus" : "Produktion"),
    ];
    if (totals) {
        tiles.push(tile("Aktive Teams", numbers.format(totals.teams)), tile("Partien", numbers.format(totals.matches)), tile("Verknüpfte Konten", numbers.format(totals.accounts)), tile("Eingerichtete Server", numbers.format(totals.settings)));
    }
    host.replaceChildren(...tiles);
}
export function paintEntries(data, onChange) {
    const host = need("#entryList");
    need("#entryCount").textContent = String(data.entries.length);
    if (data.entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hintline";
        empty.textContent = "Noch keine Gruppe vergeben. Alle anderen sind in der Testphase.";
        host.replaceChildren(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of data.entries) {
        const group = GROUPS[entry.group] ?? GROUPS.testphase;
        const row = document.createElement("div");
        row.className = "person";
        row.style.setProperty("--group", group.color);
        const mark = document.createElement("span");
        mark.className = "avatar avatar--sm";
        if (entry.avatar) {
            const image = document.createElement("img");
            image.alt = "";
            image.decoding = "async";
            image.addEventListener("error", () => image.remove());
            image.src = entry.avatar;
            mark.appendChild(image);
        }
        const text = document.createElement("div");
        text.className = "person__text";
        const name = document.createElement("b");
        // Kennt der Bot den Nutzer nicht, steht die ID da - erfunden wird kein Name.
        name.textContent = entry.name ?? "Unbekannter Nutzer";
        const meta = document.createElement("span");
        meta.className = "mono";
        meta.textContent = entry.userId;
        text.append(name, meta);
        if (entry.note) {
            const note = document.createElement("i");
            note.textContent = entry.note;
            text.appendChild(note);
        }
        if (entry.grantedAt) {
            const when = document.createElement("i");
            when.textContent = entry.grantedByName
                ? `Vergeben von ${entry.grantedByName} · ${ago(new Date(entry.grantedAt).getTime())}`
                : `Vergeben ${ago(new Date(entry.grantedAt).getTime())}`;
            text.appendChild(when);
        }
        const badge = document.createElement("span");
        badge.className = "gbadge";
        badge.append(icon(group.icon), group.label);
        row.append(mark, text, badge);
        // Developer stehen in der .env - hier gibt es dafür keinen Knopf.
        if (entry.group !== "developer" && entry.userId !== data.me.id) {
            const drop = ghost("#i-x", `Gruppe von ${entry.name ?? entry.userId} entziehen`);
            drop.addEventListener("click", () => {
                void sendGroup(entry.userId, null, undefined, onChange);
            });
            row.appendChild(drop);
        }
        fragment.appendChild(row);
    }
    host.replaceChildren(fragment);
}
export async function sendGroup(userId, group, note, onChange) {
    let response;
    try {
        response = await fetch(url("/api/admin/group"), {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ userId, group, note }),
        });
    }
    catch {
        toast("info", "Nicht gespeichert", "Der Bot antwortet gerade nicht.");
        return;
    }
    if (!response.ok) {
        const body = (await response.json().catch(() => ({})));
        toast("info", "Nicht gespeichert", body.hint ?? body.error ?? `Der Bot antwortete mit ${response.status}.`);
        return;
    }
    toast("info", group ? "Gruppe vergeben" : "Gruppe entzogen", group ? `${userId} ist jetzt ${group}.` : `${userId} ist wieder in der Testphase.`);
    onChange();
}
export async function renderAdmin() {
    const panel = need("#adminPanel");
    const empty = need("#empty");
    async function load() {
        let response;
        try {
            response = await fetch(url("/api/admin"), { headers: { Accept: "application/json" } });
        }
        catch {
            return fail("Der Bot antwortet gerade nicht", "Lade die Seite in einem Moment neu.");
        }
        if (response.status === 403) {
            return fail("Kein Zugriff auf die Administration", "Diese Seite steht nur Administratoren und Developern offen.");
        }
        if (!response.ok)
            return fail("Übersicht nicht ladbar", `Der Bot antwortete mit ${response.status}.`);
        const data = (await response.json());
        empty.classList.remove("is-on");
        panel.hidden = false;
        const me = GROUPS[data.me.group] ?? GROUPS.testphase;
        need("#adminMe").replaceChildren(icon(me.icon), me.label);
        document.documentElement.style.setProperty("--group", me.color);
        paintTiles(data);
        paintEntries(data, () => void load());
        if (!data.database.ready) {
            need("#grantHint").textContent =
                "Ohne Datenbank lässt sich keine Gruppe vergeben - Administrator, Partner und Premium stehen dort.";
            need("#grantSubmit").disabled = true;
        }
    }
    function fail(title, text) {
        panel.hidden = true;
        empty.classList.add("is-on", "empty--error");
        need("#emptyIcon use").setAttribute("href", "#i-warn");
        need("#emptyTitle").textContent = title;
        need("#emptyText").textContent = text;
    }
    const select = need("#grantGroup");
    for (const key of GRANTABLE) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = GROUPS[key].label;
        select.appendChild(option);
    }
    need("#grantForm").addEventListener("submit", (event) => {
        event.preventDefault();
        const id = need("#grantId");
        const note = need("#grantNote");
        void sendGroup(id.value.trim(), select.value, note.value.trim() || undefined, () => {
            id.value = "";
            note.value = "";
            void load();
        });
    });
    await load();
}
