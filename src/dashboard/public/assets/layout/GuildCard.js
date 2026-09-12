import { compact, numbers } from "../core/Format.js";
export function paintCrest(crest, guild) {
    crest.style.setProperty("--c1", guild.c1);
    crest.style.setProperty("--c2", guild.c2);
    crest.textContent = guild.tag;
    crest.classList.remove("has-image");
    if (!guild.icon)
        return;
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    // Erst wenn das Icon wirklich da ist, weicht der Farbverlauf einer neutralen
    // Platte. Ein Logo mit Transparenz saß sonst auf Cyan-Orange und wirkte
    // verfärbt - und bei einem kaputten Bild stünde die Platte leer da.
    image.addEventListener("load", () => crest.classList.add("has-image"));
    // Fällt das Icon aus, bleiben die Initialen darunter stehen.
    image.addEventListener("error", () => {
        image.remove();
        crest.classList.remove("has-image");
    });
    image.src = guild.icon;
    crest.appendChild(image);
}
export function countMembers(root, guild) {
    const members = root.querySelector("[data-members]");
    const bots = root.querySelector("[data-bots]");
    if (guild.bots === null) {
        members.textContent = `${compact(guild.members)} Mitglieder`;
        members.title = `${numbers.format(guild.members)} Mitglieder, Bots inbegriffen`;
        return;
    }
    const humans = Math.max(guild.members - guild.bots, 0);
    members.textContent = `${compact(humans)} Mitglieder`;
    members.title = `${numbers.format(humans)} Mitglieder und ${numbers.format(guild.bots)} Bots`;
    if (!bots)
        return;
    // Nur das Symbol und die Zahl: mit ausgeschriebenem "Bots" passt die Zeile
    // auf einer Karte nicht mehr neben Rolle und Mitgliederzahl. Der volle Text
    // steckt im Titel und im aria-label.
    const spoken = guild.bots === 1 ? "1 Bot" : `${numbers.format(guild.bots)} Bots`;
    bots.hidden = false;
    bots.querySelector("[data-botcount]").textContent = compact(guild.bots);
    bots.title = `${spoken} auf diesem Server`;
    bots.setAttribute("aria-label", `${spoken} auf diesem Server`);
}
