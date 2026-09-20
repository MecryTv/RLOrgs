# Temp Voice

Ein Sprachkanal auf Zuruf: Wer den **Hub** betritt, bekommt seinen eigenen Kanal und wird hineingezogen. Ist der letzte draußen, verschwindet der Kanal wieder. Eingestellt wird er über ein Auswahlmenü, und wer will, speichert sich seine Einstellungen als **Preset** — beim nächsten Mal gelten sie von selbst.

Das Modul heißt `voice-hub` und wird unter *Module* eingeschaltet (oder `/module an modul:voice-hub`). Ohne Datenbank geht nichts: dort steht, wem welcher Kanal gehört.

---

## Hubs

Ein Hub ist ein ganz normaler Sprachkanal, etwa „Hier klicken". Im Dashboard unter *Temp Voice* auswählen, fertig. Bis zu zehn je Server — praktisch, wenn ihr getrennte Bereiche habt (2v2, 3v3, Chill).

Je Hub steht fest, wie die neuen Kanäle aussehen:

| Vorgabe | |
|---|---|
| **Name** | Vorlage mit `{user}`, `{nummer}` und `{spiel}` — aus `{user}s Kanal` wird „Laras Kanal". `{spiel}` nimmt, was Discord gerade als Spiel anzeigt, sonst „Voice" |
| **Kategorie** | Wo die neuen Kanäle landen. Ohne Angabe die Kategorie des Hubs |
| **Plätze** | 0 bis 99, 0 heißt unbegrenzt |
| **Zutritt** | offen oder privat (nur Vertraute kommen rein) |
| **Region** | Discord-Region oder automatisch |
| **Unsichtbar** | Der Kanal ist für andere nicht zu sehen |
| **Presets** | Ob Mitglieder eigene Einstellungen speichern dürfen |
| **Optionen** | Welche der 13 Panel-Optionen im Menü stehen |

Der Hub selbst bleibt immer leer: Wer ihn betritt, ist eine Sekunde später in seinem eigenen Kanal.

---

## Das Panel

Ein Auswahlmenü mit diesen Optionen — abgeschaltete stehen nicht drin:

| | Option | Was passiert |
|---|---|---|
| 📝 | Name | Kanal umbenennen (Eingabefeld) |
| 🔢 | User Limit | Plätze setzen, 0 heißt unbegrenzt |
| 🔒 | Privacy | Umschalten zwischen offen und privat |
| 👻 | Stealth Mode | Kanal unsichtbar machen und wieder zeigen |
| ✅ | Trust User | Darf rein, auch wenn der Kanal privat ist |
| ❌ | Untrust User | Nimmt das Vertrauen wieder weg |
| 🔗 | Invite User | Einladung per DM, gültig eine Stunde und einmal nutzbar |
| 🚪 | Kick User | Wirft jemanden aus dem Kanal |
| 🌐 | Region | Region wechseln |
| 🚫 | Block User | Kommt nicht mehr rein, sieht den Kanal nicht — und fliegt sofort raus |
| 🔓 | Unblock User | Hebt die Blockierung auf |
| 🔄 | Transfer Ownership | Übergibt den Kanal an jemanden, der drin sitzt |
| 🗑️ | Delete Channel | Löscht den Kanal sofort |

Alles davon darf nur, wem der Kanal gehört. Jede Antwort sieht nur der, der geklickt hat; das Panel selbst bleibt stehen.

**Wohin das Panel geht**, steht im Dashboard:

- **In den Chat des eigenen Kanals** (Standard): Jeder neue Kanal bekommt das Panel gleich in seinen Text-Chat.
- **In einen festen Kanal**: Das Panel steht einmal irgendwo und gilt für alle. Praktisch, wenn ihr die Kanal-Chats abgeschaltet habt. Gesendet wird es über den Knopf *Panel senden*.

Geht der Besitzer raus und jemand bleibt drin, übernimmt der Nächste den Kanal — der Bot sagt das im Chat.

---

## Presets

Jeder kann sich bis zu fünf Einstellungen merken: Name, Plätze, Zutritt, Unsichtbar, Region und die Listen (vertraut, blockiert). Der Knopf **Presets** im Panel öffnet die eigene Liste — speichern, anwenden, als Standard setzen, löschen.

Das **Standard-Preset** gilt beim nächsten eigenen Kanal automatisch, auf jedem Server, auf dem der Bot läuft. Das erste gespeicherte Preset wird gleich zum Standard; danach entscheidet der Besitzer selbst, welches es ist.

Die Presets gehören dem User, nicht dem Server — ein fremdes Preset lässt sich nicht anwenden.

---

## Dashboard

`/dashboard/guild/<id>/voice-hub` — oben die Zahlen (Hubs, offene Kanäle, wohin das Panel geht, Presets), darunter das Feld zum Hinzufügen, je Hub eine Karte mit allen Vorgaben und den 13 Optionen, die Panel-Einstellung und die Kanäle, die gerade offen sind (Besitzer, wie viele drin sind, seit wann).

| Route | |
|---|---|
| `GET <base>/api/guild/:id/voice` | Hubs, Einstellungen, Optionen, Regionen, offene Kanäle, Sprachkanäle und Kategorien |
| `POST <base>/api/guild/:id/voice` | `add`, `save`, `remove`, `settings`, `panel` — nur JSON |

Anfang wie überall: `ManageGate()` (`utils/managegate.ts`) — Sitzung, „Server verwalten", Datenbank, Modul an.

---

## Dahinter

| | |
|---|---|
| Tabellen | `voice_hubs` (Hub mit `config`), `temp_voices` (offener Kanal mit Besitzer und `settings`), `voice_presets` (je User, mit Standard-Markierung) — Migration 016 |
| Anlegen | `VoiceChannels` hört auf `VoiceStateUpdate`. Zwei Beitritte in derselben Sekunde ergeben trotzdem nur einen Kanal |
| Aufräumen | Der letzte raus, Kanal weg. Beim Start räumt `Sweep()` auf, was einen Neustart nicht überlebt hat |
| Rechte | Privat setzt `Connect` für `@everyone` auf nein, unsichtbar zusätzlich `ViewChannel`; Vertraute und der Besitzer bekommen eigene Einträge |
| Panel | `VoicePanelHandler` – Auswahlmenü, User-Auswahl, Modals und die Presets, alles mit `voice:`-IDs |

Der Bot braucht **Kanäle verwalten** (anlegen, umbenennen, löschen, Rechte setzen) und **Mitglieder verschieben**, um jemanden in seinen Kanal zu ziehen.

---

## Prüfen

```bash
npm run check:voice   # Vorgaben, Namensvorlage, Panel, Presets, Datenbank und alle 13 Aktionen
```

Die Sprachkanäle sind dabei erfunden — der Testkanal merkt sich nur, was der Bot an ihm ändern wollte. Ob Discord mitspielt, zeigt erst ein echter Server.
