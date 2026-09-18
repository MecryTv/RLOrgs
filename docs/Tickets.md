# Tickets

Support-Anfragen als eigener Kanal, als Forum-Post oder ganz per DM (ModMail). Eingerichtet wird im Dashboard (`/guild/<id>/tickets`) oder in Discord mit `/ticket setup` — beide schreiben über denselben `TicketService` in dieselbe Zeile.

Transcripts und Live Chat gehören nicht hierher; sie bekommen ein eigenes Spec. Der Plan dahinter steht in `docs/superpowers/specs/2026-09-12-tickets-und-bilder-design.md`.

---

## Zwei Schalter statt drei Modi

| | **Kanal** (Textkanal je Ticket) | **Forum-Post** (ein Forum, je Ticket ein Post) |
|---|---|---|
| **Klassisch** — der User sitzt im Ticket | Kanal in der Kategorie der Option, nur Ersteller + Support-Rolle sehen ihn | Post im Forum, Option und Priorität als Tags. **Jeder, der das Forum sieht, sieht alle Tickets.** |
| **ModMail** — der User schreibt dem Bot per DM | Kanal nur fürs Team, der Bot leitet hin und her | Post in einem Team-Forum, mit Tags |

Welche Kombination gilt, steht am Ticket selbst (`tickets.contact`): ein Umstellen der Einstellungen deutet laufende Tickets nicht um.

---

## Die Bausteine

| Datei | Aufgabe |
|---|---|
| `src/services/TicketService.ts` | Öffnen, jede Aktion genau einmal, ModMail-Relay, Termine und Löschfristen |
| `src/builder/TicketPanel.ts` | Panel, Eröffnung mit Statuszeile und Aktions-Menü, DMs, Zusammenfassung, Medien-Tresor |
| `src/builder/MessageDoc.ts` | Nachrichten-Dokument → ComponentV2Builder; prüft Dokumente aus dem Dashboard |
| `src/builder/TicketSetupPanel.ts` | Der Assistent von `/ticket setup` |
| `src/events/tickets/TicketHandler.ts` | Panel-Klicks, Aktions-Menü, Nachfragen, DM-Knöpfe |
| `src/events/tickets/TicketSetupHandler.ts` | Klicks im Assistenten |
| `src/events/tickets/TicketMessages.ts` | DMs an den Bot, Relay, anonymer Modus, Nachrichtenzahl |
| `src/runnables/TicketReminders.ts` | Minütlich: Termine melden, abgelaufene Kanäle löschen |
| `src/commands/admin/Module.ts` · `Ticket.ts` | `/module an · aus · liste` und `/ticket setup · panel · entsperren` |
| `src/routes/DashboardApiTickets.ts` | GET liest alles für die Seite, POST speichert, sendet das Panel, entsperrt |
| `src/dashboard/client/pages/GuildTickets.ts` | Die Seite im Dashboard |
| `src/dashboard/client/layout/MessageEditor.ts` | Baustein-Editor mit Live-Vorschau |
| `src/dashboard/client/layout/ImagePicker.ts` | Bildauswahl: Galerie, Hochladen, Adresse |
| `src/config/ticketactions.json` | Name, Beschreibung und Emoji der 15 Aktionen |
| `src/database/migrations/011_tickets.sql` | `ticket_settings`, `tickets`, `ticket_blacklist` |

---

## Einrichten

**Dashboard:** Modul „Ticket System“ einschalten, dann unter *Ticket System*: Grundlagen, Öffnungs-Optionen, Aktionen, die sechs Nachrichten, Panel senden, gesperrte User. Gespeichert wird mit der Leiste unten; das Panel geht erst raus, wenn nichts mehr ungespeichert ist.

**Discord** (alles mit „Server verwalten“):

