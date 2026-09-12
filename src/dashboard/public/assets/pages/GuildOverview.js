/**
 * Die Übersicht der Serverseite: Kennzahlen, Verlauf, Heatmap, aktivste Kanäle
 * und Mitglieder, Rang-Verteilung. Gezählt wird im Bot (docs/Activity.md), hier
 * wird nur gezeichnet.
 *
 * Die Stunden kommen in UTC. Tage und Wochentage rechnet erst dieser Code, in
 * der Zeitzone des Browsers: 23 Uhr in Berlin ist ein anderer Tag als 23 Uhr UTC.
 *
 * Gezeichnet wird mit HTML und CSS statt SVG - dann wächst alles mit seiner
 * Spalte, ohne dass jemand Breiten nachmessen und beim Umbauen neu zeichnen muss.
 */
import { need, picture } from "../core/Dom.js";
import { numbers } from "../core/Format.js";
import { clickSound } from "../core/Sound.js";
import { KNOWN_MODULES } from "../constants/Modules.js";
import { rankIcon } from "../constants/Ranks.js";
import { BASE } from "../core/Base.js";
const HOUR = 3_600_000;
/** Die Kennzahlen vergleichen sieben Tage mit den sieben davor. */
const WEEK = 7 * 24;
/** So viele Tage zeigt der Verlauf, so viele die Heatmap. */
const DAYS = 30;
const HEAT_DAYS = 28;
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const TITLES = {
    messages: "Nachrichten pro Tag",
    voice: "Zeit im Sprachkanal pro Tag",
    members: "Beitritte und Abgänge pro Tag",
};
const HEAT_TITLES = {
    messages: "Nachrichten",
    voice: "Zeit im Sprachkanal",
    members: "Beitritte",
};
// Die Rangstufen in Familien, wie das Spiel sie zeigt: Bronze I bis III ist ein Balken.
const FAMILIES = [
    { label: "Unranked", from: 0, to: 0 },
    { label: "Bronze", from: 1, to: 3 },
    { label: "Silber", from: 4, to: 6 },
    { label: "Gold", from: 7, to: 9 },
    { label: "Platin", from: 10, to: 12 },
    { label: "Diamant", from: 13, to: 15 },
    { label: "Champion", from: 16, to: 18 },
    { label: "Grand Champion", from: 19, to: 21 },
    { label: "SSL", from: 22, to: 22 },
];
const oneDigit = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
/* ----------------------------------------------------------
   Zahlen und Zeiten
   ---------------------------------------------------------- */
function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}
function count(value, one, many) {
    return `${numbers.format(value)} ${value === 1 ? one : many}`;
}
/** Minuten als Zeit: unter einer Stunde in Minuten, darüber in Stunden. */
function duration(minutes) {
    if (minutes < 60)
        return `${numbers.format(minutes)} Min.`;
    const hours = minutes / 60;
    return `${hours < 10 ? oneDigit.format(hours) : numbers.format(Math.round(hours))} Std.`;
}
function dayLabel(date) {
    return date.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
}
function shortDay(date) {
    return date.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" });
}
function longDay(at) {
    return new Date(at).toLocaleDateString("de-DE", { day: "numeric", month: "long" });
}
// Eine runde Obergrenze für die Achse: eins, zwei oder fünf mal eine Zehnerpotenz.
function niceMax(value) {
    if (value <= 1)
        return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    for (const step of [1, 2, 5])
        if (value <= step * power)
            return step * power;
    return 10 * power;
}
/* ----------------------------------------------------------
   Einblendung am Zeiger
   ---------------------------------------------------------- */
