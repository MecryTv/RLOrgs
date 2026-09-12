/** Das Menue hinter dem Namen oben rechts, samt Postfach-Dialog. */
import { icon, need, maybe } from "../core/Dom.js";
import { GROUPS, STAFF_GROUPS } from "../constants/Groups.js";
import { avatarOf } from "./Profile.js";
import { clearNotes, paintBadge, paintNotes, markRead } from "../services/Notes.js";
import { reportEpicReturn } from "../services/Accounts.js";
import { clickSound } from "../core/Sound.js";
import { BASE } from "../core/Base.js";
/* ----------------------------------------------------------
   Nutzermenü, Einstellungen und Postfach
   Das Gerüst ist eine feste Zeichenkette ohne eine einzige eingesetzte
   Variable - alles Nutzerbezogene kommt darunter über textContent.
   ---------------------------------------------------------- */
export const MENU_HTML = `
<span class="profile__dot" id="profileDot" hidden></span>
<div class="menu" id="userMenu" role="menu" hidden>
  <div class="menu__head">
    <span class="avatar avatar--sm" id="menuAvatar" aria-hidden="true"></span>
    <span class="menu__id"><b id="menuName"></b><span id="menuGroup"></span></span>
  </div>
  <a class="menu__item" href="${BASE}/admins" id="adminLink" role="menuitem" hidden>
    <svg><use href="#i-shield"/></svg><span>Administration</span>
  </a>
  <a class="menu__item" id="openTracker" role="menuitem">
    <svg><use href="#i-stats"/></svg><span>RL Tracker</span>
  </a>
  <button class="menu__item" type="button" id="openNotes" role="menuitem">
    <svg><use href="#i-bell"/></svg><span>Benachrichtigungen</span>
    <span class="menu__badge" id="noteBadge" hidden>0</span>
  </button>
  <a class="menu__item" id="openSettings" role="menuitem">
    <svg><use href="#i-settings"/></svg><span>Einstellungen</span>
  </a>
  <div class="menu__line"></div>
  <a class="menu__item menu__item--warn" href="${BASE}/logout" role="menuitem">
    <svg><use href="#i-logout"/></svg><span>Abmelden</span>
  </a>
</div>`;
export const NOTES_HTML = `
<dialog class="modal" id="notesModal" aria-labelledby="notesTitle">
  <div class="modal__head">
    <div>
      <h2 id="notesTitle">Benachrichtigungen</h2>
      <p>Alles, was dich betrifft. Auf jedem Gerät dasselbe.</p>
    </div>
    <button class="iconbtn modal__x" type="button" data-close aria-label="Schließen"><svg><use href="#i-x"/></svg></button>
  </div>
  <div class="modal__body">
    <div class="notes" id="noteList"></div>
    <button class="linkrow" type="button" id="clearNotes"><svg><use href="#i-x"/></svg>Alle löschen</button>
  </div>
</dialog>`;
export function buildUserUI(user) {
    const box = maybe("#userbox");
    const button = maybe("#profile");
    if (!box || !button)
        return;
    box.insertAdjacentHTML("beforeend", MENU_HTML);
    document.body.insertAdjacentHTML("beforeend", NOTES_HTML);
    const menu = need("#userMenu");
    const group = GROUPS[user.group] ?? GROUPS.testphase;
    need("#menuAvatar").replaceChildren(avatarOf(user));
    need("#menuName").textContent = user.name;
    need("#menuGroup").replaceChildren(icon(group.icon), group.label);
    // Der Weg in die Administration steht nur denen offen, die dort auch
    // hineinkommen - die Route prüft es serverseitig noch einmal.
    const adminLink = maybe("#adminLink");
    if (adminLink && STAFF_GROUPS.includes(user.group))
        adminLink.hidden = false;
    function openMenu(open) {
        menu.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
    }
    button.addEventListener("click", () => {
        // aria-expanded ist die Wahrheit, nicht das hidden-Attribut: das kennt
        // inzwischen auch den Wert "until-found" und ist damit kein Boolean mehr.
        openMenu(button.getAttribute("aria-expanded") !== "true");
        clickSound("primary");
    });
    // Klick daneben oder Escape schließt - der Kasten umfasst Knopf und Menü.
    document.addEventListener("click", (event) => {
        if (!box.contains(event.target))
            openMenu(false);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape")
            openMenu(false);
    });
    const postbox = need("#notesModal");
    for (const close of document.querySelectorAll(".modal [data-close]")) {
        close.addEventListener("click", () => close.closest("dialog")?.close());
    }
    need("#openNotes").addEventListener("click", () => {
        openMenu(false);
        paintNotes();
        postbox.showModal();
        // Erst zeichnen, dann als gelesen melden: so bleibt die Markierung in
        // genau dieser Ansicht noch stehen.
        markRead();
    });
    need("#clearNotes").addEventListener("click", () => clearNotes());
    // Der RL Tracker hatte einmal einen eigenen Dialog. Der fragte nach dem
    // Epic-Konto und spaeter nach der Hauptplattform - beides gibt es nicht
    // mehr, und Raenge stehen auf der Seite selbst besser. Also direkt dorthin.
    // Dasselbe gilt seit der eigenen Seite fuer die Einstellungen.
    need("#openTracker").href = `${BASE}/user/${user.id}/tracking`;
    need("#openSettings").href = `${BASE}/user/${user.id}/settings`;
    paintNotes();
    paintBadge();
    // Der Ruecksprung von Epic bringt sein Ergebnis in der Adresszeile mit.
    reportEpicReturn();
}
