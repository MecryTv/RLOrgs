-- Moderatoren für den ganzen Server, Ticket-Kürzel und User-IDs, das
-- Moderations-Modul. Siehe docs/Moderation.md und docs/Tickets.md.

-- Moderatoren (User und Rollen) gelten für den ganzen Server: Tickets und
-- Moderation. NULL heißt: nie gespeichert - dann gilt die leere Liste.
ALTER TABLE guild_settings
    ADD COLUMN IF NOT EXISTS moderators JSON NULL AFTER queue_channel;

-- Bis hierhin stand die Liste in den Ticket-Einstellungen. Wer dort schon
-- welche eingetragen hat, behält sie.
INSERT INTO guild_settings (guild_id, modules, rank_roles, moderators)
    SELECT guild_id, JSON_ARRAY(), JSON_OBJECT(), JSON_EXTRACT(config, '$.moderators')
    FROM ticket_settings
    WHERE JSON_EXTRACT(config, '$.moderators') IS NOT NULL
ON DUPLICATE KEY UPDATE moderators = COALESCE(guild_settings.moderators, VALUES(moderators));

-- Das Kürzel des Themas beim Öffnen (SUP): es steht am Ticket, damit SUP-5 auch
-- SUP-5 bleibt, wenn das Thema später anders heißt oder das Ticket umzieht.
-- Daneben die User-ID des Erstellers (siehe user_codes): sie ändert sich nie und
-- steht so überall bereit, ohne eigene Abfrage.
ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS code        VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER number,
    ADD COLUMN IF NOT EXISTS opener_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER opener_id;

ALTER TABLE ticket_transcripts
    ADD COLUMN IF NOT EXISTS code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER number;

-- Eine feste, kurze ID je User (U-7K3F) - in all seinen Tickets, auf jedem Server.
CREATE TABLE IF NOT EXISTS user_codes (
    user_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    code       VARCHAR(8)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uniq_user_code (code)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Moderation: Log-Kanal, DM an den User, Stufen für Warns.
CREATE TABLE IF NOT EXISTS mod_settings (
    guild_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    config     JSON      NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Jeder Fall: wer, was, warum, wie lange - mit Beweisen und Notizen. Zeiten als
-- Millisekunden seit 1970 (UTC), wie bei den Tickets.
CREATE TABLE IF NOT EXISTS mod_cases (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id       VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Fortlaufend je Server: Fall #1, #2 ...
    number         INT UNSIGNED NOT NULL,
    action         ENUM('ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn', 'unwarn', 'purge') NOT NULL,
    -- Beim Löschen von Nachrichten ohne bestimmten User leer.
    target_id      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    target_name    VARCHAR(100) NULL,
    moderator_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    moderator_name VARCHAR(100) NOT NULL,
    reason         VARCHAR(1000) NULL,
    -- Sekunden: Timeout und befristeter Ban.
    duration       INT UNSIGNED NULL,
    expires_at     BIGINT UNSIGNED NULL,
    -- Ein Warn zählt noch, ein befristeter Ban läuft noch.
    active         TINYINT(1) NOT NULL DEFAULT 1,
    source         ENUM('discord', 'dashboard', 'auto') NOT NULL,
    -- Der zurückgenommene Warn, der auslösende Warn einer Stufe, der aufgehobene Ban.
    related        INT UNSIGNED NULL,
    -- Je Aktion: Kanal und Anzahl beim Löschen, gelöschte Tage beim Ban, ob die DM ankam.
    details        JSON NOT NULL,
    evidence       JSON NOT NULL,
    notes          JSON NOT NULL,
    -- Die Karte im Log-Kanal - sie wird bei Änderungen nachgezogen.
    log_channel    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    log_message    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at     BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_case_number (guild_id, number),
    KEY idx_case_target (guild_id, target_id, id),
    KEY idx_case_expiry (active, expires_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
