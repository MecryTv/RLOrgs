-- Custom Message: eigene Nachrichten mit Knoepfen, geplant oder wiederkehrend,
-- dazu Antworten auf Stichwoerter. Siehe docs/Messages.md.

-- Eine Nachricht, wie sie im Dashboard gebaut wird. message_id steht drin,
-- sobald sie gesendet wurde - dann laesst sie sich auch nachtraeglich aendern.
CREATE TABLE IF NOT EXISTS custom_messages (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name       VARCHAR(80) NOT NULL,
    doc        JSON NOT NULL,
    buttons    JSON NOT NULL,
    channel_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    message_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    -- Wann sie rausgeht: einmalig, taeglich oder woechentlich. next ist der
    -- naechste Zeitpunkt in Millisekunden (UTC), null heisst "von Hand".
    schedule   JSON NOT NULL,
    created_by VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    KEY idx_message_guild (guild_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Ein Stichwort und die Antwort darauf.
CREATE TABLE IF NOT EXISTS auto_responses (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    phrase      VARCHAR(200) NOT NULL,
    match_mode  ENUM('contains', 'exact', 'starts', 'regex') NOT NULL DEFAULT 'contains',
    doc         JSON NOT NULL,
    settings    JSON NOT NULL,
    enabled     TINYINT(1) NOT NULL DEFAULT 1,
    uses        INT UNSIGNED NOT NULL DEFAULT 0,
    created_by  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at  BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    KEY idx_response_guild (guild_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
