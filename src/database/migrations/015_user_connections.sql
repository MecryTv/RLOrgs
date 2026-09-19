-- Die Discord-Verknuepfungen eines Nutzers (Twitch, YouTube), wie sie beim
-- Dashboard-Login mit dem Scope "connections" herauskommen. Damit erkennt der
-- Notifier, welcher Discord-Account zu einem Streamer gehoert.
--
-- Nur bestaetigte Verknuepfungen landen hier, und nur von Leuten, die sich
-- selbst im Dashboard angemeldet haben. Siehe docs/Notifiers.md.
CREATE TABLE IF NOT EXISTS user_connections (
    user_id     VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    platform    ENUM('twitch', 'youtube') NOT NULL,
    -- Twitch: die User-ID, YouTube: die Kanal-ID (UC...) - dieselbe ID wie in stream_notifiers.
    account_id  VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name        VARCHAR(100) NOT NULL,
    updated_at  BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, platform, account_id),
    KEY idx_connection_account (platform, account_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
