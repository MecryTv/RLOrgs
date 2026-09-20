-- Custom Message kann jetzt dreierlei sein: eine Karte (Components V2), ein
-- Embed oder eine ganz normale Nachricht. Siehe docs/Messages.md.
ALTER TABLE custom_messages
    ADD COLUMN kind ENUM('v2', 'embed', 'text') NOT NULL DEFAULT 'v2' AFTER name,
    ADD COLUMN content TEXT NULL AFTER kind,
    ADD COLUMN embed JSON NULL AFTER doc;

ALTER TABLE auto_responses
    ADD COLUMN kind ENUM('v2', 'embed', 'text') NOT NULL DEFAULT 'v2' AFTER match_mode,
    ADD COLUMN content TEXT NULL AFTER kind,
    ADD COLUMN embed JSON NULL AFTER doc;
