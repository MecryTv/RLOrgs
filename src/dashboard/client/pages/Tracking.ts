/** Seite: Raenge, Karriere und Club eines Spielers. */

import { IRank } from "../interfaces/IRank.js";
import { icon, need, maybe, picture } from "../core/Dom.js";
import { numbers } from "../core/Format.js";
import { STAT_COLORS, rankIcon, tierColor } from "../constants/Ranks.js";
import { platformIcon } from "../constants/Platforms.js";
import { BASE } from "../core/Base.js";

/* ----------------------------------------------------------
   Seite: Tracking
   ---------------------------------------------------------- */
/**
 * Der Club aus dem Spiel, so wie Rocket League ihn fuehrt - nicht die Tabelle,
 * die der Bot selbst hat. Die Namen sind Spielernamen, keine Discord-Namen:
 * ein Club-Mitglied muss den Bot gar nicht kennen.
 */
export interface IClubView {
    id: number;
    name: string;
    tag: string;
    ownerPlayerId: string;
    members: { playerId: string; name: string; epicName: string | null; owner: boolean; mmr: number | null }[];
    verified: boolean;
    createdAt: string | null;
    averageMMR: number | null;
}

export interface ITrackingPayload {
    own: boolean;
    user: { id: string; name: string | null; avatar: string | null };
    account: { platform: string; name: string; verified: boolean; linkedAt: string } | null;
    ranks: IRank[];
    updatedAt: string | null;
    season: { level: number; wins: number } | null;
    stats: { key: string; label: string; value: number }[];
    club: IClubView | null;
    /** Der eigene WTSI-Wert, mit dem der Spieler in den Club-Schnitt eingeht. */
    wtsi: number | null;
    failed: string | null;
}

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
// Die kleine Fassung (160 px) reicht für 64 px; die Originale wiegen bis 220 KB.
export function rewardImage(level: number): string {
    return rankIcon(level > 0 ? (level - 1) * 3 + 1 : 0);
}

/**
 * Der Season-Reward als breiter Streifen über den Rang-Karten.
 *
 * Er gilt für die ganze Saison - die drei Playlists darunter sind nur der Weg
 * dorthin, deshalb steht er darüber und nicht neben der Karriere.
 */
export function paintReward(level: number, wins: number): HTMLElement {
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

    // Zehn Segmente statt eines Balkens: jeder Sieg ist ein Schritt, den man sieht.
    const segments = document.createElement("span");
    const done = top ? REWARD_WINS : Math.min(Math.max(wins, 0), REWARD_WINS);

    segments.className = "reward__segments";
    segments.setAttribute("role", "img");
    segments.setAttribute("aria-label", top ? "Höchste Stufe erreicht" : `${done} von ${REWARD_WINS} Siegen`);

    for (let index = 0; index < REWARD_WINS; index++) {
        const segment = document.createElement("i");

        if (index < done) segment.className = "is-on";

        segments.appendChild(segment);
    }

    const count = document.createElement("span");
    count.className = "reward__count";
    count.textContent = top ? "MAX" : `${done}/${REWARD_WINS}`;

    track.append(segments, count);
    box.append(text, track);

    return box;
}

export function club_(club: IClubView): string {
    return `${club.name} [${club.tag}]`;
}

