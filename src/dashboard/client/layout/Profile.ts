/** Bild, Name und Gruppe des angemeldeten Nutzers in der Kopfzeile. */

import { IUser } from "../interfaces/IUser.js";
import { icon, maybe } from "../core/Dom.js";
import { GROUPS } from "../constants/Groups.js";

export const FALLBACK_AVATAR =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
            '<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#00d2ff"/><stop offset="1" stop-color="#7b5cff"/>' +
            "</linearGradient></defs>" +
            '<rect width="64" height="64" fill="url(#a)"/>' +
            '<circle cx="32" cy="26" r="11" fill="rgba(4,20,28,.5)"/>' +
            '<path d="M11 61c2.5-12 10.5-18 21-18s18.5 6 21 18z" fill="rgba(4,20,28,.5)"/>' +
            "</svg>"
    );

/* ----------------------------------------------------------
   Profil und Kopfzeile
   ---------------------------------------------------------- */
export function avatarOf(user: IUser): HTMLImageElement {
    const image = document.createElement("img");

    image.alt = "";
    image.decoding = "async";
    image.addEventListener("error", () => {
        if (image.src !== FALLBACK_AVATAR) image.src = FALLBACK_AVATAR;
    });
    image.src = user.avatar ?? FALLBACK_AVATAR;

    return image;
}

export function renderProfile(user: IUser): void {
    const box = maybe<HTMLElement>("#avatar");
    const name = maybe<HTMLElement>("#profileName");
    const group = GROUPS[user.group] ?? GROUPS.testphase;

    if (box) box.replaceChildren(avatarOf(user));

    if (name) name.textContent = user.name;

    // Symbol und Name der Gruppe gehören zusammen in eine Zeile - beides trägt
    // die Farbe der Gruppe, damit sie auf einen Blick zu erkennen ist.
    const label = maybe<HTMLElement>("#profileGroup");

    if (label) {
        const badge = icon(group.icon);
        badge.setAttribute("class", "profile__group-icon");

        label.replaceChildren(badge, group.label);
    }

    // Die Gruppenfarbe hängt an der Wurzel: die Dialoge liegen direkt unter
    // <body> und würden sie von der Kopfzeile aus nicht erben.
    document.documentElement.style.setProperty("--group", group.color);

    const profile = maybe<HTMLElement>("#profile");
    if (profile) profile.setAttribute("aria-label", `Angemeldet als ${user.name}, ${group.label}`);
}
