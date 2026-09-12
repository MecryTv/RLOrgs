/** Seite: Einstellungen. */

import { IUser } from "../interfaces/IUser.js";
import { icon, need, maybe } from "../core/Dom.js";
import { GROUPS } from "../constants/Groups.js";
import { avatarOf } from "../layout/Profile.js";
import { applyMotion, prefs, savePrefs } from "../core/Prefs.js";
import { clickSound } from "../core/Sound.js";
import { toast } from "../core/Toast.js";
import { bindAccountFallback, paintAccounts } from "../services/Accounts.js";
import { BASE } from "../core/Base.js";

export function paintProfileCard(user: IUser): void {
    const group = GROUPS[user.group] ?? GROUPS.testphase;
    const handle = user.handle ? `@${user.handle}` : "Discord-Konto";

    need<HTMLElement>("#idAvatar").replaceChildren(avatarOf(user));
    need<HTMLElement>("#idName").textContent = user.name;
    need<HTMLElement>("#idHandle").textContent = handle;
    need<HTMLElement>("#idGroup").replaceChildren(icon(group.icon), group.label);
    need<HTMLElement>("#idUser").textContent = user.id;

    need<HTMLElement>("#idGroupText").textContent = group.grants;

    const mail = need<HTMLElement>("#idMail");

    if (user.email) {
        mail.textContent = user.email;
    } else {
        // Sitzungen von vor dem "email"-Scope tragen keine Adresse. Statt einer
        // leeren Zeile steht hier, wie sie erscheint.
        mail.textContent = "Nach dem nächsten Anmelden sichtbar";
        mail.classList.add("is-empty");
    }

    need<HTMLButtonElement>("#copyId").addEventListener("click", (event) => {
        const copy = event.currentTarget as HTMLButtonElement;
        const symbol = copy.querySelector("use")!;

        function done(): void {
            symbol.setAttribute("href", "#i-check");
            copy.classList.add("is-done");

            window.setTimeout(() => {
                symbol.setAttribute("href", "#i-copy");
                copy.classList.remove("is-done");
            }, 1400);
        }

        // Die Zwischenablage kann fehlen (kein sicherer Kontext) oder der Browser
        // verweigert sie. Dann wird die ID wenigstens markiert, damit Strg+C
        // weiterhilft - eine Fehlermeldung allein wäre eine Sackgasse.
        function select(): void {
            const range = document.createRange();
            range.selectNodeContents(need<HTMLElement>("#idUser"));

            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);

            toast("info", "Kopieren nicht möglich", "Die ID ist markiert - mit Strg+C kopieren.");
        }

        const writing = navigator.clipboard?.writeText(user.id);

        if (!writing) {
            select();
            return;
        }

        void writing.then(done).catch(select);
    });
}

export function bindSettings(): void {
    const sound = need<HTMLInputElement>("#setSound");
    const volume = need<HTMLInputElement>("#setVolume");
    const label = need<HTMLElement>("#volumeLabel");
    const motion = need<HTMLInputElement>("#setMotion");
    const toasts = need<HTMLInputElement>("#setToasts");

    function paint(): void {
        sound.checked = prefs.sound;
        // Der Schalter heißt "Bewegung reduzieren" - er steht also umgekehrt zu prefs.motion.
        motion.checked = !prefs.motion;
        toasts.checked = prefs.toasts;

        volume.value = String(prefs.volume);
        volume.disabled = !prefs.sound;
        volume.style.setProperty("--fill", `${prefs.volume}%`);
        label.textContent = prefs.sound ? `${prefs.volume} %` : "Töne sind aus";
    }

    paint();

    sound.addEventListener("change", () => {
        prefs.sound = sound.checked;
        savePrefs();
        paint();

        // Der Klick ist die Geste, die der Browser für Audio verlangt - der erste
        // Ton kommt deshalb verlässlich erst hier.
        if (prefs.sound) clickSound("primary");
    });

    volume.addEventListener("input", () => {
        prefs.volume = Number(volume.value);
        paint();
    });

    volume.addEventListener("change", () => {
        savePrefs();
        clickSound("primary");
    });

    motion.addEventListener("change", () => {
        prefs.motion = !motion.checked;
        savePrefs();
        applyMotion();
    });

    toasts.addEventListener("change", () => {
        prefs.toasts = toasts.checked;
        savePrefs();

        if (prefs.toasts) toast("info", "Hinweise sind an", "Meldungen erscheinen wieder unten rechts.");
    });
}

