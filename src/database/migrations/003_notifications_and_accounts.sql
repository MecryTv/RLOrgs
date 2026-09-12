-- Zwei Dinge, die zusammen kommen:
--
-- 1. Benachrichtigungen. Bisher sammelte das Dashboard nur eigene Hinweise im
--    Browser - die waren auf einem anderen Rechner weg und der Bot konnte nichts
--    dazulegen. Ab hier liegen sie serverseitig.
--
-- 2. Eine Sperrfrist auf verknüpften Konten. Der Epic-Name lässt sich nur alle
--    30 Tage ändern (im Entwicklungsmodus nach 10 Sekunden), damit niemand
--    fremde Namen durchprobiert.

CREATE TABLE IF NOT EXISTS notifications (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    kind       ENUM('info', 'success', 'warn', 'group', 'account') NOT NULL DEFAULT 'info',
    title      VARCHAR(120)  NOT NULL,
    body       VARCHAR(500)  NOT NULL,
    -- Wohin ein Klick führt, etwa /dashboard/admins. Leer heißt: nirgendwohin.
    link       VARCHAR(190)  NULL,
    read_at    TIMESTAMP     NULL,
    created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- Die eine Abfrage, die es gibt: die neuesten eines Nutzers.
    KEY idx_note_user (user_id, created_at DESC),
    KEY idx_note_unread (user_id, read_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Wann die Verknüpfung zuletzt gewechselt hat. Getrennt von linked_at, damit das
-- erste Verknüpfen nachvollziehbar bleibt, wenn später gewechselt wird.
ALTER TABLE player_accounts
    ADD COLUMN changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER linked_at;

-- Der Anzeigename, wie ihn die Rocket-League-API zurückgibt. account_id trägt
-- die Kennung, die für Abfragen gebraucht wird - die beiden sind nicht immer gleich.
ALTER TABLE player_accounts
    ADD COLUMN display_name VARCHAR(64) NULL AFTER account_id;
