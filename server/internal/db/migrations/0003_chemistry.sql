-- migrate:no-fk
-- Adds the 'chemistry' subject. SQLite can't edit a CHECK, so events and exhibits are rebuilt (see noFKMarker in db.go).
CREATE TABLE events_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  subject        TEXT NOT NULL CHECK (subject IN ('physics','chemistry','cs','both')),
  description    TEXT NOT NULL DEFAULT '',
  venue          TEXT,
  starts_at      INTEGER NOT NULL,
  ends_at        INTEGER NOT NULL,
  capacity       INTEGER CHECK (capacity IS NULL OR capacity > 0),
  image_url      TEXT,
  host           TEXT,
  signup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (signup_enabled IN (0,1)),
  CHECK (ends_at > starts_at)
);
INSERT INTO events_new (id, title, subject, description, venue, starts_at, ends_at, capacity, image_url, host, signup_enabled)
  SELECT id, title, subject, description, venue, starts_at, ends_at, capacity, image_url, host, signup_enabled FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

CREATE TABLE exhibits_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  subject    TEXT NOT NULL CHECK (subject IN ('physics','chemistry','cs','both')),
  summary    TEXT NOT NULL DEFAULT '',
  body_md    TEXT NOT NULL DEFAULT '',
  image_url  TEXT
);
INSERT INTO exhibits_new (id, slug, title, subject, summary, body_md, image_url)
  SELECT id, slug, title, subject, summary, body_md, image_url FROM exhibits;
DROP TABLE exhibits;
ALTER TABLE exhibits_new RENAME TO exhibits;
