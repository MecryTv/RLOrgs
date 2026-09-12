-- Echte Konto-Verknuepfung statt eines eingetippten Namens.
--
-- 1. is_main. Ein Spieler kann auf mehreren Plattformen dasselbe
--    Rocket-League-Konto benutzen - Epic ist die Klammer, aber gespielt wird
--    ueber genau eine davon. Der RL Tracker fragt nach dieser einen, und hier
--    steht die Antwort. Genau eine Zeile je Nutzer traegt die 1; dafuer sorgt
--    PlayerAccount.SetMain, nicht die Datenbank: ein UNIQUE-Index koennte es
--    nicht, weil er auch die vielen Nullen erfassen wuerde.
--
-- 2. club. Der Ingame-Club steht in derselben Antwort, aus der schon Raenge und
--    Karriere-Werte kommen (GetFullProfile > ClubDetails). Er wird deshalb im
--    selben Takt und in derselben Zeile gespeichert - keine zweite Anfrage,
--    kein zweiter Zeitstempel.

ALTER TABLE player_accounts
    ADD COLUMN is_main TINYINT(1) NOT NULL DEFAULT 0 AFTER verified;

-- Wer bisher schon ein Epic-Konto verknuepft hat, spielt bis auf Weiteres
-- darueber. Ohne das stuende nach der Migration jeder ohne Hauptplattform da.
UPDATE player_accounts SET is_main = 1 WHERE platform = 'epic';

ALTER TABLE player_profiles
    ADD COLUMN club JSON NULL AFTER stats;
