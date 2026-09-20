# Twitch und YouTube Notifier

Sagt Bescheid, wenn eure Streamer live gehen oder ein neues Video da ist — mit eigener Nachricht, einer Karte, die sich während des Streams aktualisiert, einer Zusammenfassung danach und einer Live-Rolle für Mitglieder.

Zwei Module, ein Dienst (`StreamService`): `twitch-notifier` und `youtube-notifier`. Beide werden unter *Module* eingeschaltet (oder `/module an modul:twitch-notifier`). Ohne Datenbank geht nichts — die Streamer stehen dort.

---

## Was der Bot braucht

| | Twitch | YouTube |
|---|---|---|
| Schlüssel | `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` (kostenlose App auf [dev.twitch.tv](https://dev.twitch.tv/console/apps)) | nichts für Videos und Shorts (Kanal-Feed), `YOUTUBE_API_KEY` nur für **Livestreams** |
| Abfrage | jede Minute, alle Streamer aller Server in einem Rutsch (100 je Anfrage) | alle fünf Minuten, ein Feed je Kanal |
| Intent | `GUILD_PRESENCE_INTENT` **nur** für die Live-Rolle | — |
| Rechte | im Zielkanal schreiben (im Forum: Beiträge erstellen), für die Live-Rolle „Rollen verwalten" | dasselbe ohne Rolle |

Fehlt ein Schlüssel, steht das im Dashboard als Hinweis über dem Modul — der Rest läuft weiter. Ohne `YOUTUBE_API_KEY` lässt sich „Livestreams" nicht einschalten; Videos und Shorts kommen trotzdem. Siehe [Environment.md](Environment.md).

---

## Einen Streamer eintragen

Dashboard › *Twitch Notifier* bzw. *YouTube Notifier* › **hinzufügen**. Erlaubt sind:

- **Twitch:** `mecrytv`, `@MecryTv`, `twitch.tv/MecryTv`, `https://www.twitch.tv/mecrytv` — daraus wird der Login, der Rest fällt weg.
- **YouTube:** Kanal-ID (`UC…`), `youtube.com/channel/UC…`, `@handle` oder ein alter `/c/`- bzw. `/user/`-Link. Handles schlägt der Bot nach: erst über die API (wenn ein Schlüssel da ist), sonst liest er die Kanalseite.

Bis **25 je Server und Plattform**. Wer schon drinsteht, kommt kein zweites Mal rein. Beim Eintragen eines YouTube-Kanals merkt sich der Bot, was gerade im Feed steht — sonst käme sofort eine Flut alter Videos.

---

## Wer ist das in Discord?

An jedem Streamer und Kanal kann ein **Discord-User** stehen. Gebraucht wird er für zwei Dinge: den Platzhalter `{streamer.mention}` bzw. `{channel.mention}` in der Nachricht – und die **Live-Rolle**. Drei Wege führen dorthin:

| Weg | |
|---|---|
| **Auswählen** | Im Dashboard am Eintrag unter *Discord-User* nach Name oder ID suchen. Geht immer. |
| **Aus dem Streaming-Status** | Streamt jemand sichtbar unter `twitch.tv/<name>` eines Eintrags, trägt der Bot ihn selbst ein (braucht das Presence Intent). Überschrieben wird nie: was schon dasteht, bleibt. |
| **Aus der Discord-Verknüpfung** | Wer sich im Dashboard anmeldet, gibt dabei seine Verknüpfungen frei (Scope `connections`). Passt eine davon zu einem neu eingetragenen Kanal, steht der User sofort da. |

Discord gibt einem Bot **keine** fremden Verknüpfungen – nur der Nutzer selbst kann sie freigeben, und das tut er beim Login. Gespeichert werden davon ausschließlich Twitch und YouTube (`user_connections`, Migration 015); beim nächsten Login wird die Liste ersetzt, entfernte Verknüpfungen verschwinden also von selbst. Was davon gespeichert wird, steht auch auf der Datenschutzseite des Dashboards.

---

## Was gemeldet wird

| Art | Twitch | YouTube |
|---|---|---|
| `live` | Stream gestartet | Livestream läuft (braucht den API-Schlüssel) |
| `video` | — | neues Video |
| `short` | — | neuer Short |

Shorts erkennt der Bot daran, dass `youtube.com/shorts/<id>` ohne Umleitung antwortet — der Feed selbst sagt es nicht. Jede Art hat **ihre eigene Nachricht** und meldet in denselben Kanal.

**Kanal:** ein Textkanal oder ein **Beitrag in einem Forum**, genau wie die Log-Kanäle (`utils/logtarget.ts`, im Dashboard „+ Neuer Beitrag in #forum"). **Ping:** `@everyone`, `@here` oder eine Rolle — je Streamer eine eigene.

---

## Die Nachricht

Geschrieben wird sie im selben Editor wie die Ticket-Nachrichten (Text, Bild, Galerie, Trennlinie; siehe [ComponentV2Builder.md](ComponentV2Builder.md)), mit Live-Vorschau daneben. Ohne eigene Nachricht gilt die Vorlage.

| Twitch | | YouTube | |
|---|---|---|---|
| `{streamer}` | Name | `{channel}` | Kanal-Name |
| `{streamer.login}` | Login | `{channel.avatar}` | Kanalbild |
| `{streamer.avatar}` | Profilbild | `{video.title}` | Titel |
| `{stream.title}` | Titel | `{video.url}` | Link (Short: `/shorts/…`) |
| `{stream.game}` | Spiel | `{video.thumbnail}` | Vorschaubild |
| `{stream.url}` | Link zum Kanal | `{video.kind}` | „Video", „Short", „Livestream" |
| `{stream.viewers}` | Zuschauer | `{video.published}` | wann („vor 2 Stunden") |
| `{stream.preview}` | Vorschaubild | `{guild}` | Server-Name |
| `{stream.started}` | Start („vor 20 Minuten") | `{channel.mention}` | Kanal in Discord (Erwähnung) |
| `{streamer.mention}` | Streamer in Discord (Erwähnung) | `{guild}` | Server-Name |
| `{guild}` | Server-Name | | |

Unter der Karte sitzt immer ein Knopf („Zum Stream", „Ansehen", „Zum Livestream"). **Test senden** schickt dieselbe Karte mit Beispielwerten in den eingestellten Kanal — ohne auf den nächsten Stream zu warten.

---

## Während und nach dem Stream (Twitch)

**Karte aktualisiert sich** (Standard an): Titel, Spiel, Zuschauer und Vorschaubild zieht der Bot nach — sofort, wenn Titel oder Spiel wechseln, sonst höchstens alle fünf Minuten. Den Höchststand der Zuschauer merkt er sich mit.

**Nach dem Stream** — einstellbar je Streamer:

| | |
|---|---|
| **Zusammenfassung** (Standard) | Aus der Karte wird „⚫ … war live": Titel, Spiel, Dauer, Zuschauer-Höchststand und, wenn es ihn schon gibt, ein Knopf zum VOD |
| **Löschen** | Die Meldung verschwindet, sobald der Stream vorbei ist |
| **Stehen lassen** | Die Karte bleibt, wie sie war |

Vorbei ist ein Stream, sobald Twitch ihn nicht mehr meldet — oder eine andere Stream-ID meldet (Neustart). Dann endet die alte Karte und die neue beginnt.

---

## Live-Rolle

Eine Rolle für alle, die gerade live sind — zurück, sobald der Stream endet. Je Plattform eine, beide im Dashboard unter *Live-Rolle*. Sie muss unter der höchsten Rolle des Bots stehen, sonst sagt er das beim Speichern.

**Twitch** auf zwei Wegen:

- **Streaming-Status** (Presence): Wer in Discord als „streamt auf Twitch" angezeigt wird, bekommt sie — auch wenn er in keiner Liste steht. Braucht `GUILD_PRESENCE_INTENT` in der `.env` **und** im Developer Portal. Mit **Nur mit Rolle** (etwa „Streamer") bekommt sie nicht jeder, der zufällig streamt.
- **Aus der Liste**: Meldet der Bot einen Streamer der Liste als live, bekommt sein verknüpfter Discord-User die Rolle ebenfalls — auch ohne Presence Intent, und ohne dass die Filter-Rolle dazwischenkommt.

**YouTube** nur über die Liste: Discord sieht YouTube-Livestreams nicht. Die Rolle bekommt, wer an einem Kanal als **Discord-User** steht, solange dessen Livestream läuft (also nur mit `YOUTUBE_API_KEY`). Steht dort niemand, sagt das Dashboard das über der Karte.

---

## Dashboard

`/dashboard/guild/<id>/twitch-notifier` und `…/youtube-notifier` — oben die Zahlen (Streamer bzw. Kanäle, zuletzt gemeldet, Live-Rolle, Meldungen), darunter das Feld zum Hinzufügen und je Streamer eine Karte: Bild, Name, Stand („live seit 20 Minuten", „Video vor 3 Stunden", „noch nichts gemeldet"), ein Schalter zum Pausieren und **Bearbeiten**. Aufgeklappt links Kanal, Ping, „Was melden" und der Nachrichten-Editor, rechts die Vorschau.

| Route | |
|---|---|
| `GET <base>/api/guild/:id/streams/:platform` | Streamer, Einstellungen, Kanäle, Log-Ziele, Rollen, Stand und Hinweise |
| `POST <base>/api/guild/:id/streams/:platform` | `add`, `save`, `remove`, `test`, `settings` (Live-Rolle), `members` (Suche für den Discord-User), `logthread` — nur JSON |

`:platform` ist `twitch` oder `youtube`, alles andere ist 404. Anfang wie überall: `ManageGate()` (`utils/managegate.ts`) — Sitzung, „Server verwalten", Datenbank, Modul an.

---

## Dahinter

| | |
|---|---|
| Tabelle | `stream_notifiers` (Migration 014): Server, Plattform, Konto, `config` und `state` als JSON |
| `config` | Kanal, Ping, Arten, Nachrichten je Art, Karte aktualisieren, was nach dem Stream passiert |
| `state` | Twitch: der laufende Stream (Nachricht, Titel, Spiel, Zuschauer, Höchststand), zuletzt live. YouTube: die letzten 60 gesehenen Video-IDs, angekündigte Livestreams, der laufende Livestream, die letzte Meldung. Dazu ein Problem-Hinweis (Kanal weg, keine Rechte) |
| Einstellungen | Live-Rolle in `module_settings` (`twitch-notifier`, `youtube-notifier`) |
| Lauf | `CommunityTimers` jede Minute (`RunDue()`); YouTube nur alle fünf Minuten. Ein Lauf, der noch arbeitet, wird nicht doppelt gestartet |

Geht eine Meldung nicht raus, steht der Grund am Streamer und im Dashboard — gelöscht wird nichts.

---

## Prüfen

```bash
npm run check:community   # Namen und Links, Feed lesen, Einstellungen, Karten, Datenbank
```

Twitch wirklich fragen, Videos holen und Nachrichten senden braucht Schlüssel und einen echten Server — das fängt erst ein Lauf dort.