let bubble = null;
function tip() {
    if (!bubble) {
        bubble = document.createElement("div");
        bubble.className = "charttip";
        bubble.setAttribute("role", "tooltip");
        bubble.hidden = true;
        document.body.append(bubble);
    }
    return bubble;
}
// Der Wert zuerst, dann wozu er gehört - wer hinzeigt, kennt die Reihe schon.
function hover(target, read) {
    const box = tip();
    function place(event) {
        const x = Math.max(8, Math.min(event.clientX + 14, window.innerWidth - box.offsetWidth - 8));
        const below = event.clientY + 18 + box.offsetHeight < window.innerHeight;
        const y = below ? event.clientY + 18 : event.clientY - box.offsetHeight - 12;
        box.style.transform = `translate(${x}px, ${y}px)`;
    }
    target.addEventListener("pointerenter", (event) => {
        const [value, label] = read();
        const strong = document.createElement("b");
        strong.textContent = value;
        box.replaceChildren(strong, label);
        box.hidden = false;
        place(event);
    });
    target.addEventListener("pointermove", place);
    target.addEventListener("pointerleave", () => {
        box.hidden = true;
    });
}
function tile(host, label, key) {
    const box = document.createElement("div");
    box.className = "tile";
    const value = document.createElement("b");
    value.textContent = "—";
    const name = document.createElement("span");
    name.textContent = label;
    if (key) {
        name.dataset.key = "";
        name.style.setProperty("--key", key);
    }
    const note = document.createElement("i");
    box.append(value, name, note);
    host.append(box);
    return { value, note };
}
// Mehr ist hier besser: grün nach oben, rot nach unten - dazu ein Pfeil, damit
// es nicht allein an der Farbe hängt.
function trend(note, now, before) {
    if (before === 0) {
        note.textContent = now > 0 ? "neu gegenüber der Vorwoche" : "wie in der Vorwoche";
        return;
    }
    const change = Math.round(((now - before) / before) * 100);
    if (change === 0) {
        note.textContent = "genau wie in der Vorwoche";
        return;
    }
    note.textContent = `${change > 0 ? "▲" : "▼"} ${numbers.format(Math.abs(change))} % zur Vorwoche`;
    note.classList.add(change > 0 ? "is-up" : "is-down");
}
function daysOf(activity, series) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: DAYS }, (_, index) => {
        const date = new Date(today);
        date.setDate(today.getDate() - (DAYS - 1 - index));
        return { date, values: series.map(() => 0) };
    });
    const slot = new Map(days.map((day, index) => [day.date.getTime(), index]));
    const length = series[0]?.length ?? 0;
    for (let index = 0; index < length; index++) {
        const at = new Date((activity.start + index) * HOUR);
        at.setHours(0, 0, 0, 0);
        const day = slot.get(at.getTime());
        if (day === undefined)
            continue;
        series.forEach((values, row) => {
            days[day].values[row] += values[index];
        });
    }
    // Vor der ersten gezählten Stunde gibt es keine Daten. Das ist etwas anderes
    // als ein Tag, an dem nichts los war, und sieht deshalb auch anders aus.
    const since = activity.since === null ? Number.POSITIVE_INFINITY : activity.since * HOUR;
    for (const day of days) {
        const end = new Date(day.date);
        end.setDate(end.getDate() + 1);
        if (end.getTime() <= since)
            day.values = null;
    }
    return days;
}
function valueText(value, metric) {
    if (metric === "voice")
        return duration(value);
    if (metric === "members")
        return count(value, "Beitritt", "Beitritte");
    return count(value, "Nachricht", "Nachrichten");
}
function dayTip(day, metric) {
    const when = dayLabel(day.date);
    if (!day.values)
        return ["Keine Daten", `${when} · vor Beginn der Zählung`];
    if (metric === "members") {
        return [
            `+${numbers.format(day.values[0])} / −${numbers.format(day.values[1])}`,
            `${count(day.values[0], "Beitritt", "Beitritte")}, ${count(day.values[1], "Abgang", "Abgänge")} · ${when}`,
        ];
    }
    return [valueText(day.values[0], metric), when];
}
function bar(share, color) {
    const mark = document.createElement("i");
    mark.style.setProperty("--bar", color);
    // Ein Wert über null soll auch sichtbar sein, sonst fehlt der Tag scheinbar ganz.
    mark.style.height = share > 0 ? `max(2px, ${(share * 100).toFixed(2)}%)` : "0";
    return mark;
}
function legend(items) {
    const box = document.createElement("div");
    box.className = "ovlegend";
    for (const [text, color] of items) {
        const item = document.createElement("span");
        item.style.setProperty("--key", color);
        item.textContent = text;
        box.append(item);
    }
    return box;
}
function columns(host, days, metric) {
    // Voice steht in Minuten, gezeigt werden Stunden - sonst hieße die Achse 600.
    const scale = metric === "voice" ? 60 : 1;
    const highest = Math.max(0, ...days.map((day) => (day.values ? Math.max(...day.values) : 0))) / scale;
    const max = niceMax(highest);
    const split = metric === "members";
    const chart = document.createElement("div");
    chart.className = "cols";
    chart.style.setProperty("--n", String(days.length));
    const plot = document.createElement("div");
    plot.className = "cols__plot";
    const label = (value) => (metric === "voice" ? duration(value * 60) : numbers.format(value));
    // Beim Aufteilen liegt die Null in der Mitte: Beitritte nach oben, Abgänge
    // nach unten. Sonst nur runde Werte - eine Achse mit 2,5 liest niemand gern.
    const ticks = split
        ? [
            [100, max],
            [50, 0],
            [0, max],
        ]
        : max % 2 === 0
            ? [
                [100, max],
                [50, max / 2],
                [0, 0],
            ]
            : [
                [100, max],
                [0, 0],
            ];
    for (const [at, value] of ticks) {
        const line = document.createElement("span");
        line.className = "cols__line";
        line.style.bottom = `${at}%`;
        const text = document.createElement("em");
        text.textContent = label(value);
        line.append(text);
        plot.append(line);
    }
    const bars = document.createElement("div");
    bars.className = "cols__bars";
    for (const day of days) {
        const column = document.createElement("div");
        column.className = split ? "col col--split" : "col";
        if (!day.values)
            column.classList.add("is-none");
        if (split) {
            const up = document.createElement("span");
            const down = document.createElement("span");
            up.append(bar((day.values?.[0] ?? 0) / max, "var(--viz-join)"));
            down.append(bar((day.values?.[1] ?? 0) / max, "var(--viz-leave)"));
            column.append(up, down);
        }
        else {
            const color = metric === "voice" ? "var(--viz-voice)" : "var(--viz-chat)";
            column.append(bar((day.values?.[0] ?? 0) / scale / max, color));
        }
        hover(column, () => dayTip(day, metric));
        bars.append(column);
    }
    plot.append(bars);
    const axis = document.createElement("div");
    axis.className = "cols__axis";
    days.forEach((day, index) => {
        // Jeder siebte Tag, von heute aus gezählt - so trägt der heutige eine Beschriftung.
        if ((days.length - 1 - index) % 7 !== 0)
            return;
        const text = document.createElement("span");
        text.style.gridColumn = String(index + 1);
        text.textContent = index === days.length - 1 ? "Heute" : shortDay(day.date);
        axis.append(text);
    });
    chart.append(plot, axis);
    // Dieselben Zahlen als Tabelle - für Vorlesesoftware, und für alle, die
    // lieber lesen als zeigen.
    const table = document.createElement("table");
    table.className = "sr";
    const caption = document.createElement("caption");
    caption.textContent = TITLES[metric];
    table.append(caption);
    for (const day of days) {
        const row = table.insertRow();
        row.insertCell().textContent = dayLabel(day.date);
        row.insertCell().textContent = dayTip(day, metric)[0];
    }
    const pieces = [];
    if (split) {
        pieces.push(legend([
            ["Beitritte", "var(--viz-join)"],
            ["Abgänge", "var(--viz-leave)"],
        ]));
    }
    pieces.push(chart, table);
    host.replaceChildren(...pieces);
}
/* ----------------------------------------------------------
   Heatmap
   ---------------------------------------------------------- */
