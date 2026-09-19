/**
 * Das Auswahlfeld für einen Log-Kanal: Textkanäle, darunter je Forum seine
 * Beiträge und "+ Neuer Beitrag in #forum". Für Discord ist ein Beitrag ein
 * Thread mit eigener ID - gespeichert wird wie bei einem Kanal nur die ID.
 * Spiegelt ILogTargets aus src/utils/logtarget.ts.
 */

export interface ILogThread {
    id: string;
    name: string;
    parentId: string;
    parentName: string;
    archived: boolean;
}

export interface ILogTargets {
    channels: { id: string; name: string }[];
    forums: { id: string; name: string }[];
    threads: ILogThread[];
}

function group(label: string, options: HTMLOptionElement[]): HTMLOptGroupElement {
    const box = document.createElement("optgroup");

    box.label = label;
    box.append(...options);

    return box;
}

function threadOption(thread: ILogThread): HTMLOptionElement {
    return new Option(`↳ ${thread.name}${thread.archived ? " (archiviert)" : ""}`, thread.id);
}

/**
 * onCreate legt den Beitrag an und liefert ihn zurück - null, wenn es nicht
 * ging (dann steht wieder die vorige Wahl da). Der neue Beitrag landet auch in
 * targets.threads, damit ein neu gezeichnetes Feld ihn kennt.
 */
export function logTargetSelect(
    targets: ILogTargets,
    active: string | null,
    onPick: (value: string | null) => void,
    onCreate: (forumId: string) => Promise<ILogThread | null>,
    empty = "— kein Log-Kanal —"
): HTMLSelectElement {
    const picker = document.createElement("select");
    const known = new Set([...targets.channels.map((channel) => channel.id), ...targets.threads.map((thread) => thread.id)]);

    picker.className = "pick";
    picker.append(new Option(empty, ""));

    if (targets.channels.length) picker.append(group("Textkanäle", targets.channels.map((channel) => new Option(`# ${channel.name}`, channel.id))));

    for (const forum of targets.forums) {
        picker.append(
            group(`Forum #${forum.name}`, [
                ...targets.threads.filter((thread) => thread.parentId === forum.id).map(threadOption),
                new Option(`+ Neuer Beitrag in #${forum.name}`, `new:${forum.id}`),
            ])
        );
    }

    // Threads außerhalb der Foren - etwa per /ticket setup gewählt.
    const loose = targets.threads.filter((thread) => !targets.forums.some((forum) => forum.id === thread.parentId));

    if (loose.length) picker.append(group("Threads", loose.map(threadOption)));

    // Weg oder unsichtbar für den Bot: lieber so sagen als "kein Log-Kanal" vorgaukeln.
    if (active && !known.has(active)) picker.append(new Option(`Unbekannter Kanal (${active})`, active));

    picker.value = active ?? "";

    let last = picker.value;

    picker.addEventListener("change", async () => {
        const value = picker.value;

        if (!value.startsWith("new:")) {
            last = value;
            onPick(value || null);

            return;
        }

        picker.disabled = true;

        const thread = await onCreate(value.slice(4));

        picker.disabled = false;

        if (!thread) {
            picker.value = last;

            return;
        }

        targets.threads.push(thread);
        [...picker.options].find((option) => option.value === value)?.before(threadOption(thread));
        picker.value = thread.id;
        last = thread.id;
        onPick(thread.id);
    });

    return picker;
}
