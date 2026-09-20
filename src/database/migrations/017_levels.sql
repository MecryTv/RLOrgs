-- Level System: Punkte fuer Nachrichten und Zeit im Sprachkanal.
-- Siehe docs/Levels.md.
CREATE TABLE IF NOT EXISTS levels (
    guild_id     VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    xp           BIGINT UNSIGNED NOT NULL DEFAULT 0,
    level        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    messages     INT UNSIGNED NOT NULL DEFAULT 0,
    voice_minutes INT UNSIGNED NOT NULL DEFAULT 0,
    -- Wann zuletzt Punkte fuer eine Nachricht gab - dagegen laeuft die Sperre.
    last_message BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at   BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (guild_id, user_id),
    KEY idx_level_rank (guild_id, xp DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