/* ----------------------------------------------------------
   Seite: Einstellungen

   Frueher ein Dialog, jetzt eine Seite mit Reitern. Die Bausteine sind
   dieselben geblieben - bindSettings() fuer die Schalter, paintAccounts() fuer
   die Verknuepfung, paintProfileCard() fuer die Kennkarte.

   Welche ID die Adresse traegt, spielt keine Rolle: die Route laesst nur die
   eigene durch und biegt jede fremde vorher um.
   ---------------------------------------------------------- */

/**
 * Die Reiter. Genau eine Karte ist sichtbar, der Rest steht auf hidden - der
 * Sinn der Uebung: nichts mehr suchen muessen, was unterhalb des Bildschirms
 * liegt. Die Auswahl haengt am Hash, damit ein Link direkt dort landet und F5
 * nicht auf den ersten Reiter zurueckwirft.
 */
export function bindTabs(): void {
    const nav = maybe<HTMLElement>("#setNav");

    if (!nav) return;

    const links = [...nav.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((link) =>
        (link.getAttribute("href") ?? "").startsWith("#")
    );

    const cards = links
        .map((link) => maybe<HTMLElement>(link.getAttribute("href") as string))
        .filter((card): card is HTMLElement => card !== null);

    if (cards.length === 0) return;

    const first = (links[0]?.getAttribute("href") ?? "#").slice(1);

    // Die Marke in den sichtbaren Teil der Leiste holen - steht der Reiter weit
    // unten, stuende sie nach F5 sonst ausser Sicht. Es scrollt nur die Leiste,
    // nie die Seite, und erst mit den Schriften: vorher stimmen die Hoehen der
    // Eintraege noch nicht.
    const reveal = (link: HTMLElement): void => {
        void document.fonts.ready.then(() => {
            const item = link.getBoundingClientRect();
            const box = nav.getBoundingClientRect();
            // Ganz oben ragt die Leiste noch unter den Fensterrand.
            const bottom = Math.min(box.bottom, window.innerHeight);

            if (item.bottom > bottom) nav.scrollTop += item.bottom - bottom;
            else if (item.top < box.top) nav.scrollTop -= box.top - item.top;

            if (item.right > box.right) nav.scrollLeft += item.right - box.right;
            else if (item.left < box.left) nav.scrollLeft -= box.left - item.left;
        });
    };

    function show(id: string): void {
        // Unbekannter Hash - etwa ein alter Link auf den Gruppen-Abschnitt, den
        // es hier nicht mehr gibt: dann der erste Reiter statt einer leeren Seite.
        // Ein ausgeblendeter Reiter zaehlt dabei als unbekannt.
        const wanted = links.some((link) => !link.hidden && link.getAttribute("href") === `#${id}`) ? id : first;

        for (const card of cards) card.hidden = card.id !== wanted;

        for (const link of links) {
            const active = link.getAttribute("href") === `#${wanted}`;

            if (active) {
                link.setAttribute("aria-current", "page");
                reveal(link);
            } else {
                link.removeAttribute("aria-current");
            }
        }
    }

    for (const link of links) {
        link.addEventListener("click", (event) => {
            // Kein Sprung: die Karte steht ohnehin schon oben. Ein Sprung wuerde
            // die Seite nur ruckeln lassen.
            event.preventDefault();

            const id = (link.getAttribute("href") ?? "#").slice(1);

            history.replaceState(null, "", `#${id}`);
            show(id);
            clickSound("primary");
        });
    }

    // Zurueck- und Vorwaertstaste sollen den Reiter mitnehmen.
    window.addEventListener("hashchange", () => show(location.hash.slice(1)));

    show(location.hash.slice(1));
}

export async function renderSettings(user: IUser): Promise<void> {
    const panel = need<HTMLElement>("#setPanel");
    const group = GROUPS[user.group] ?? GROUPS.testphase;

    need<HTMLElement>("#setAvatar").replaceChildren(avatarOf(user));

    const who = document.createElement("span");
    who.className = "pill";
    who.append(icon("#i-users"), user.name);

    const badge = document.createElement("span");
    badge.className = "pill pill--role";
    badge.append(icon(group.icon), group.label);

    need<HTMLElement>("#setMeta").replaceChildren(who, badge);
    need<HTMLAnchorElement>("#setTracker").href = `${BASE}/user/${user.id}/tracking`;
    need<HTMLElement>("#acctDiscord").textContent = user.handle ? `@${user.handle}` : user.name;

    paintProfileCard(user);
    bindTabs();
    bindSettings();
    bindAccountFallback();

    need<HTMLElement>("#empty").classList.remove("is-on");
    panel.hidden = false;

    // Zum Schluss, weil es auf den Bot wartet: Kennkarte und Schalter stehen
    // schon, waehrend die Verknuepfung noch geholt wird.
    await paintAccounts();
}
