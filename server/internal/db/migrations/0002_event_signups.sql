-- Richer event pages and advance sign-up.
ALTER TABLE events ADD COLUMN image_url TEXT;
ALTER TABLE events ADD COLUMN host TEXT;
ALTER TABLE events ADD COLUMN signup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (signup_enabled IN (0,1));

-- A place held for a student. Separate from checkins: signing up says "I plan to come", checking in says "I'm here".
CREATE TABLE event_signups (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at        INTEGER NOT NULL DEFAULT (unixepoch()),
  by_staff  INTEGER NOT NULL DEFAULT 0 CHECK (by_staff IN (0,1)),
  UNIQUE (event_id, user_id)
);
CREATE INDEX event_signups_user_idx ON event_signups(user_id);
