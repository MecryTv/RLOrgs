-- Wer im Dashboard welche Gruppe hat. Stand vorher als ID-Liste in der
-- config.json - vergeben wird sie jetzt unter /dashboard/admins.
--
-- Ein Nutzer hat höchstens eine Gruppe, deshalb ist user_id der Primärschlüssel.
-- "developer" fehlt hier bewusst: die Liste steht in DEV_USER_IDs und ist der
-- Einstieg, über den die erste Berechtigung überhaupt vergeben werden kann.
-- Wer in keiner Zeile steht, ist in der Testphase.

CREATE TABLE IF NOT EXISTS dashboard_groups (
    user_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    group_name ENUM('administrator', 'partner', 'premium') NOT NULL,
    -- Wer sie vergeben hat, damit im Admin-Dashboard nachvollziehbar bleibt,
    -- woher eine Berechtigung kommt.
    granted_by VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    granted_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note       VARCHAR(190) NULL,
    PRIMARY KEY (user_id),
    KEY idx_group (group_name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
