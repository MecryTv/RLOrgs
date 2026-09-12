-- Reward-Level und Karriere-Werte. Liegt getrennt von den Rängen, weil es sich
-- nicht je Playlist aufteilt - und wird im selben Takt erneuert, damit die Seite
-- auch aus dem Speicher vollständig ist.
--
-- Eigene Datei statt einer Ergänzung von 004: die war schon ausgeführt, und eine
-- ausgeführte Migration wird nicht mehr angefasst. Sonst steht sie in einer
-- Datenbank als "durch" und hat trotzdem nie alles angelegt.

CREATE TABLE IF NOT EXISTS player_profiles (
    user_id      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    season_level TINYINT UNSIGNED NOT NULL DEFAULT 0,
    season_wins  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    stats        JSON NOT NULL,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
