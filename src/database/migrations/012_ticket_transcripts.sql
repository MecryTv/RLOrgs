-- Transcripts geschlossener Tickets. Siehe docs/Tickets.md, Abschnitt Transcripts.
--
-- Der Verlauf steht als gepacktes JSON in data (zlib) und wird erst beim
-- Ansehen zu HTML - so zeigen auch alte Transcripts jede spätere Verbesserung
-- der Darstellung. Anhänge liegen auf der Platte unter transcripts/: Discord-Links
-- auf Anhänge laufen nach etwa einem Tag ab.

-- Wer geschlossen hat und warum - das Transcript entsteht unter Umständen erst
-- nach einem Neustart (Löschfrist), dann steht es nur noch hier.
ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS closed_by    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER closed_at,
    ADD COLUMN IF NOT EXISTS close_reason VARCHAR(500) NULL AFTER closed_by;

CREATE TABLE IF NOT EXISTS ticket_transcripts (
    ticket_id   INT UNSIGNED NOT NULL,
    guild_id    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    number      INT UNSIGNED NOT NULL,
    opener_id   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Zum Suchen in der Liste: der Anzeigename beim Schließen.
    opener_name VARCHAR(100) NOT NULL,
    -- Option, Bearbeiter, Schließer, Grund, Zahlen - alles, was die Liste zeigt.
    meta        JSON NOT NULL,
    -- Der ganze Verlauf als zlib-gepacktes JSON.
    data        MEDIUMBLOB NOT NULL,
    -- Millisekunden seit 1970 (UTC), wie reminder_at und delete_at.
    closed_at   BIGINT UNSIGNED NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticket_id),
    KEY idx_transcript_guild (guild_id, ticket_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
