/** Seite: Raenge, Karriere und Club eines Spielers. */
import { icon, need, maybe, picture } from "../core/Dom.js";
import { numbers } from "../core/Format.js";
import { STAT_COLORS, rankImage, tierColor } from "../constants/Ranks.js";
import { platformIcon } from "../constants/Platforms.js";
import { BASE } from "../core/Base.js";
// Die Reward-Stufen einer Saison. Stufe 0 heißt: noch nichts freigespielt.
export const REWARD_LEVELS = [
    "Kein Reward",
    "Bronze",
    "Silber",
    "Gold",
    "Platin",
    "Diamant",
    "Champion",
    "Grand Champion",
    "Supersonic Legend",
];
export const REWARD_WINS = 10;
// Das Reward-Abzeichen ist dasselbe Bild wie der Rang - Stufe 1 ist Bronze I.
export function rewardImage(level) {
    return rankImage(level > 0 ? (level - 1) * 3 + 1 : 0);
}
/**
 * Der Season-Reward als breiter Streifen über den Rang-Karten.
 *
 * Er gilt für die ganze Saison - die drei Playlists darunter sind nur der Weg
 * dorthin, deshalb steht er darüber und nicht neben der Karriere.
 */
export function paintReward(level, wins) {
    const box = document.createElement("div");
    box.className = "reward__inner";
    // Die Reward-Farbe faerbt Rahmen und Schimmer des Streifens ein. Stufe 1
    // ist Bronze I, also dieselbe Staffelung wie bei den Raengen.
    box.style.setProperty("--tier", tierColor(level > 0 ? (level - 1) * 3 + 1 : 0));
    box.append(picture(rewardImage(level), "reward__badge"));
    const text = document.createElement("div");
    text.className = "reward__text";
    const eyebrow = document.createElement("span");
    eyebrow.className = "reward__eyebrow";
    eyebrow.textContent = "Season-Reward";
    const name = document.createElement("b");
    name.textContent = REWARD_LEVELS[level] ?? REWARD_LEVELS[0];
    const meta = document.createElement("span");
    meta.className = "reward__meta";
    // Bei der höchsten Stufe gibt es nichts mehr freizuspielen.
    const top = level >= REWARD_LEVELS.length - 1;
    meta.textContent = top
        ? "Höchste Stufe erreicht"
        : `${wins} von ${REWARD_WINS} Siegen bis zur nächsten Stufe`;
    text.append(eyebrow, name, meta);
    const track = document.createElement("div");
    track.className = "reward__track";
    const bar = document.createElement("span");
    bar.className = "reward__bar";
    const fill = document.createElement("i");
    const percent = top ? 100 : Math.min(Math.round((wins / REWARD_WINS) * 100), 100);
    fill.style.width = `${percent}%`;
    const count = document.createElement("span");
    count.className = "reward__count";
    count.textContent = top ? "MAX" : `${wins}/${REWARD_WINS}`;
    bar.appendChild(fill);
    track.append(bar, count);
    box.append(text, track);
    return box;
}
export function club_(club) {
    return `${club.name} [${club.tag}]`;
}
/** Eine Zeile im Fakten-Raster der Club-Karte. */
export function clubFact(label, value) {
    const box = document.createElement("div");
    box.className = "clubfact";
    const name = document.createElement("span");
    name.textContent = label;
    const text = document.createElement("b");
    text.textContent = value;
    box.append(name, text);
    return box;
}
/**
 * Die Club-Karte rechts neben 3v3.
 *
 * Oben die Durchschnitts-MMR nach WTSI, darunter die Eckdaten und die
 * Mitglieder. Der eigene WTSI-Wert steht daneben: er zeigt, womit der Spieler
 * selbst in den Schnitt eingeht.
 */
