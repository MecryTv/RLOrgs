-- Aktivität je Server, für die Übersicht im Dashboard. Siehe docs/Activity.md.
--
-- Zwei der drei Tabellen enthalten nur Zählerstände, keine Discord-IDs. Die
-- Zeit steht als ganze Zahl da - Stunden bzw. Tage seit 1970 in UTC - und nicht
-- als DATETIME: so gibt es auf dem Weg in die Datenbank keine Zeitzone, die der
-- Treiber falsch umrechnen könnte. In Ortszeit rechnet erst der Browser.

CREATE TABLE IF NOT EXISTS guild_activity (
    guild_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Stunden seit 1970, UTC.
    hour     INT UNSIGNED NOT NULL,
    messages INT UNSIGNED NOT NULL DEFAULT 0,
    -- Minuten im Sprachkanal, über alle Mitglieder zusammen.
    voice    INT UNSIGNED NOT NULL DEFAULT 0,
    joins    INT UNSIGNED NOT NULL DEFAULT 0,
    leaves   INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, hour),
    -- Fürs Aufräumen alter Stunden über alle Server hinweg.
    KEY idx_activity_hour (hour)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_activity (
    guild_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    channel_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Tage seit 1970, UTC.
    day        INT UNSIGNED NOT NULL,
    messages   INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, day, channel_id),
    KEY idx_channel_day (day)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Die einzige der drei mit Discord-IDs - nur für die Liste der aktivsten
-- Mitglieder. Nach 14 Tagen gelöscht (Runnable ActivityPrune).
CREATE TABLE IF NOT EXISTS member_activity (
    guild_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    day      INT UNSIGNED NOT NULL,
    messages INT UNSIGNED NOT NULL DEFAULT 0,
    voice    INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, day, user_id),
    KEY idx_member_day (day)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