/** Zeichnet die Heatmap und gibt zurück, wann am meisten los war. */
function heatmap(host, activity, series, metric) {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (let index = Math.max(0, series.length - HEAT_DAYS * 24); index < series.length; index++) {
        const at = new Date((activity.start + index) * HOUR);
        // Montag zuerst, wie im deutschen Kalender.
        grid[(at.getDay() + 6) % 7][at.getHours()] += series[index];
    }
    const max = Math.max(0, ...grid.flat());
    let peak = { value: 0, day: 0, hour: 0 };
    const box = document.createElement("div");
    box.className = "heat";
    grid.forEach((hours, day) => {
        const name = document.createElement("span");
        name.className = "heat__day";
        name.textContent = WEEKDAYS[day];
        box.append(name);
        hours.forEach((value, hour) => {
            const cell = document.createElement("i");
            cell.className = "heat__cell";
            // Fünf Stufen statt eines stufenlosen Verlaufs: nebeneinander sind
            // fünf Helligkeiten zu unterscheiden, zwanzig nicht.
            if (value === 0 || max === 0)
                cell.dataset.zero = "";
            else
                cell.style.setProperty("--v", (Math.ceil((value / max) * 5) / 5).toFixed(1));
            if (value > peak.value)
                peak = { value, day, hour };
            hover(cell, () => [valueText(value, metric), `${WEEKDAYS_LONG[day]}, ${hour}–${hour + 1} Uhr`]);
            box.append(cell);
        });
    });
    // Letzte Zeile: die Stunden, jede dritte beschriftet.
    box.append(document.createElement("span"));
    for (let hour = 0; hour < 24; hour++) {
        const text = document.createElement("span");
        text.className = "heat__hour";
        text.textContent = hour % 3 === 0 ? String(hour) : "";
        box.append(text);
    }
    const scale = document.createElement("div");
    scale.className = "heat__legend";
    const less = document.createElement("span");
    less.textContent = "wenig";
    const more = document.createElement("span");
    more.textContent = "viel";
    scale.append(less, document.createElement("i"), more);
    host.replaceChildren(box, scale);
    return peak.value > 0 ? `Spitze: ${WEEKDAYS_LONG[peak.day]}, ${peak.hour}–${peak.hour + 1} Uhr` : "";
}
/* ----------------------------------------------------------
   Listen
   ---------------------------------------------------------- */
