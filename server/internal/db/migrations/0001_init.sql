-- Schema for the Spotlight Month app (SQLite). Ported from lib/db/schema.ts.
-- Times are UTC unix seconds. Booleans are 0/1. JSON columns hold JSON text.

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  class_name           TEXT,
  role                 TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','teacher','admin')),
  login_code_hash      TEXT,
  show_on_leaderboard  INTEGER NOT NULL DEFAULT 0 CHECK (show_on_leaderboard IN (0,1))
);

CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  subject      TEXT NOT NULL CHECK (subject IN ('physics','cs','both')),
  description  TEXT NOT NULL DEFAULT '',
  venue        TEXT,
  starts_at    INTEGER NOT NULL,
  ends_at      INTEGER NOT NULL,
  capacity     INTEGER CHECK (capacity IS NULL OR capacity > 0),
  CHECK (ends_at > starts_at)
);

CREATE TABLE checkins (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method    TEXT NOT NULL CHECK (method IN ('qr','pass','nfc','manual')),
  at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (event_id, user_id)
);
CREATE INDEX checkins_user_idx ON checkins(user_id);

CREATE TABLE competitions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  is_team   INTEGER NOT NULL DEFAULT 0 CHECK (is_team IN (0,1))
);

CREATE TABLE competition_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id  INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_name       TEXT,
  status          TEXT NOT NULL DEFAULT 'registered'
                  CHECK (status IN ('registered','competing','advanced','eliminated','finished')),
  score           INTEGER,
  rank            INTEGER,
  notes           TEXT,
  UNIQUE (competition_id, user_id)
);

CREATE TABLE exhibits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  subject    TEXT NOT NULL CHECK (subject IN ('physics','cs','both')),
  summary    TEXT NOT NULL DEFAULT '',
  body_md    TEXT NOT NULL DEFAULT '',
  image_url  TEXT
);

CREATE TABLE exhibit_visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exhibit_id  INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at          INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (exhibit_id, user_id)
);

-- Students credited for an exhibit/project (they receive the "Most Creative" prize).
CREATE TABLE exhibit_owners (
  exhibit_id  INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (exhibit_id, user_id)
);

-- Peer votes: one vote per voter per category (changing your vote replaces it).
CREATE TABLE votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  exhibit_id  INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  voter_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (category, voter_id)
);

CREATE TABLE judge_scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  exhibit_id  INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  judge_id    INTEGER NOT NULL REFERENCES users(id),
  score       INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  UNIQUE (category, exhibit_id, judge_id)
);

CREATE TABLE awards (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  key     TEXT NOT NULL UNIQUE,
  title   TEXT NOT NULL,
  config  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config))
);

CREATE TABLE award_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  award_id   INTEGER NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank       INTEGER NOT NULL,
  metrics    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics)),
  published  INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1))
);

CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id  INTEGER REFERENCES users(id),
  action    TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
  at        INTEGER NOT NULL DEFAULT (unixepoch())
);
