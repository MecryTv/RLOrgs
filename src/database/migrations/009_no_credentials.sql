-- Zurueck zu einer einzigen Anmeldung: Discord.
--
-- Migration 008 hat eine Tabelle fuer Passwoerter und Zwei-Faktor-Schluessel
-- angelegt, damit man sich neben Discord auch mit E-Mail anmelden kann. Das
-- traegt nicht:
--
--   * Das Konto entsteht ohnehin nur ueber Discord. Ein eigenes Passwort war
--     eine zweite Tuer in denselben Raum.
--   * Wer bei Discord einen zweiten Faktor gesetzt hat, hat ihn damit auch
--     hier. Ein eigener TOTP-Schluessel sicherte also eine Tuer ab, die neben
--     der bereits gesicherten stand.
--   * Und er brachte etwas mit, das es vorher nicht gab: gespeicherte
--     Passwort-Hashes und Schluessel, die jemand stehlen kann.
--
-- Die Datei 008 bleibt stehen, weil sie auf bestehenden Datenbanken schon
-- vermerkt ist - angewandte Migrationen schreibt man nicht um. Diese hier raeumt
-- das Ergebnis wieder weg, samt allem, was darin stand.

DROP TABLE IF EXISTS dashboard_credentials;
