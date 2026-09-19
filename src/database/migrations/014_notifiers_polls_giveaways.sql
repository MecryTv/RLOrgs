-- Twitch- und YouTube-Benachrichtigungen, Umfragen, Giveaways.
-- Siehe docs/Notifiers.md, docs/Polls.md und docs/Giveaways.md.

-- Einstellungen eines Moduls je Server, die zu keinem einzelnen Eintrag
-- gehören - etwa die Live-Rolle des Twitch Notifiers.
CREATE TABLE IF NOT EXISTS module_settings (
    guild_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    module     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    config     JSON      NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, module)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Ein Twitch-Streamer oder YouTube-Kanal, den ein Server verfolgt. config ist,
-- was das Dashboard einstellt (Kanal, Ping, Nachrichten), state, was der Bot
-- sich merkt (Live-Karte, gesehene Videos). Zeiten in Millisekunden (UTC).
CREATE TABLE IF NOT EXISTS stream_notifiers (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    platform      ENUM('twitch', 'youtube') NOT NULL,
    -- Twitch: die User-ID, YouTube: die Kanal-ID (UC...). Namen ändern sich, die ID nie.
    account_id    VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_name  VARCHAR(100) NOT NULL,
    account_login VARCHAR(100) NULL,
    avatar        VARCHAR(512) NULL,
    enabled       TINYINT(1) NOT NULL DEFAULT 1,
    config        JSON NOT NULL,
    state         JSON NOT NULL,
    created_by    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at    BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_notifier (guild_id, platform, account_id),
    KEY idx_notifier_account (platform, account_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Umfragen: eigene mit Knöpfen (Stimmen in poll_votes) oder Discords eigene
-- (die zählt Discord, results hält das Ergebnis am Ende fest).
CREATE TABLE IF NOT EXISTS polls (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Fortlaufend je Server: Umfrage #1, #2 ...
    number      INT UNSIGNED NOT NULL,
    kind        ENUM('buttons', 'native') NOT NULL,
    channel_id  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    message_id  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    question    VARCHAR(300) NOT NULL,
    description VARCHAR(1000) NULL,
    options     JSON NOT NULL,
    settings    JSON NOT NULL,
    status      ENUM('open', 'ended') NOT NULL DEFAULT 'open',
    results     JSON NULL,
    created_by  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at  BIGINT UNSIGNED NOT NULL,
    ends_at     BIGINT UNSIGNED NULL,
    ended_at    BIGINT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_poll_number (guild_id, number),
    KEY idx_poll_due (status, ends_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Eine Zeile je Stimme - bei Mehrfachauswahl mehrere je User.
CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id    INT UNSIGNED NOT NULL,
    user_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    option_id  VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (poll_id, user_id, option_id),
    KEY idx_vote_option (poll_id, option_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Giveaways: geplant, laufend, beendet oder abgebrochen. requirements und bonus
-- sind die Bedingungen und Extra-Lose, results die Gewinner mit ihrer Frist.
CREATE TABLE IF NOT EXISTS giveaways (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id     VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    number       INT UNSIGNED NOT NULL,
    channel_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    message_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    prize        VARCHAR(200) NOT NULL,
    description  VARCHAR(1500) NULL,
    image        VARCHAR(512) NULL,
    winners      INT UNSIGNED NOT NULL,
    host_id      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status       ENUM('scheduled', 'running', 'ended', 'cancelled') NOT NULL,
    starts_at    BIGINT UNSIGNED NOT NULL,
    ends_at      BIGINT UNSIGNED NOT NULL,
    ended_at     BIGINT UNSIGNED NULL,
    requirements JSON NOT NULL,
    bonus        JSON NOT NULL,
    settings     JSON NOT NULL,
    results      JSON NOT NULL,
    created_at   BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_giveaway_number (guild_id, number),
    KEY idx_giveaway_due (status, ends_at),
    KEY idx_giveaway_start (status, starts_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Wer mitmacht, mit seinen Losen (Bonus-Rollen beim Beitritt).
CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INT UNSIGNED NOT NULL,
    user_id     VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tickets     INT UNSIGNED NOT NULL DEFAULT 1,
    created_at  BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
