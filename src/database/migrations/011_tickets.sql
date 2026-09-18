-- Das Ticket-System. Siehe docs/Tickets.md.
--
-- Mitglieder, Notizen und die Aliasse des anonymen Modus sind JSON-Spalten am
-- Ticket statt eigener Tabellen: sie werden immer mit dem Ticket gelesen und nie
-- ohne es. Termine und Löschfristen stehen als Millisekunden seit 1970 (UTC) da,
-- nicht als DATETIME - so rechnet kein Treiber eine Zeitzone falsch um.

CREATE TABLE IF NOT EXISTS ticket_settings (
    guild_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Kontakt, Oberfläche, Rollen, Optionen, Aktionen und alle Nachrichten.
    config     JSON      NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Fortlaufend je Server: #0001, #0002 ...
    number      INT UNSIGNED NOT NULL,
    option_id   VARCHAR(32) NOT NULL,
    opener_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- ModMail oder direkt: steht am Ticket, damit ein Umstellen der Einstellungen
    -- laufende Tickets nicht umdeutet.
    contact     ENUM('direct', 'modmail') NOT NULL,
    -- Die Team-Seite: Textkanal oder Forum-Post. NULL nur, solange sie entsteht.
    channel_id  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    -- Die Nachricht mit Status und Aktions-Menü.
    message_id  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    claimed_by  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    status      ENUM('open', 'frozen', 'closed') NOT NULL DEFAULT 'open',
    priority    ENUM('low', 'normal', 'high') NULL,
    slowmode    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    members     JSON NOT NULL,
    notes       JSON NOT NULL,
    anonymous   JSON NOT NULL,
    messages    INT UNSIGNED NOT NULL DEFAULT 0,
    reminder_at BIGINT UNSIGNED NULL,
    delete_at   BIGINT UNSIGNED NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at   TIMESTAMP NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_ticket_number (guild_id, number),
    UNIQUE KEY uniq_ticket_channel (channel_id),
    KEY idx_ticket_opener (opener_id, status),
    KEY idx_ticket_reminder (reminder_at),
    KEY idx_ticket_delete (delete_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_blacklist (
    guild_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason     VARCHAR(500) NULL,
    created_by VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
