-- Temp Voice: Sprachkanaele auf Zuruf. Siehe docs/Voice.md.

-- Ein "Hier klicken"-Sprachkanal. Wer ihn betritt, bekommt seinen eigenen.
CREATE TABLE IF NOT EXISTS voice_hubs (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    channel_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    config     JSON NOT NULL,
    created_by VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_hub_channel (channel_id),
    KEY idx_hub_guild (guild_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Ein laufender Kanal. Steht in der Tabelle, damit ein Neustart nicht vergisst,
-- wem er gehoert - und damit leere Kanaele danach wieder verschwinden.
CREATE TABLE IF NOT EXISTS temp_voices (
    channel_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    guild_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    hub_id     INT UNSIGNED NULL,
    owner_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    settings   JSON NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (channel_id),
    KEY idx_temp_guild (guild_id),
    KEY idx_temp_owner (guild_id, owner_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Die Presets eines Users: Name, Groesse, Privatsphaere und wem er vertraut.
-- Sie gelten ueberall, nicht nur auf einem Server - eines davon ist das Standard-
-- Preset und wird beim naechsten eigenen Kanal von selbst angewandt.
CREATE TABLE IF NOT EXISTS voice_presets (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name       VARCHAR(60) NOT NULL,
    config     JSON NOT NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_preset_name (user_id, name),
    KEY idx_preset_user (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
