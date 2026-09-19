# Tickets

Support-Anfragen als eigener Kanal, als Forum-Post oder ganz per DM (ModMail). Eingerichtet wird im Dashboard (`/guild/<id>/tickets`) oder in Discord mit `/ticket setup` — beide schreiben über denselben `TicketService` in dieselbe Zeile.

Beim Schließen entsteht ein **Transcript** — der ganze Verlauf im Discord-Look, auch mit Components V2 (Abschnitt „Transcripts“ unten). Live Chat gehört nicht hierher, er bekommt ein eigenes Spec. Der Plan dahinter steht in `docs/superpowers/specs/2026-09-12-tickets-und-bilder-design.md`.

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
| `src/services/TranscriptService.ts` | Transcript beim Schließen: Verlauf lesen, Anhänge sichern, speichern, zustellen; wer es sehen darf |
| `src/builder/TranscriptHtml.ts` | Ein Transcript als HTML-Seite: Markdown, Embeds, Anhänge, Components V2 |
| `src/routes/DashboardApiTickets.ts` | GET liest alles für die Seite, POST speichert, sendet oder entfernt das Panel, entsperrt |
| `src/routes/DashboardTranscript.ts` | `/transcript/<ticket>`: die Seite, `?download=1` die Datei, `/transcript/<ticket>/<anhang>` ein Anhang |
| `src/routes/DashboardApiTranscripts.ts` | Liste mit Suche für „Transcriptions“, Löschen |
| `src/dashboard/client/pages/GuildTickets.ts` | Die Seite im Dashboard: Status-Kopf, Tabs, Live-Vorschau |
| `src/dashboard/client/pages/GuildTranscripts.ts` | Die Seite „Transcriptions“ |
| `src/dashboard/client/layout/MessageEditor.ts` | Baustein-Editor mit Live-Vorschau |
| `src/dashboard/client/layout/EmojiPicker.ts` | Emoji-Auswahl: Server-Emojis als Bild, Standard-Emojis, Suche |
| `src/dashboard/client/layout/ImagePicker.ts` | Bildauswahl: Galerie, Hochladen, Adresse |
| `src/config/ticketactions.json` | Name, Beschreibung und Emoji der 15 Aktionen |
| `src/database/migrations/011_tickets.sql` | `ticket_settings`, `tickets`, `ticket_blacklist` |
| `src/database/migrations/012_ticket_transcripts.sql` | `ticket_transcripts`; an `tickets` wer geschlossen hat und warum |

---

## Einrichten

**Dashboard:** Modul „Ticket System“ einschalten, dann unter *Ticket System*. Oben vier Kacheln mit dem Stand (Modus, Panel, Themen, Transcripts) — jede springt in ihren Tab. Darunter die Tabs **Einrichtung · Themen · Aktionen · Nachrichten · Panel · Sperrliste**, daneben die **Live-Vorschau** dessen, was man gerade ändert (unter 1180 px darunter). Der Tab steht in der Adresse (`#themen`), Pfeiltasten wechseln ihn. Gespeichert wird mit der Leiste unten; das Panel geht erst raus, wenn nichts mehr ungespeichert ist.

**Emojis der Themen** wählt man im Emoji-Picker: die Server-Emojis als Bild (wie in Discord), gängige Standard-Emojis, eine Suche und ein Feld für jedes andere Emoji. Gespeichert wird, was der Bot erwartet: `🎫` oder `<:name:id>`.

**Ein Panel je Server.** „Panel senden“ im Dashboard wie `/ticket panel` legt nie ein zweites daneben:

- Steht es schon im gewählten Kanal, **bearbeitet** der Bot die Nachricht („Panel aktualisieren“).
- Er sucht dazu auch in den letzten 50 Nachrichten des Kanals nach eigenen Panels, die er vergessen hat, übernimmt das neueste und löscht die übrigen (`IsPanelMessage()`).
- Ein anderer Kanal heißt **umziehen**: das neue Panel kommt, das alte verschwindet.
- „Panel entfernen“ (zweimal klicken) löscht es und vergisst es.