```
/module an modul:tickets      Modul einschalten (Autocomplete über alle Module)
/module aus modul:<id>        ausschalten - die Galerie lehnt ab, sie gehört fest dazu
/module liste                 alle Module mit ihrem Stand
/ticket setup                 der Assistent: Grundlagen, Optionen, Aktionen, Nachrichten, Panel
/ticket panel [kanal]         Panel senden oder am selben Ort nachziehen
/ticket entsperren user:<u>   Ticket-Sperre aufheben
```

Der Assistent schreibt jede Änderung sofort. Nachrichten bearbeitet er in der Kurzfassung — Text, Farbe, ein Bild; Bausteine aus dem Dashboard bleiben dabei stehen.

---

## Öffnen

Vor jedem Ticket dieselbe Prüfung, in dieser Reihenfolge:

1. Modul `tickets` an?
2. User gesperrt? → die Nachricht `blacklisted`
3. Zu dieser Option schon ein offenes Ticket? → Verweis darauf
4. Grenze offener Tickets je User erreicht? (`limit`, 0 = ohne)
5. Bei ModMail: schon ein offenes ModMail-Ticket — auch auf einem anderen Server? Die DM ist ein einziger Kanal, deshalb höchstens eins.

Die Nummer ist fortlaufend je Server (`#0042`); `Tickets.Create()` vergibt sie in einer Transaktion. Scheitert danach etwas (Rechte, DM zu), verschwindet die Zeile samt halb angelegtem Kanal wieder.

**ModMail per DM:** Schreibt ein User dem Bot ohne offenes Ticket, sucht der Bot die Server mit ModMail, auf denen der User Mitglied ist. Einer mit einer Option → sofort öffnen. Sonst fragt er per Auswahlmenü nach Server und Thema. Die erste DM geht danach ins Ticket, der User muss nichts wiederholen.

---

## Die 15 Aktionen

Alle in **einem** Menü unter der Eröffnung. Fest dabei: `close`, `claim`/`unclaim`, `add_user`/`remove_user`. Der Rest wird zugeschaltet. Schließen darf auch der Ersteller, alles andere nur das Team (Support-Rolle der Option bzw. die allgemeine, oder „Server verwalten“).

| Aktion | Kanal | Forum-Post | Bei ModMail zusätzlich |
|---|---|---|---|
| `close` | Grund per Modal, Rechte von Ersteller und Mitgliedern weg, `closed-` vor den Namen | Tag *Geschlossen*, gesperrt, archiviert | Abschluss-DM |
| `claim` / `unclaim` | Bearbeiter in der Statuszeile | dazu Tag *Beansprucht* | — |
| `add_user` / `remove_user` | Rechte-Overwrite | Thread-Mitglied | wirkt auf die Team-Seite |
| `transfer` | Kanal in die Kategorie der Ziel-Option, Rolle getauscht | Options-Tag getauscht | — |
| `priority` | 🟢🟡🔴 vor dem Kanalnamen | Tag je Stufe | — |
| `anonymous_mode` | Nachrichten des Teammitglieds kommen per Webhook unter „<Server> Team“ | dito, Webhook am Forum | das Relay zeigt den Alias |
| `media_vault` | die letzten 500 Nachrichten: Bilder als Galerie, der Rest als Liste | dito | beide Seiten, weil das Relay Anhänge mitnimmt |
| `slowmode` | `setRateLimitPerUser` | dito | der Bot bremst das Weiterleiten |
| `tldr_summary` | Faktenkarte aus der Datenbank, kein Sprachmodell | dito | — |
| `staff_note` | Modal → `tickets.notes`, nur über die Zusammenfassung sichtbar | dito | geht nie ins Relay |
| `freeze` | Ersteller darf nicht schreiben, Nachricht `frozen` | Post gesperrt | Relay stoppt, `frozen` per DM |
| `blacklist` | Sperre + Ticket schließen | dito | Absage-DM `blacklisted` |
| `schedule_meeting` | Datum/Uhrzeit (deutsche Zeit) per Modal, Erinnerung pingt Ersteller und Bearbeiter | dito | Termin und Erinnerung auch per DM |

