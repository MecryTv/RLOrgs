-- Zurueck auf ein Konto: nur noch Epic.
--
-- Der Gedanke hinter 006 war, die Plattformen, die Prime am Epic-Konto haengen
-- sieht, als eigene Verknuepfungen zu fuehren und eine davon zur Hauptplattform
-- zu erklaeren. Das traegt nicht:
--
--   * Fuer PlayStation und Nintendo gibt es keinen oeffentlichen Login. Sie
--     waeren also nie mehr als eine Auskunft von Epic ueber Epic gewesen.
--   * Die Raenge sind auf allen Plattformen dieselben - nachgemessen: Epic und
--     Steam liefern fuer dasselbe Konto identische Werte. Die Hauptplattform
--     hat also nie entschieden, was zu sehen ist.
--
-- Damit war es eine Auswahl ohne Wirkung. Die Zeilen und die Spalte gehen
-- deshalb wieder weg, statt als Karteileiche stehenzubleiben.

DELETE FROM player_accounts WHERE platform <> 'epic';

ALTER TABLE player_accounts DROP COLUMN is_main;