function channels(host, activity) {
    if (activity.channels.length === 0) {
        const empty = document.createElement("li");
        empty.className = "ovempty";
        empty.textContent = "Noch keine Nachrichten gezählt.";
        host.replaceChildren(empty);
        return;
    }
    const max = Math.max(...activity.channels.map((channel) => channel.messages));
    host.replaceChildren(...activity.channels.map((channel) => {
        const row = document.createElement("li");
        const name = document.createElement("b");
        name.textContent = channel.name ? `#${channel.name}` : "Gelöschter Kanal";
        if (!channel.name)
            name.classList.add("is-empty");
        const value = document.createElement("em");
        value.textContent = numbers.format(channel.messages);
        const mark = document.createElement("i");
        mark.style.setProperty("--w", `${(channel.messages / max) * 100}%`);
        row.append(name, value, mark);
        return row;
    }));
}
function people(title, key, list, format) {
    const box = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = title;
    heading.style.setProperty("--key", key);
    box.append(heading);
    if (list.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "Noch niemand.";
        box.append(empty);
        return box;
    }
    const ranking = document.createElement("ol");
    for (const person of list) {
        const row = document.createElement("li");
        const face = person.avatar
            ? picture(person.avatar, "toplists__face")
            : document.createElement("span");
        if (!person.avatar)
            face.className = "toplists__face";
        const name = document.createElement("b");
        name.textContent = person.name ?? "Ehemaliges Mitglied";
        if (!person.name)
            name.classList.add("is-empty");
        const value = document.createElement("em");
        value.textContent = format(person.value);
        row.append(face, name, value);
        ranking.append(row);
    }
    box.append(ranking);
    return box;
}
/* ----------------------------------------------------------
   Rang-Verteilung
   ---------------------------------------------------------- */