Die Beschriftungen kommen aus `src/config/ticketactions.json`; `npm run check:tickets` hält die Datei und `ACTIONS` in `constants/Tickets.ts` deckungsgleich.

---

## Nachrichten

Sechs Stück, jede ein Dokument aus Bausteinen (`src/interfaces/builder/IMessageDoc.ts`):

| Schlüssel | Wo sie landet |
|---|---|
| `panel` | im Server-Kanal, mit Buttons oder Auswahlmenü darunter |
| `opened` | Eröffnung im Ticket; jede Option darf eine eigene haben |
| `dm` | Bestätigung an den User bei ModMail, mit Knopf zum Schließen |
| `closed` | beim Schließen — mit `{closer}` und `{reason}` |
| `frozen` | beim Einfrieren |
| `blacklisted` | Absage an Gesperrte |

**Bausteine:** Text · Bilder (bis 10) · Trenner · Abschnitt mit Bild rechts. Sie kosten 1 · 1 · 1 · 3 vom 40er-Budget einer Discord-Nachricht; was mit Knöpfen und Menü nicht mehr passt, lässt `RenderDoc()` weg, statt die Nachricht scheitern zu lassen.

**Bilder:** eine Galerie-ID (eigene Alben oder Vorlagen), eine https-Adresse oder `{user.avatar}` / `{guild.icon}`. Hochgeladene Bilder landen im Album `custom` des Servers — dieselbe Galerie, kein zweiter Speicher.

**Platzhalter** (`src/constants/Placeholders.ts`, gespiegelt im Dashboard; `check:dashboard` vergleicht):

```
{user} {user.name} {user.id} {user.avatar}
{guild} {guild.id} {guild.icon} {guild.members}
{ticket.id} {ticket.option} {ticket.priority} {ticket.opened} {ticket.claimer}
{support.role} {closer} {reason}
```

Unbekannte bleiben stehen, damit ein Tippfehler auffällt. In DMs stehen Namen statt Erwähnungen — Discord zeigt eine Rollen-Erwähnung dort als „@unbekannte-rolle“.

---

## Was der Bot braucht

- **Rechte:** Kanäle verwalten, Rollen verwalten (für Overwrites), Nachrichten verwalten, Webhooks verwalten (anonymer Modus), im Forum Threads verwalten.
- **Intents:** `DirectMessages` plus `Partials.Channel` — sonst sieht er keine DM (`BotClient.ts`).
- Ein Overwrite erlaubt nie mehr, als der Bot selbst hat (`Allowed()`), sonst lehnt Discord den ganzen Kanal ab.

---

## Fallen

- **Forum + Klassisch ist öffentlich.** Forum-Posts sieht jeder, der das Forum sieht. Das Dashboard sagt es bei dieser Kombination dazu.
- **Umbenennen ist gebremst.** Discord erlaubt zwei Namensänderungen je Kanal in zehn Minuten. Der Bot benennt deshalb nur bei Priorität, Verschieben und Schließen um, und ohne zu warten — eine dritte kommt verspätet an.
- **Ein gesperrter Post (eingefroren, geschlossen) nimmt nur noch Nachrichten von Leuten mit „Threads verwalten“.** Wer im Forum mitschreiben soll, braucht das Recht dort.
- **Anhänge über 10 MB gehen als Link weiter**, nicht als Datei — mehr darf ein Bot ohne Boost nicht hochladen.

---

## Prüfen

```bash
npm run check:tickets     # Aktionsliste, Platzhalter, Einstellungen, Menü, Datenbank
npm run check:dashboard   # Platzhalter-Spiegel, Rechte und CSRF der Ticket-Route
```

Was nur mit echter Discord-Verbindung geht — Kanäle anlegen, Tags, Relay, Webhooks — prüft erst ein Lauf auf einem Testserver.
