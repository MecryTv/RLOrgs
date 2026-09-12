-- Zwei Dinge:
--
-- 1. player_ranks. Ränge werden nur noch alle 10 Minuten bei Rocket League
--    geholt und dazwischen von hier gelesen. Nebenbei entsteht damit der
--    Peak-Wert, den die WTSI-Rechnung braucht: die höchste je gesehene MMR.
--
-- 2. clubs. Ein Club hängt am Spieler, nicht am Discord-Server - deshalb eine
--    eigene Tabelle und nicht die vorhandene teams.

CREATE TABLE IF NOT EXISTS player_ranks (
    user_id       VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Playlist-ID von Rocket League: 10 = 1v1, 11 = 2v2, 13 = 3v3.
    playlist      SMALLINT UNSIGNED NOT NULL,
    mmr           SMALLINT UNSIGNED NOT NULL,
    -- Die höchste je gesehene MMR. Wächst nur, damit ein Absturz den Peak nicht
    -- mitreißt - genau darauf baut der Schutz gegen Deranking auf.
    peak_mmr      SMALLINT UNSIGNED NOT NULL,
    tier          TINYINT UNSIGNED NOT NULL DEFAULT 0,
    division      TINYINT UNSIGNED NOT NULL DEFAULT 0,
    matches       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    streak        SMALLINT NOT NULL DEFAULT 0,
    placement     TINYINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, playlist),
    -- Für "wessen Daten sind älter als zehn Minuten?"
    KEY idx_rank_fresh (updated_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clubs (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name       VARCHAR(64) NOT NULL,
    tag        VARCHAR(8)  NOT NULL,
    leader_id  VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Wie viele Mitglieder hineinpassen. Im Vorbild steht "4/6".
    max_members TINYINT UNSIGNED NOT NULL DEFAULT 6,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- Zwei Clubs mit demselben Tag wären nicht auseinanderzuhalten.
    UNIQUE KEY uniq_club_tag (tag),
    UNIQUE KEY uniq_club_name (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS club_members (
    club_id   INT UNSIGNED NOT NULL,
    user_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    role      ENUM('leader', 'officer', 'member') NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Ein Spieler ist in höchstens einem Club: der Nutzer ist der Schlüssel,
    -- nicht das Paar aus Club und Nutzer.
    PRIMARY KEY (user_id),
    KEY idx_club_member (club_id, role),
    CONSTRAINT fk_club_member FOREIGN KEY (club_id) REFERENCES clubs (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