function ranks(host, sub, activity, userId) {
    const found = activity.ranks;
    if (!found) {
        sub.textContent = "";
        host.replaceChildren(hint("Dafür braucht der Bot die vollständige Mitgliederliste - das Members-Intent ist aus."));
        return;
    }
    if (found.linked === 0) {
        sub.textContent = "";
        const empty = hint("Noch hat hier niemand sein Epic-Konto verknüpft.");
        const link = document.createElement("a");
        link.href = `${BASE}/user/${encodeURIComponent(userId)}/settings#verknuepfungen`;
        link.textContent = "Deines verknüpfen";
        empty.append(" ", link);
        host.replaceChildren(empty);
        return;
    }
    const counts = FAMILIES.map((family) => sum(found.tiers.slice(family.from, family.to + 1)));
    const known = sum(counts);
    const max = Math.max(1, ...counts);
    sub.textContent = `Höchster Rang je Spieler über 1v1, 2v2 und 3v3 · ${known} von ${count(found.linked, "verknüpften Mitglied", "verknüpften Mitgliedern")} mit Rang`;
    const box = document.createElement("div");
    box.className = "rankbars";
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", FAMILIES.map((family, index) => `${family.label}: ${counts[index]}`).join(", "));
    FAMILIES.forEach((family, index) => {
        const column = document.createElement("div");
        column.className = "rankbar";
        const value = document.createElement("em");
        value.textContent = counts[index] > 0 ? numbers.format(counts[index]) : "";
        // Das Abzeichen der dritten Stufe steht für die ganze Familie: Bronze III
        // statt Bronze I. Unranked und SSL haben nur eines.
        //
        // Bewusst ohne picture(): das entfernt ein Bild, das nicht kommt, und
        // ließe die Spalte leer. So steht der Name des Rangs da, wenn eine
        // Anfrage ins Leere läuft - etwa während der Bot gerade neu startet.
        const badge = document.createElement("img");
        badge.className = "rankbar__badge";
        badge.src = rankIcon(family.to);
        badge.alt = family.label;
        // Sofort laden, nicht verzögert: die neun kleinen Fassungen wiegen
        // zusammen rund 120 KB. Verzögert werden sie unzuverlässig - die Karte
        // entsteht per Skript, und der Browser stuft sie einmal als weit entfernt
        // ein und fragt danach nicht noch einmal nach.
        badge.loading = "eager";
        badge.decoding = "async";
        column.append(value);
        // Ohne Spieler kein Balken - ein Strich auf der Grundlinie sähe aus wie
        // ein Wert, der zu klein zum Ablesen ist.
        if (counts[index] > 0) {
            const mark = document.createElement("i");
            mark.style.setProperty("--p", String(counts[index] / max));
            column.append(mark);
        }
        column.append(badge);
        hover(column, () => [count(counts[index], "Spieler", "Spieler"), family.label]);
        box.append(column);
    });
    host.replaceChildren(box);
}
function hint(text) {
    const line = document.createElement("p");
    line.className = "ovempty";
    line.textContent = text;
    return line;
}
/**
 * Holt die Zahlen. Läuft getrennt von der Anzeige, damit die Abfrage schon
 * starten kann, während die Serverliste noch unterwegs ist - siehe
 * prefetchGuild() in Guild.ts. 503 heißt: der Bot hat keine Datenbank.
 */
