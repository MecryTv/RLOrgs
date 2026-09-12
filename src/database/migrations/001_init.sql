-- Grundschema von RLOrgs.
--
-- Discord-IDs stehen als VARCHAR(20) da und nicht als BIGINT: gerechnet wird mit
-- ihnen nie, gereicht werden sie ständig durch JSON - und dort verliert eine
-- 64-Bit-Zahl in JavaScript die letzten Stellen. ascii_bin, weil eine Snowflake
-- nur Ziffern enthält und der Vergleich exakt sein soll.
--
-- MariaDB committet bei DDL implizit: eine Migration lässt sich nicht zurückrollen.
-- Deshalb bleibt eine Datei bei einer zusammenhängenden Änderung.

CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    modules       JSON        NOT NULL,
    rank_roles    JSON        NOT NULL,
    match_channel VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    queue_channel VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teams (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name       VARCHAR(64) NOT NULL,
    tag        VARCHAR(8)  NULL,
    role_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    active     TINYINT(1)  NOT NULL DEFAULT 1,
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- Zwei Teams mit demselben Namen auf einem Server wären nicht auseinanderzuhalten.
    UNIQUE KEY uniq_team_name (guild_id, name),
    KEY idx_team_guild (guild_id, active)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_members (
    team_id   INT UNSIGNED NOT NULL,
    user_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    role      ENUM('captain', 'player', 'substitute', 'coach') NOT NULL DEFAULT 'player',
    joined_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Ein Nutzer steht höchstens einmal in einem Team.
    PRIMARY KEY (team_id, user_id),
    KEY idx_member_user (user_id),
    CONSTRAINT fk_member_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_accounts (
    user_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    platform   ENUM('epic', 'steam', 'xbox', 'psn', 'switch') NOT NULL,
    account_id VARCHAR(64) NOT NULL,
    verified   TINYINT(1)  NOT NULL DEFAULT 0,
    linked_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Pro Plattform ein Konto je Nutzer.
    PRIMARY KEY (user_id, platform),
    KEY idx_account_lookup (platform, account_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matches (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id     VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    home_team_id INT UNSIGNED NULL,
    away_team_id INT UNSIGNED NULL,
    home_score   TINYINT UNSIGNED NOT NULL DEFAULT 0,
    away_score   TINYINT UNSIGNED NOT NULL DEFAULT 0,
    playlist     ENUM('1v1', '2v2', '3v3') NOT NULL DEFAULT '3v3',
    state        ENUM('scheduled', 'live', 'finished', 'cancelled') NOT NULL DEFAULT 'scheduled',
    played_at    DATETIME     NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_match_guild (guild_id, state, played_at),
    -- Ein gelöschtes Team soll die Partie nicht mitnehmen: das Ergebnis bleibt,
    -- die Seite steht dann nur ohne Team da.
    CONSTRAINT fk_match_home FOREIGN KEY (home_team_id) REFERENCES teams (id) ON DELETE SET NULL,
    CONSTRAINT fk_match_away FOREIGN KEY (away_team_id) REFERENCES teams (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
