-- Anmeldung per E-Mail als zweiter Weg neben Discord.
--
-- Es gibt weiterhin keine Registrierung: ein Konto entsteht ausschliesslich
-- durch die erste Anmeldung ueber Discord. Diese Tabelle haengt sich nur daran -
-- sie sagt, wer sich ausserdem mit E-Mail und Passwort anmelden darf. Ohne Zeile
-- hier geht der Weg ueber Discord, und das ist der Normalfall.
--
--   * email steht doppelt (auch im Sitzungs-Cookie), aber nur hier ist sie
--     durchsuchbar. Genau das braucht der Login: von der Adresse zum Nutzer.
--     UNIQUE, weil sonst zwei Konten auf dieselbe Anmeldung zeigen wuerden.
--
--   * password ist NULL, solange niemand eins gesetzt hat. Kein Passwort heisst
--     kein Login per E-Mail - nicht "leeres Passwort".
--
--   * totp_secret steht auch dann schon da, wenn totp_enabled noch 0 ist: der
--     Schluessel wird erzeugt, in die App uebernommen und erst nach dem ersten
--     richtigen Code scharf geschaltet. Ohne diese Trennung koennte sich jemand
--     aussperren, der den Schluessel nie in seine App bekommen hat.
--
--   * username, handle und avatar sind eine Kopie aus Discord, bei jeder
--     Discord-Anmeldung aufgefrischt. Wer sich per E-Mail anmeldet, hat keinen
--     Discord-Token - ohne diese Kopie stuende die Seite ohne Namen und Bild da.

CREATE TABLE IF NOT EXISTS dashboard_credentials (
    user_id      VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    email        VARCHAR(255) NOT NULL,
    password     VARCHAR(255) NULL,
    totp_secret  VARCHAR(64)  NULL,
    totp_enabled TINYINT(1)   NOT NULL DEFAULT 0,
    username     VARCHAR(64)  NULL,
    handle       VARCHAR(64)  NULL,
    avatar       VARCHAR(64)  NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_credentials_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
