-- A competition is now a property of one event: none, individual, team, or house (the school's four houses).
-- The competitions table stays (entries hang off it); the app keeps at most one per event.
ALTER TABLE competitions ADD COLUMN kind TEXT NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual','team','house'));
UPDATE competitions SET kind = 'team' WHERE is_team = 1;
-- Which house an entrant competes for (house competitions only; the names are checked by the app).
ALTER TABLE competition_entries ADD COLUMN house TEXT;