/** Eine Zeile im Fakten-Raster der Club-Karte. */
export function clubFact(label: string, value: string): HTMLElement {
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
export function paintClub(club: IClubView, wtsi: number | null, ownName: string | null): HTMLElement {
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

    // Tag und Mitgliederzahl stehen schon im Kopf - hier nur, was dort fehlt.
    const owner = club.members.find((member) => member.owner);

    const facts = document.createElement("div");
    facts.className = "clubfacts";

    facts.append(
        clubFact("Owner", owner?.name ?? "—"),
        clubFact("Gegründet", club.createdAt ? new Date(club.createdAt).toLocaleDateString("de-DE") : "—")
    );

    box.appendChild(facts);

    // Die Mitglieder nach MMR, die stärksten oben. Der Balken zeigt den Abstand
    // zum Besten - wer ohne Rang ist, steht unten und ohne Balken.
    const ranked = [...club.members].sort((a, b) => (b.mmr ?? -1) - (a.mmr ?? -1));
    const best = Math.max(...ranked.map((member) => member.mmr ?? 0), 1);

    const heading = document.createElement("span");
    heading.className = "club__label";
    heading.textContent = "Mitglieder nach MMR";

    const list = document.createElement("ol");
    list.className = "club__members";

    ranked.forEach((member, index) => {
        const row = document.createElement("li");
        row.className = "club__member";

        // Der eigene Eintrag wird am Spielernamen erkannt: eine Discord-ID hat
        // ein Club-Mitglied nicht zwingend, einen Namen im Spiel immer.
        const self = ownName !== null && member.name === ownName;

        if (self) row.classList.add("is-self");

        row.style.setProperty("--w", member.mmr === null ? "0%" : `${Math.round((member.mmr / best) * 100)}%`);

        const position = document.createElement("span");
        position.className = "club__pos";
        position.textContent = String(index + 1);

        const who = document.createElement("span");
        who.className = "club__who";
        who.textContent = member.name;

        if (member.owner) {
            const crown = icon("#i-crown");

            crown.setAttribute("aria-label", "Owner");
            who.append(crown);
        }

        if (self) {
            const you = document.createElement("i");

            you.className = "club__you";
            you.textContent = "Du";
            who.append(you);
        }

        // Die MMR des Mitglieds - der Beitrag zum Schnitt.
        const score = document.createElement("span");
        score.className = "club__score";
        score.textContent = member.mmr === null ? "—" : numbers.format(member.mmr);

        row.append(position, who, score);
        list.appendChild(row);
    });

    box.append(heading, list);

    return box;
}

/** Die zehn Platzierungsspiele als Punkte - gespielte gefüllt. */
function placementDots(played: number): HTMLElement {
    const dots = document.createElement("span");

    dots.className = "rankcard__dots";
    dots.setAttribute("role", "img");
    dots.setAttribute("aria-label", `${played} von 10 Platzierungsspielen`);

    for (let index = 0; index < 10; index++) {
        const dot = document.createElement("i");

        if (index < played) dot.className = "is-on";

        dots.appendChild(dot);
    }

    return dots;
}

/**
 * Eine Rang-Karte: oben Playlist und Spiele, in der Mitte Abzeichen, Rang und
 * MMR, unten die Serie. Die Serie steht immer unten - so enden drei Karten
 * nebeneinander auf einer Linie, auch wenn eine noch in der Platzierung ist.
 */
export function rankCard(rank: IRank): HTMLElement {
    const card = document.createElement("article");
    card.className = "rankcard";
    card.style.setProperty("--tier", tierColor(rank.placement ? 0 : rank.tier));

    const top = document.createElement("header");
    top.className = "rankcard__top";

    const mode = document.createElement("span");
    mode.className = "rankcard__mode";
    mode.textContent = rank.label;

    top.append(mode);

    const games = document.createElement("span");
    games.className = "rankcard__games";
    games.textContent = rank.matches === 1 ? "1 Spiel" : `${numbers.format(rank.matches)} Spiele`;

    const badge = picture(rankIcon(rank.tier, rank.placement), "rankcard__badge");

    // Der Rang steht erst nach den Platzierungsspielen fest.
    const tier = document.createElement("b");
    tier.className = "rankcard__tier";
    tier.textContent = rank.placement ? "Platzierung" : rank.tierName;

    const detail = rank.placement
        ? placementDots(rank.placementMatches)
        : Object.assign(document.createElement("span"), {
              className: "rankcard__div",
              textContent: rank.divisionName ? `Division ${rank.divisionName}` : "",
          });

    const mmr = document.createElement("span");
    mmr.className = "rankcard__mmr";
    mmr.textContent = numbers.format(rank.mmr);

    const unit = document.createElement("i");
    unit.textContent = "MMR";
    mmr.appendChild(unit);

    // Die Mitte steht zwischen Kopf und Serie zentriert - wird die Karte hoeher,
    // waechst der Rand um den Rang, nicht eine Luecke darunter.
    const body = document.createElement("div");
    body.className = "rankcard__body";
    body.append(badge, tier, detail, mmr, games);

    const foot = document.createElement("div");
    foot.className = "rankcard__foot";

    const label = document.createElement("span");
    label.className = "rankcard__label";
    label.textContent = "Serie";

    // Die Serie: gruen bei Siegen, rot bei Niederlagen, mit Symbol und Text -
    // nicht nur ueber die Farbe. "in Folge" sagt das Label darueber.
    const streak = document.createElement("span");

    if (rank.streak !== 0) {
        const won = rank.streak > 0;
        const count = Math.abs(rank.streak);
        const text = `${count} ${won ? (count === 1 ? "Sieg" : "Siege") : count === 1 ? "Niederlage" : "Niederlagen"}`;

        streak.className = `streak ${won ? "streak--win" : "streak--loss"}`;
        streak.title = `${text} in Folge`;
        streak.append(icon(won ? "#i-boost" : "#i-warn"), text);
    } else {
        streak.className = "streak streak--none";
        streak.textContent = "keine";
    }

    foot.append(label, streak);
    card.append(top, body, foot);

    return card;
}

export function statTile(stat: { key: string; label: string; value: number }): HTMLElement {
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

    // Beschriftung links, Zahl rechtsbündig - eine Liste liest sich schneller als sechs Kacheln.
    const label = document.createElement("span");
    label.className = "stat__label";
    label.textContent = stat.label;

    const value = document.createElement("b");
    value.className = "stat__value";
    value.textContent = numbers.format(stat.value);

    box.append(label, value);

    return box;
}

/**
 * Zwei Quoten aus den Karriere-Werten: Tore pro Schuss und MVP pro Sieg. Beide
 * stehen nur, wenn der Nenner da ist - eine Quote aus null waere erfunden.
 */
export function rates(stats: { key: string; value: number }[]): HTMLElement[] {
    const value = (key: string): number => stats.find((stat) => stat.key === key)?.value ?? 0;
    const percent = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 });
    const cells: [string, number, number, string][] = [
        ["Trefferquote", value("goals"), value("shots"), "Tore pro Schuss"],
        ["MVP-Quote", value("mvps"), value("wins"), "MVP pro Sieg"],
    ];

    return cells
        .filter(([, , total]) => total > 0)
        .map(([name, part, total, hint]) => {
            const cell = document.createElement("div");
            const label = document.createElement("span");
            const number = document.createElement("b");

            cell.className = "rate";
            cell.title = `${numbers.format(part)} von ${numbers.format(total)} - ${hint}`;
            label.textContent = name;
            number.textContent = percent.format(part / total);
            cell.append(number, label);

            return cell;
        });
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
function nextRefresh(updatedAt: string | null, served: string | null): number | null {
    const at = updatedAt ? Date.parse(updatedAt) : Number.NaN;

    if (Number.isNaN(at)) return null;

    const sent = served ? Date.parse(served) : Number.NaN;
    const skew = Number.isNaN(sent) ? 0 : sent - Date.now();
    const expires = at + RANK_MAX_AGE - skew + REFRESH_SLACK;

    return expires > Date.now() ? expires : Date.now() + RANK_MAX_AGE;
}