export async function fetchActivity(guildId) {
    try {
        const response = await fetch(`${BASE}/api/guild/${encodeURIComponent(guildId)}/activity`, {
            headers: { Accept: "application/json" },
        });
        if (!response.ok)
            return { ok: false, reason: response.status === 503 ? "offline" : "error" };
        return { ok: true, activity: (await response.json()) };
    }
    catch {
        return { ok: false, reason: "error" };
    }
}
// Bis die Zahlen da sind, sagen die Karten das. Eine leere Karte sieht aus wie
// ein Fehler.
function waitingHint() {
    for (const id of ["#ovChart", "#ovHeat", "#ovRanks", "#ovPeople"]) {
        need(id).replaceChildren(hint("Wird geladen …"));
    }
    const row = document.createElement("li");
    row.className = "ovempty";
    row.textContent = "Wird geladen …";
    need("#ovChannels").replaceChildren(row);
}
function bindMetric(activity) {
    const control = need("#ovMetric");
    const buttons = [...control.querySelectorAll("button[data-metric]")];
    function show(metric) {
        for (const button of buttons)
            button.setAttribute("aria-pressed", String(button.dataset.metric === metric));
        const series = metric === "voice" ? [activity.voice] : metric === "members" ? [activity.joins, activity.leaves] : [activity.messages];
        const days = daysOf(activity, series);
        const start = activity.since === null ? "" : ` · gezählt seit ${longDay(activity.since * HOUR)}`;
        need("#ovChartTitle").textContent = TITLES[metric];
        need("#ovChartSub").textContent = `Letzte ${DAYS} Tage${start}`;
        columns(need("#ovChart"), days, metric);
        const peak = heatmap(need("#ovHeat"), activity, series[0], metric);
        const heat = `${HEAT_TITLES[metric]} der letzten vier Wochen nach Wochentag und Uhrzeit, in deiner Zeitzone`;
        need("#ovHeatSub").textContent = peak ? `${heat} · ${peak}` : heat;
    }
    for (const button of buttons) {
        button.addEventListener("click", () => {
            show((button.dataset.metric ?? "messages"));
            clickSound("primary");
        });
    }
    show("messages");
}
function week(activity, joins, messages, voice) {
    const length = activity.messages.length;
    const last = (series) => sum(series.slice(length - WEEK));
    const before = (series) => sum(series.slice(length - 2 * WEEK, length - WEEK));
    messages.value.textContent = numbers.format(last(activity.messages));
    voice.value.textContent = duration(last(activity.voice));
    joins.value.textContent = numbers.format(last(activity.joins));
    const left = last(activity.leaves);
    const net = last(activity.joins) - left;
    const sign = net > 0 ? "+" : net < 0 ? "−" : "±";
    joins.note.textContent = `${count(left, "Abgang", "Abgänge")} · netto ${sign}${numbers.format(Math.abs(net))}`;
    // Verglichen wird nur, wenn die Vorwoche ganz gezählt ist - eine halbe
    // Vorwoche sähe wie ein Einbruch aus.
    if (activity.since !== null && activity.since <= activity.start + length - 2 * WEEK) {
        trend(messages.note, last(activity.messages), before(activity.messages));
        trend(voice.note, last(activity.voice), before(activity.voice));
    }
    else if (activity.since !== null) {
        const since = `gezählt seit ${longDay(activity.since * HOUR)}`;
        messages.note.textContent = since;
        voice.note.textContent = since;
    }
}
export async function renderOverview(guild, userId, waiting) {
    const host = need("#ovTiles");
    const members = tile(host, "Mitglieder", null);
    const joins = tile(host, "Beitritte · 7 Tage", "var(--viz-join)");
    const messages = tile(host, "Nachrichten · 7 Tage", "var(--viz-chat)");
    const voice = tile(host, "Voice · 7 Tage", "var(--viz-voice)");
    const teams = tile(host, "Teams", null);
    const modules = tile(host, "Module", null);
    const humans = guild.bots === null ? guild.members : Math.max(guild.members - guild.bots, 0);
    members.value.textContent = numbers.format(humans);
    members.note.textContent = guild.bots === null ? "Bots inbegriffen" : `dazu ${count(guild.bots, "Bot", "Bots")}`;
    teams.value.textContent = numbers.format(guild.teams);
    teams.note.textContent = "aktiv";
    modules.value.textContent = `${guild.modules.filter((id) => KNOWN_MODULES.has(id)).length} / ${KNOWN_MODULES.size}`;
    modules.note.textContent = "eingeschaltet";
    function note(text) {
        const box = need("#ovNote");
        box.querySelector("span").textContent = text;
        box.hidden = false;
    }
    function fold() {
        for (const id of ["#ovTrend", "#ovWho", "#ovRanksCard"])
            need(id).hidden = true;
    }
    if (!guild.active) {
        note("RL Nexus ist nicht auf diesem Server - ohne den Bot gibt es nichts zu zählen.");
        fold();
        return;
    }
    waitingHint();
    const result = await waiting;
    if (!result.ok) {
        note(result.reason === "offline"
            ? "Die Aktivität steht in der Datenbank des Bots - die ist gerade nicht erreichbar."
            : "Die Aktivität lässt sich gerade nicht laden. Lade die Seite in einem Moment neu.");
        fold();
        return;
    }
    const activity = result.activity;
    if (activity.since === null) {
        note("RL Nexus zählt ab jetzt mit. Die ersten Werte stehen nach spätestens einer Minute hier.");
    }
    week(activity, joins, messages, voice);
    bindMetric(activity);
    channels(need("#ovChannels"), activity);
    need("#ovPeople").replaceChildren(people("Im Chat", "var(--viz-chat)", activity.chatters, (value) => numbers.format(value)), people("Im Voice", "var(--viz-voice)", activity.talkers, duration));
    ranks(need("#ovRanks"), need("#ovRanksSub"), activity, userId);
}