export function paintClub(club, wtsi, ownName) {
    const box = document.createElement("div");
    box.className = "club__inner";
    const head = document.createElement("div");
    head.className = "club__head";
    const tag = document.createElement("span");
    tag.className = "club__tag";
    tag.textContent = club.tag;
    const title = document.createElement("div");
    title.className = "club__title";
    const name = document.createElement("b");
    name.textContent = club.name;
    const meta = document.createElement("span");
    meta.textContent = `${club.members.length} Mitglied${club.members.length === 1 ? "" : "er"}`;
    title.append(name, meta);
    head.append(tag, title);
    // Ein von Psyonix bestaetigter Club - das haben sehr wenige, und genau
    // deshalb lohnt es sich, es zu zeigen.
    if (club.verified) {
        const ok = document.createElement("span");
        ok.className = "pill pill--role";
        ok.append(icon("#i-check"), "verifiziert");
        head.appendChild(ok);
    }
    box.appendChild(head);
    // Ohne Ränge im Club gibt es keinen Durchschnitt - dann steht ein Strich da,
    // statt eine Null, die nach echtem Wert aussähe.
    const mmr = document.createElement("div");
    mmr.className = "club__mmr";
    const value = document.createElement("b");
    value.textContent = club.averageMMR === null ? "—" : numbers.format(club.averageMMR);
    const label = document.createElement("i");
    label.textContent = "Ø Club-MMR · WTSI";
    mmr.append(value, label);
    const mine = document.createElement("div");
    mine.className = "club__mine";
    const own = document.createElement("b");
    // Nicht auf null pruefen, sondern auf falsy: eine noch gecachte Antwort von
    // vor dem Deploy hat das Feld gar nicht, und 0 heisst ohnehin "nichts da".
    own.textContent = wtsi ? numbers.format(wtsi) : "—";
    const ownLabel = document.createElement("i");
    ownLabel.textContent = "Dein WTSI";
    mine.append(own, ownLabel);
    const scores = document.createElement("div");
    scores.className = "club__scores";
    scores.append(mmr, mine);
    box.appendChild(scores);
    const owner = club.members.find((member) => member.owner);
    const facts = document.createElement("div");
    facts.className = "clubfacts";
    facts.append(clubFact("Tag", club.tag), clubFact("Owner", owner?.name ?? "—"), clubFact("Mitglieder", String(club.members.length)), clubFact("Gegründet", club.createdAt ? new Date(club.createdAt).toLocaleDateString("de-DE") : "—"));
    box.appendChild(facts);
    const list = document.createElement("div");
    list.className = "club__members";
    for (const member of club.members) {
        const row = document.createElement("div");
        row.className = "club__member";
        const who = document.createElement("span");
        who.className = "club__who";
        // Der eigene Eintrag wird am Spielernamen erkannt: eine Discord-ID hat
        // ein Club-Mitglied nicht zwingend, einen Namen im Spiel immer.
        const self = ownName !== null && member.name === ownName;
        who.textContent = self ? `${member.name} (Du)` : member.name;
        if (member.owner)
            row.append(icon("#i-crown"));
        row.append(who);
        // Die MMR des Mitglieds - der Beitrag zum Schnitt daneben.
        const score = document.createElement("span");
        score.className = "tagline";
        score.textContent = member.mmr === null ? "—" : numbers.format(member.mmr);
        row.append(score);
        list.appendChild(row);
    }
    box.appendChild(list);
    return box;
}
export function rankCard(rank) {
    const card = document.createElement("div");
    card.className = "rankcard";
    card.style.setProperty("--tier", tierColor(rank.placement ? 0 : rank.tier));
    const mode = document.createElement("span");
    mode.className = "rankcard__mode";
    mode.textContent = rank.label;
    const badge = picture(rankImage(rank.tier, rank.placement), "rankcard__badge");
    const tier = document.createElement("b");
    // Der Rang steht erst nach den Platzierungsspielen fest.
    tier.textContent = rank.placement
        ? `Platzierung ${rank.placementMatches}/10`
        : rank.tierName + (rank.divisionName ? ` · Div ${rank.divisionName}` : "");
    const mmr = document.createElement("span");
    mmr.className = "rankcard__mmr";
    mmr.textContent = numbers.format(rank.mmr);
    const unit = document.createElement("i");
    unit.textContent = "MMR";
    mmr.appendChild(unit);
    const meta = document.createElement("span");
    meta.className = "rankcard__meta";
    meta.textContent = rank.matches === 1 ? "1 Spiel" : `${numbers.format(rank.matches)} Spiele`;
    card.append(mode, badge, tier, mmr, meta);
    // Die Serie steht als eigenes Abzeichen darunter: gruen bei Siegen, rot bei
    // Niederlagen. Bei 0 gibt es keine Serie - dann bleibt die Zeile weg.
    if (rank.streak !== 0) {
        const won = rank.streak > 0;
        const count = Math.abs(rank.streak);
        const streak = document.createElement("span");
        streak.className = `streak ${won ? "streak--win" : "streak--loss"}`;
        streak.append(icon(won ? "#i-boost" : "#i-warn"));
        streak.append(`${count} ${won ? (count === 1 ? "Sieg" : "Siege") : count === 1 ? "Niederlage" : "Niederlagen"} in Folge`);
        card.appendChild(streak);
    }
    return card;
}
export function statTile(stat) {
    const box = document.createElement("div");
    box.className = "stat";
    box.style.setProperty("--stat", STAT_COLORS[stat.key] ?? "var(--brand)");
    // Die Symbole sind schwarze Striche. Als Maske gesetzt nehmen sie die Farbe
    // des Werts an, wie auf der Rang-Karte und auf der Webseite. Fehlt eine
    // Datei, bleibt die Maske leer und nur das Symbol fehlt, der Wert steht.
    const symbol = document.createElement("span");
    symbol.className = "stat__icon";
    symbol.setAttribute("aria-hidden", "true");
    symbol.style.setProperty("--icon", `url("${BASE}/assets/images/rocketleague/rlstatsicons/${stat.key}.png")`);
    box.append(symbol);
    const value = document.createElement("b");
    value.textContent = numbers.format(stat.value);
    const label = document.createElement("span");
    label.textContent = stat.label;
    box.append(value, label);
    return box;
}
/**
 * Wie lange der gezeigte Stand noch gilt - und das Nachladen, sobald er abläuft.
 *
 * Der Bot holt Ränge höchstens alle zehn Minuten neu; dazwischen kommt alles
 * aus der Datenbank. Ohne Anzeige wirkt das wie eine hängengebliebene Seite —
 * mit ihr ist zu sehen, dass die Zahl absichtlich stehenbleibt. Läuft der
 * Zähler ab, holt die Seite den neuen Stand selbst, ohne dass jemand neu lädt.
 *
 * Der Zähler läuft im Browser weiter, ohne nachzufragen: der Termin steht fest,
 * sobald die Antwort da ist. Zurück kommt der Setter, mit dem jede
 * Aktualisierung den nächsten Termin meldet - null heißt: keiner mehr.
 */