**Ein gesendetes Panel zieht sich selbst nach:** Nach jedem Speichern (Dashboard wie Assistent) bearbeitet der Bot die Panel-Nachricht mit dem neuen Stand. Wer auf ModMail umstellt, hat damit sofort den DM-Knopf im Kanal.

**Kanal löschen** nach dem Schließen: nie, sofort (nach 5 Sekunden, damit das Schließen zu Ende läuft) oder nach 1 Stunde bis 7 Tagen. Auch „sofort“ steht als Zeitpunkt in der Datenbank — stirbt der Bot dazwischen, räumt der minütliche Lauf den Kanal weg.

**Discord** (alles mit „Server verwalten“):

```
/module an modul:tickets      Modul einschalten (Autocomplete über alle Module)
/module aus modul:<id>        ausschalten - die Galerie lehnt ab, sie gehört fest dazu
/module liste                 alle Module mit ihrem Stand
/ticket setup                 der Assistent: Grundlagen, Optionen, Aktionen, Nachrichten, Transcripts, Panel
/ticket panel [kanal]         Panel senden, am selben Ort nachziehen oder umziehen - nie ein zweites
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

**ModMail per DM:** Schreibt ein User dem Bot ohne offenes Ticket, fragt der Bot **immer** erst nach dem Server (`GuildPickerView()`, nur Server mit ModMail, auf denen der User Mitglied ist), dann nach dem Thema (`OptionPickerView()`) — auch wenn es nur einen Server oder nur ein Thema gibt, damit der User weiß, wo er landet und worum es geht. Die Prüfung von oben läuft schon vor der Themenwahl (`TopicPicker()`). Alles, was der User bis dahin schreibt, sammelt der Bot (bis 10 Minuten, bis 10 Dateien) und stellt es danach ins Ticket. Schreibt er weiter, während die Auswahl noch offen ist, kommt keine zweite Auswahl, nur ein 📝 an seiner Nachricht (`AskServer()`, fünf Minuten oder bis ein Ticket aufgeht).

**ModMail über das Panel:** Im Kanal stehen bei ModMail keine Themen, nur der Knopf **„Ticket per DM starten“** (`ticket:dm`). Der Server steht damit fest: Ein Klick prüft wie oben und schickt die Themenwahl per DM — auch bei nur einem Thema. Die Antwort im Server verlinkt in die DM. Sind DMs zu, sagt der Bot, wo man sie erlaubt.

**Nachrichten hin und her:** Beide Richtungen gehen als Components V2 (`RelayView()`), oben eine Marke, wer schreibt:

| Richtung | Wie | Marke |
|---|---|---|
| Team → User (DM) | Karte vom Bot, Akzent blau | `🛡️ Team · Name` — im anonymen Modus der Team-Alias |
| User → Team (Ticket) | per Webhook mit Name und Bild des Users, Akzent grün; ohne Webhook-Recht die Karte vom Bot mit dem Namen darin | `👤 User` |

Bilder stehen als Galerie in der Karte, andere Dateien als Datei-Baustein — Components V2 zeigt Anhänge nur mit Verweis (`attachment://`, der Name dafür wird bereinigt). Über 10 MB bleibt es ein Link. Auch die kurzen Antworten des Bots in der DM (eingefroren, Slowmode, nicht zustellbar) sind Karten.

**Schließen:** Bei ModMail schließt nur das Team. Die DM hat keinen Knopf mehr dafür; ältere DMs mit Knopf bekommen eine Erklärung statt eines geschlossenen Tickets. Bei Klassisch darf der Ersteller weiter selbst schließen.

---

## Die 15 Aktionen