export function bindFreshness(refresh: () => void): (due: number | null) => void {
    const box = maybe<HTMLElement>("#freshness");
    const value = maybe<HTMLElement>("#freshTimer");
    const label = maybe<HTMLElement>("#freshLabel");

    if (!box || !value || !label) return () => undefined;

    let due: number | null = null;

    function paint(): void {
        if (due === null) {
            box!.hidden = true;
            return;
        }

        box!.hidden = false;

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
            box!.classList.add("is-due");
            value!.textContent = "Jetzt";
            label!.textContent = "wird aktualisiert";
            return;
        }

        box!.classList.remove("is-due");
        box!.style.setProperty("--left", String(Math.min(1, left / RANK_MAX_AGE)));

        const seconds = Math.ceil(left / 1000);

        value!.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        label!.textContent = "bis zur Aktualisierung";
    }

    // Genau ein Intervall für die ganze Seite. Läge es im Setter, liefen nach
    // dem dritten Neuladen drei Zähler gegeneinander.
    window.setInterval(paint, 1000);

    return (next: number | null): void => {
        due = next;
        paint();
    };
}

export async function renderTracking(): Promise<void> {
    const panel = need<HTMLElement>("#trackPanel");
    const empty = need<HTMLElement>("#empty");

    // /user/<userId>/tracking - die ID steht vor dem letzten Abschnitt.
    const parts = window.location.pathname.split("/").filter(Boolean);
    const userId = parts[parts.length - 2] ?? "";

    const setDue = bindFreshness(() => void load());

    function fail(title: string, text: string): void {
        // Kein Zugriff, kein Konto: daran ändert auch ein neuer Versuch nichts.
        setDue(null);
        panel.hidden = true;
        empty.classList.add("is-on", "empty--error");

        need<SVGUseElement>("#emptyIcon use").setAttribute("href", "#i-warn");
        need<HTMLElement>("#emptyTitle").textContent = title;
        need<HTMLElement>("#emptyText").textContent = text;
    }

    // Ein Aussetzer beim Nachladen wischt den gezeigten Stand nicht weg: steht
    // schon etwas da, bleibt es stehen, bis der nächste Versuch klappt.
    function retry(title: string, text: string): void {
        if (panel.hidden) fail(title, text);

        setDue(Date.now() + RETRY_AFTER);
    }

    async function load(): Promise<void> {
        let response: Response;

        try {
            response = await fetch(`${BASE}/api/tracking/${encodeURIComponent(userId)}`, {
                headers: { Accept: "application/json" },
            });
        } catch {
            return retry("Der Bot antwortet gerade nicht", "Die Seite versucht es gleich noch einmal.");
        }

        if (response.status === 403) {
            return fail("Kein Zugriff", "Fremde Rang-Seiten sehen nur Administratoren und Developer.");
        }

        if (response.status === 404) {
            const body = (await response.json().catch(() => ({}))) as { own?: boolean };

            return fail(
                "Kein Epic-Konto verknüpft",
                body.own
                    ? "Verbinde es im Nutzermenü unter RL Tracker, dann stehen die Ränge hier."
                    : "Dieser Spieler hat sein Rocket-League-Konto noch nicht verbunden."
            );
        }

        // Überlastet oder gestört: gleich noch einmal. Alles andere bleibt ein Fehler.
        if (response.status === 429 || response.status >= 500) {
            return retry("Nicht ladbar", `Der Bot antwortete mit ${response.status}.`);
        }

        if (!response.ok) return fail("Nicht ladbar", `Der Bot antwortete mit ${response.status}.`);

        const data = (await response.json()) as ITrackingPayload;

        empty.classList.remove("is-on");
        panel.hidden = false;

        setDue(nextRefresh(data.updatedAt, response.headers.get("Date")));

        document.title = `RL Nexus · ${data.account?.name ?? "Tracking"}`;

        const avatar = need<HTMLElement>("#playerAvatar");

        if (data.user.avatar) avatar.replaceChildren(picture(data.user.avatar, ""));
        else avatar.replaceChildren();

        need<HTMLElement>("#playerName").textContent = data.account?.name ?? data.user.name ?? "Unbekannt";

        const meta = need<HTMLElement>("#playerMeta");
        const chips: HTMLElement[] = [];

        if (data.account) {
            const platform = document.createElement("span");
            platform.className = "pill";

            const image = platformIcon("Epic Games");
            if (image) platform.appendChild(image);

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

        const grid = need<HTMLElement>("#rankGrid");

        if (data.ranks.length > 0) {
            grid.replaceChildren(...data.ranks.map(rankCard));

            // Stand und Herkunft standen hier einmal als Zeile unter der Karte.
            // Beides sagt der Kopf der Seite schon: der Zaehler oben rechts,
            // wie lange dieser Stand gilt, und die Doku, woher er kommt.
            need<HTMLElement>("#trackFoot").textContent = "";
        } else {
            grid.replaceChildren();
            need<HTMLElement>("#trackFoot").textContent =
                data.failed ?? "Für 1v1, 2v2 und 3v3 liegt noch nichts vor.";
        }

        need<HTMLElement>("#statsBox").hidden = data.stats.length === 0;

        if (data.stats.length > 0) {
            need<HTMLElement>("#statGrid").replaceChildren(...data.stats.map(statTile));
            need<HTMLElement>("#statRates").replaceChildren(...rates(data.stats));
        }

        need<HTMLElement>("#seasonBox").hidden = data.season === null;

        if (data.season) {
            need<HTMLElement>("#reward").replaceChildren(paintReward(data.season.level, data.season.wins));
        }

        need<HTMLElement>("#clubBox").hidden = data.club === null;

        if (data.club) {
            need<HTMLElement>("#club").replaceChildren(paintClub(data.club, data.wtsi, data.account?.name ?? null));
        }
    }

    need<HTMLButtonElement>("#trackReload").addEventListener("click", () => void load());

    await load();
}