export const RANK_MAX_AGE = 10 * 60 * 1000;
// Etwas Luft hinter dem Ablauf: der Bot holt erst neu, wenn der Stand älter als
// zehn Minuten ist, nicht schon, wenn er genau so alt ist.
const REFRESH_SLACK = 1000;
// Nach einem Aussetzer - Bot neu gestartet, Netz weg - kommt der nächste Versuch
// nach einer Minute. Rocket League fragt der Bot dadurch nicht öfter: ob er
// nachfragt, entscheidet allein das Alter des gespeicherten Stands.
const RETRY_AFTER = 60 * 1000;
/**
 * Wann der Bot den Stand wieder bei Rocket League holt, umgerechnet auf die Uhr
 * des Browsers. Der Date-Kopf der Antwort zeigt, wie weit beide auseinanderliegen:
 * ein vorgehender Browser fragte sonst zu früh, bekäme den alten Stand und
 * wartete eine ganze Runde.
 *
 * Ist der gelieferte Stand schon abgelaufen, antwortet Rocket League gerade
 * nicht. Dann kommt der nächste Versuch erst nach einer vollen Runde.
 */
function nextRefresh(updatedAt, served) {
    const at = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    if (Number.isNaN(at))
        return null;
    const sent = served ? Date.parse(served) : Number.NaN;
    const skew = Number.isNaN(sent) ? 0 : sent - Date.now();
    const expires = at + RANK_MAX_AGE - skew + REFRESH_SLACK;
    return expires > Date.now() ? expires : Date.now() + RANK_MAX_AGE;
}
export function bindFreshness(refresh) {
    const box = maybe("#freshness");
    const value = maybe("#freshTimer");
    const label = maybe("#freshLabel");
    if (!box || !value || !label)
        return () => undefined;
    let due = null;
    function paint() {
        if (due === null) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        // Abgelaufen: neu holen. Ein verdeckter Tab wartet, bis wieder jemand
        // hinsieht - sonst fragte der Bot für niemanden bei Rocket League nach.
        // Der Termin rückt vorher eine volle Runde vor, damit ein Abruf, der
        // nichts Neues bringt oder scheitert, nicht jede Sekunde wiederkommt.
        if (Date.now() >= due && !document.hidden) {
            due = Date.now() + RANK_MAX_AGE;
            refresh();
        }
        const left = due - Date.now();
        // Steht nur im verdeckten Tab da: sobald er wieder zu sehen ist, wird geholt.
        if (left <= 0) {
            box.classList.add("is-due");
            value.textContent = "Jetzt";
            label.textContent = "wird aktualisiert";
            return;
        }
        box.classList.remove("is-due");
        const seconds = Math.ceil(left / 1000);
        value.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        label.textContent = "bis zur Aktualisierung";
    }
    // Genau ein Intervall für die ganze Seite. Läge es im Setter, liefen nach
    // dem dritten Neuladen drei Zähler gegeneinander.
    window.setInterval(paint, 1000);
    return (next) => {
        due = next;
        paint();
    };
}
export async function renderTracking() {
    const panel = need("#trackPanel");
    const empty = need("#empty");
    // /user/<userId>/tracking - die ID steht vor dem letzten Abschnitt.
    const parts = window.location.pathname.split("/").filter(Boolean);
    const userId = parts[parts.length - 2] ?? "";
    const setDue = bindFreshness(() => void load());
    function fail(title, text) {
        // Kein Zugriff, kein Konto: daran ändert auch ein neuer Versuch nichts.
        setDue(null);
        panel.hidden = true;
        empty.classList.add("is-on", "empty--error");
        need("#emptyIcon use").setAttribute("href", "#i-warn");
        need("#emptyTitle").textContent = title;
        need("#emptyText").textContent = text;
    }
    // Ein Aussetzer beim Nachladen wischt den gezeigten Stand nicht weg: steht
    // schon etwas da, bleibt es stehen, bis der nächste Versuch klappt.
    function retry(title, text) {
        if (panel.hidden)
            fail(title, text);
        setDue(Date.now() + RETRY_AFTER);
    }
    async function load() {
        let response;
        try {
            response = await fetch(`${BASE}/api/tracking/${encodeURIComponent(userId)}`, {
                headers: { Accept: "application/json" },
            });
        }
        catch {
            return retry("Der Bot antwortet gerade nicht", "Die Seite versucht es gleich noch einmal.");
        }
        if (response.status === 403) {
            return fail("Kein Zugriff", "Fremde Rang-Seiten sehen nur Administratoren und Developer.");
        }
        if (response.status === 404) {
            const body = (await response.json().catch(() => ({})));
            return fail("Kein Epic-Konto verknüpft", body.own
                ? "Verbinde es im Nutzermenü unter RL Tracker, dann stehen die Ränge hier."
                : "Dieser Spieler hat sein Rocket-League-Konto noch nicht verbunden.");
        }
        // Überlastet oder gestört: gleich noch einmal. Alles andere bleibt ein Fehler.
        if (response.status === 429 || response.status >= 500) {
            return retry("Nicht ladbar", `Der Bot antwortete mit ${response.status}.`);
        }
        if (!response.ok)
            return fail("Nicht ladbar", `Der Bot antwortete mit ${response.status}.`);
        const data = (await response.json());
        empty.classList.remove("is-on");
        panel.hidden = false;
        setDue(nextRefresh(data.updatedAt, response.headers.get("Date")));
        document.title = `RL Nexus · ${data.account?.name ?? "Tracking"}`;
        const avatar = need("#playerAvatar");
        if (data.user.avatar)
            avatar.replaceChildren(picture(data.user.avatar, ""));
        else
            avatar.replaceChildren();
        need("#playerName").textContent = data.account?.name ?? data.user.name ?? "Unbekannt";
        const meta = need("#playerMeta");
        const chips = [];
        if (data.account) {
            const platform = document.createElement("span");
            platform.className = "pill";
            const image = platformIcon("Epic Games");
            if (image)
                platform.appendChild(image);
            platform.append("Epic Games");
            chips.push(platform);
            // Gruen statt Akzentfarbe: "geprueft" ist ein Zustand, kein Name. So sind
            // die drei Arten von Marken auseinanderzuhalten - wer man ist bleibt
            // schlicht, was bestaetigt ist wird gruen, wo man spielt traegt den Akzent.
            if (data.account.verified) {
                const ok = document.createElement("span");
                ok.className = "pill pill--ok";
                ok.append(icon("#i-check"), "geprüft");
                chips.push(ok);
            }
        }
        if (data.user.name) {
            const discord = document.createElement("span");
            discord.className = "pill";
            // Das Discord-Zeichen, nicht das Personen-Symbol: das trug vorher
            // der Club daneben, und zwei gleiche Symbole nebeneinander sagen
            // nichts mehr aus.
            discord.append(icon("#i-discord"), data.user.name);
            chips.push(discord);
        }
        if (data.club) {
            const club = document.createElement("span");
            club.className = "pill pill--role";
            // Name und Tag getrennt statt "Name [TAG]" - die eckigen Klammern
            // waren Text, der wie Auszeichnung aussah.
            const tag = document.createElement("i");
            tag.className = "pill__tag";
            tag.textContent = data.club.tag;
            club.append(icon("#i-users"), data.club.name, tag);
            chips.push(club);
        }
        meta.replaceChildren(...chips);
        const grid = need("#rankGrid");
        if (data.ranks.length > 0) {
            grid.replaceChildren(...data.ranks.map(rankCard));
            // Stand und Herkunft standen hier einmal als Zeile unter der Karte.
            // Beides sagt der Kopf der Seite schon: der Zaehler oben rechts,
            // wie lange dieser Stand gilt, und die Doku, woher er kommt.
            need("#trackFoot").textContent = "";
        }
        else {
            grid.replaceChildren();
            need("#trackFoot").textContent =
                data.failed ?? "Für 1v1, 2v2 und 3v3 liegt noch nichts vor.";
        }
        need("#statsBox").hidden = data.stats.length === 0;
        if (data.stats.length > 0)
            need("#statGrid").replaceChildren(...data.stats.map(statTile));
        need("#seasonBox").hidden = data.season === null;
        if (data.season) {
            need("#reward").replaceChildren(paintReward(data.season.level, data.season.wins));
        }
        need("#clubBox").hidden = data.club === null;
        if (data.club) {
            need("#club").replaceChildren(paintClub(data.club, data.wtsi, data.account?.name ?? null));
        }
    }
    need("#trackReload").addEventListener("click", () => void load());
    await load();
}