Alle in **einem** Menü unter der Eröffnung — und dieselben in [Live Tickets](#live-tickets) im Dashboard. Fest dabei: `close`, `claim`/`unclaim`, `add_user`/`remove_user`. Der Rest wird zugeschaltet. Schließen darf bei Klassisch auch der Ersteller, alles andere nur das Team (Support-Rolle der Option bzw. die allgemeine, oder „Server verwalten“).

| Aktion | Kanal | Forum-Post | Bei ModMail zusätzlich |
|---|---|---|---|
| `close` | Grund per Modal, Rechte von Ersteller und Mitgliedern weg, `closed-` vor den Namen, Transcript | Tag *Geschlossen*, gesperrt, archiviert, Transcript | Abschluss-DM |
| `claim` / `unclaim` | Bearbeiter in der Statuszeile | dazu Tag *Beansprucht* | Hinweis per DM (wer sich kümmert bzw. „wartet wieder auf das Team“) |
| `add_user` / `remove_user` | Rechte-Overwrite | Thread-Mitglied | wirkt auf die Team-Seite |
| `transfer` | Kanal in die Kategorie der Ziel-Option, Rolle getauscht | Options-Tag getauscht | Hinweis per DM mit dem neuen Thema |
| `priority` | 🟢🟡🔴 vor dem Kanalnamen | Tag je Stufe | Hinweis per DM |
| `anonymous_mode` | Nachrichten des Teammitglieds kommen per Webhook unter „<Server> Team“ | dito, Webhook am Forum | das Relay zeigt den Alias |
| `media_vault` | die letzten 500 Nachrichten: Bilder als Galerie, der Rest als Liste | dito | beide Seiten, weil das Relay Anhänge mitnimmt |
| `slowmode` | `setRateLimitPerUser` | dito | der Bot bremst das Weiterleiten, Hinweis per DM |
| `tldr_summary` | Faktenkarte aus der Datenbank, kein Sprachmodell | dito | — |
| `staff_note` | Modal → `tickets.notes`, nur über die Zusammenfassung sichtbar | dito | geht nie ins Relay |
| `freeze` | Ersteller darf nicht schreiben, Nachricht `frozen` | Post gesperrt | Relay stoppt, `frozen` per DM; Auftauen meldet der Bot auch |
| `blacklist` | Sperre + Ticket schließen | dito | Absage-DM `blacklisted` |
| `schedule_meeting` | Datum/Uhrzeit (deutsche Zeit) per Modal, Erinnerung pingt Ersteller und Bearbeiter | dito | Termin und Erinnerung auch per DM |

Die Beschriftungen kommen aus `src/config/ticketactions.json`; `npm run check:tickets` hält die Datei und `ACTIONS` in `constants/Tickets.ts` deckungsgleich.

---

## Nachrichten

Sieben Stück, jede ein Dokument aus Bausteinen (`src/interfaces/builder/IMessageDoc.ts`):

| Schlüssel | Wo sie landet |
|---|---|
| `panel` | im Server-Kanal bei Klassisch, mit Buttons oder Auswahlmenü darunter |
| `modmailPanel` | im Server-Kanal bei ModMail: erklärt, dass es per DM weitergeht. Darunter nur der Knopf „Ticket per DM starten“ — die Themen fragt der Bot in der DM ab. Der erste Standardtext versprach noch Themen im Panel; wer ihn nie geändert hat, bekommt beim Lesen den neuen (`LEGACY_MODMAIL_PANEL`) |
| `opened` | Eröffnung im Ticket; jede Option darf eine eigene haben |
| `dm` | Bestätigung an den User bei ModMail. Einen Knopf zum Schließen gibt es nicht — das macht das Team |
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
{support.role} {closer} {reason} {bot}
```

`{bot}` ist die Erwähnung des Bots — gedacht für das ModMail-Panel („Schreib {bot} eine DM“).

Unbekannte bleiben stehen, damit ein Tippfehler auffällt. In DMs stehen Namen statt Erwähnungen — Discord zeigt eine Rollen-Erwähnung dort als „@unbekannte-rolle“.

---

## Transcripts

Beim Schließen liest der Bot den ganzen Verlauf des Tickets und legt ihn ab — im Dashboard unter **Transcriptions** (Liste mit Suche nach Nummer, Name oder User-ID). Eingestellt wird es unter *Einrichtung › Nach dem Schließen* bzw. im Assistenten auf der Seite *Transcripts*:

| Schalter | Wirkung |
|---|---|
| Transcript speichern | Aus: kein Transcript, weder im Dashboard noch im Log-Kanal |
| Log-Kanal | Karte (Nummer, Ersteller, Bearbeiter, Grund, Dauer, Zahlen) mit Knopf „Online ansehen“ und der HTML-Datei |
| Kopie an den Ersteller | Dieselbe Karte per DM. **Nur bei Klassisch:** bei ModMail steht das Gespräch schon in seinen DMs, und die Team-Seite mit ihren internen Zeilen gehört nicht zu ihm |

**Was drinsteht:** jede Nachricht mit Autor (Name, Bild, Rollenfarbe), Markdown, Erwähnungen, Server-Emojis, Zeitstempeln, Antworten, Reaktionen, Stickern, Embeds, Anhängen — und **Components V2**: Container mit Akzentfarbe, Text, Abschnitte mit Vorschaubild oder Knopf, Galerien, Trenner, Dateien, Knöpfe und Auswahlmenüs (aufklappbar, damit man sieht, was zur Wahl stand). Oben stehen die Eckdaten des Tickets.

**Selbst gebaut statt `discord-transcript-v2`:** Das Paket lädt die Darstellung beim Öffnen von einem CDN nach, bringt React mit und verlinkt Bilder nur auf Discord. `TranscriptHtml.ts` rendert alles selbst, ohne Skript und ohne fremde Schrift; die Seite trägt eine Content-Security-Policy, jeder Text läuft durch `Escape()`, Links nur mit http(s).

**Gespeichert** wird der Verlauf als zlib-gepacktes JSON in `ticket_transcripts.data`; gerendert wird erst beim Ansehen — alte Transcripts zeigen so jede spätere Verbesserung. **Anhänge** kopiert der Bot nach `transcripts/<server>/<ticket>/` (nicht im Repo): Discord-Links auf Anhänge laufen nach etwa einem Tag ab. Heruntergeladen wird nur von Discords CDN, ohne Umleitungen.

| Grenze | Wert |
|---|---|
| Nachrichten je Transcript | 5000 (die neuesten; darüber steht ein Hinweis) |
| ein gesicherter Anhang | 25 MB — größere bleiben ein Link, der abläuft, und sind als „nicht gesichert“ markiert |
| alle Anhänge eines Tickets | 100 MB |
| Bilder in der HTML-Datei | 6 MB eingebettet, der Rest zeigt auf die Online-Ansicht; über 10 MB gibt es nur den Link |

**Ansehen** unter `/transcript/<ticket>` — nur angemeldet (Discord-Login des Dashboards, also mit Zwei-Faktor). Öffnen dürfen: „Server verwalten“, die Support-Rolle des Tickets und bei Klassisch der Ersteller und hinzugefügte User. Wer es nicht darf, sieht dieselbe Seite wie bei einer Nummer, die es nicht gibt. `?download=1` liefert die Datei mit eingebetteten Bildern. **Löschen** geht in der Liste (zweimal klicken) — samt der gesicherten Anhänge.

**Reihenfolge beim Schließen:** Das Transcript entsteht im Hintergrund, die Antwort im Menü wartet nicht darauf. Die Löschfrist (auch „sofort“) wartet dagegen: `Remove()` löscht den Kanal erst, wenn das Transcript steht. Scheitert es, bleibt der Kanal eine Stunde länger, dann versucht der minütliche Lauf es erneut. Wer geschlossen hat und warum, steht am Ticket (`closed_by`, `close_reason`) — auch ein Transcript nach einem Neustart kennt es.

---

## Live Tickets

Im Dashboard unter **Live Tickets**: links alle offenen Tickets des Servers, rechts der Verlauf — so, wie ihn auch das Transcript zeigt (Components V2 inklusive), nur live. Neue Tickets, Nachrichten, Bearbeitungen und Löschungen kommen ohne Neuladen an.

**Wer es sieht:** „Server verwalten“ alle Tickets. Im Verlauf steht an jedem Namen **TEAM** oder **USER** (wie Discords BOT-Marke); weitergeleitete ModMail-Nachrichten erscheinen unter dem Ersteller selbst. Transcripts tragen die Marke ab jetzt ebenfalls, ältere bleiben ohne. Dazu die **Support-Rollen** — sie bekommen den Server in ihrer Liste, obwohl sie ihn nicht verwalten dürfen, sehen dort aber nur **Live Tickets** und **Transcriptions**, und darin nur die Tickets ihrer Rolle. Das ist dieselbe Regel wie im Ticket selbst (`IsStaff()`): die allgemeine Support-Rolle sieht alles außer Themen mit eigener Rolle, eine Themen-Rolle nur ihr Thema. Einstellungen, Panel und Löschen bleiben bei „Server verwalten“.

**Schreiben:** Die Nachricht geht über einen Webhook mit Namen und Bild des Teammitglieds und dem Zusatz „· via Dashboard“ — im Discord sieht jeder, woher sie kam. Im anonymen Modus steht dort der Team-Alias mit dem Server-Bild. Ohne Webhook-Recht schreibt der Bot sie selbst, mit dem Namen davor. Bei ModMail geht sie wie jede Team-Antwort per DM an den User; kommt sie dort nicht an (DMs zu), sagt das Dashboard es.

Im Kopf stehen Übernehmen/Zurückgeben, Priorität und Schließen, daneben das Menü **„⚙️ Aktion …“** mit allen weiteren Aktionen, die der Server eingeschaltet hat — dieselbe Liste wie in Discord, dieselben Wege im `TicketService`. Was vorher etwas wissen will, fragt in einer Leiste unter dem Kopf nach:

| Aktion | Im Dashboard |
|---|---|
| Schließen / Sperren | Grund; im Ticket steht „(Dashboard)“ dahinter, ohne Grund „Im Dashboard geschlossen“. Transcript und Löschfrist wie immer |
| Verschieben | Auswahl der übrigen Themen |
| Benutzer hinzufügen | Suche nach Name oder User-ID (ohne Bots und ohne, wer schon drin ist) |
| Benutzer entfernen | die hinzugefügten User zum Anklicken |
| Slowmode · Notiz · Termin | Stufe · Text · Datum und Uhrzeit (in der Zeit des Browsers) |
| Zusammenfassung | die Eckdaten plus die Team-Notizen |
| Medien-Tresor | Bilder als Kacheln, der Rest als Links |
| Einfrieren · Anonymer Modus | schalten sofort; das Menü zeigt den Zustand („Ticket auftauen“, „Anonymer Modus: an“) |
| Dateien | bis 8 MB je Datei, bis 10 auf einmal — oder Bilder aus der Galerie |

**Hinweise:** Zähler ungelesener Nachrichten je Ticket und im Tab-Titel, ein leiser Ton bei neuen Tickets (abschaltbar, merkt sich der Browser). Entwürfe bleiben je Ticket stehen, solange die Seite offen ist.

**Transcripts ohne Neuladen:** Ist ein Transcript gespeichert, meldet der Stream es (`transcript`), und die Liste unter Transcriptions lädt still neu — auch wenn man gerade dort steht. Sie lädt außerdem neu, sobald der Abschnitt wieder aufgeht.

**Technik:** Die Seite hält eine Server-Sent-Events-Verbindung (`/live/stream`), höchstens 6 je Person, mit einem Ping alle 25 Sekunden. Sie startet, sobald Live Tickets oder Transcriptions das erste Mal offen sind. Reißt sie ab, verbindet der Browser neu und holt die Liste frisch. Der Verlauf lädt 50 Nachrichten, ältere auf Knopfdruck. Gerendert wird mit `RenderLive()` aus `TranscriptHtml.ts` — dieselbe Darstellung wie im Transcript, in einem Shadow DOM, damit das Aussehen des Dashboards und des Verlaufs sich nicht beißen. Discord-Links auf Anhänge sind hier frisch, deshalb gibt es kein „nicht gesichert“.

| Datei | Aufgabe |
|---|---|
| `services/LiveService.ts` | Zugriff, Liste, Verlauf, Streams, Ereignisse aus Discord |
| `utils/live.ts` | Anmeldung, Recht und Ticket prüfen — für alle Live-Routen gleich |
| `routes/DashboardApiLive.ts` | `GET …/live` — Liste, eigene Rechte, Emojis, Aussehen |
| `routes/DashboardApiLiveStream.ts` | `GET …/live/stream` — die Ereignisse |
| `routes/DashboardApiLiveTicket.ts` | `GET …/live/:ticket` Verlauf, `POST` schreiben und alle Aktionen, dazu die Suche für „Benutzer hinzufügen“ (nur JSON) |
| `routes/DashboardApiLiveFile.ts` | `POST …/live/:ticket/file` — eine Datei, roh als `application/octet-stream` |
| `dashboard/client/pages/GuildLive.ts` | die Seite |

---

## Was der Bot braucht

- **Rechte:** Kanäle verwalten, Rollen verwalten (für Overwrites), Nachrichten verwalten, Webhooks verwalten (anonymer Modus, ModMail-Nachrichten mit Name und Bild des Users, Antworten aus dem Dashboard), im Forum Threads verwalten.
- **Intents:** `DirectMessages` plus `Partials.Channel` — sonst sieht er keine DM (`BotClient.ts`).
- Ein Overwrite erlaubt nie mehr, als der Bot selbst hat (`Allowed()`), sonst lehnt Discord den ganzen Kanal ab.

---

## Fallen

- **Forum + Klassisch ist öffentlich.** Forum-Posts sieht jeder, der das Forum sieht. Das Dashboard sagt es bei dieser Kombination dazu.
- **Umbenennen ist gebremst.** Discord erlaubt zwei Namensänderungen je Kanal in zehn Minuten. Der Bot benennt deshalb nur bei Priorität, Verschieben und Schließen um, und ohne zu warten — eine dritte kommt verspätet an.
- **Ein gesperrter Post (eingefroren, geschlossen) nimmt nur noch Nachrichten von Leuten mit „Threads verwalten“.** Wer im Forum mitschreiben soll, braucht das Recht dort.
- **Anhänge über 10 MB gehen als Link weiter**, nicht als Datei — mehr darf ein Bot ohne Boost nicht hochladen.
- **Online-Transcripts brauchen den Dashboard-Login, und der braucht Zwei-Faktor bei Discord.** Wer das nicht hat, öffnet die HTML-Datei aus Log-Kanal oder DM.
- **Live Tickets zeigen höchstens 200 offene Tickets**, die neuesten zuerst.
- **Der Ordner `transcripts/` wächst mit jedem Ticket, das Bilder hat.** Er gehört ins Backup wie die Datenbank; gelöscht wird nur, was das Team in der Liste löscht.

---

## Prüfen

```bash
npm run check:tickets     # Aktionsliste, Platzhalter, Einstellungen, Menü, Panel, Transcript- und Live-Darstellung, wer was sieht, Datenbank
npm run check:dashboard   # Platzhalter-Spiegel, Rechte und CSRF der Ticket-, Transcript- und Live-Routen
```

Was nur mit echter Discord-Verbindung geht — Kanäle anlegen, Tags, Relay, Webhooks, Anhänge herunterladen, Live-Ereignisse — prüft erst ein Lauf auf einem Testserver.
