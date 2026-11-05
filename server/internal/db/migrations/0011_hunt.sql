-- Scavenger hunts: stages done in strict order, each completed by a typed code word or by scanning the station's QR code.
-- Photos are optional evidence, private to the student and teachers.
CREATE TABLE hunts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  subject      TEXT NOT NULL DEFAULT 'chemistry' CHECK (subject IN ('physics','chemistry','cs','both')),
  description  TEXT NOT NULL DEFAULT '',
  image_url    TEXT,
  published    INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1))
);
CREATE TABLE hunt_stages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  hunt_id   INTEGER NOT NULL REFERENCES hunts(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  title     TEXT NOT NULL,
  clue      TEXT NOT NULL DEFAULT '',
  answers   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(answers)),
  UNIQUE (hunt_id, position)
);
CREATE TABLE hunt_progress (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id  INTEGER NOT NULL REFERENCES hunt_stages(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at        INTEGER NOT NULL,
  method    TEXT NOT NULL CHECK (method IN ('code','qr','teacher')),
  UNIQUE (stage_id, user_id)
);
CREATE INDEX hunt_progress_user_idx ON hunt_progress(user_id);
CREATE TABLE hunt_photos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id  INTEGER NOT NULL REFERENCES hunt_stages(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_id  INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  caption   TEXT NOT NULL DEFAULT '',
  at        INTEGER NOT NULL
);
CREATE INDEX hunt_photos_stage_idx ON hunt_photos(stage_id, user_id);
