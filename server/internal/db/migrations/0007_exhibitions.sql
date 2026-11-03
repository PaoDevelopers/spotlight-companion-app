-- An exhibition is a named group of installations ("Physics Exhibition", "Chemistry Exhibition") with its own subject,
-- introduction and cover picture. An exhibit may belong to one exhibition, or stand alone. Deleting an exhibition keeps
-- its exhibits (they become standalone).
CREATE TABLE exhibitions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  subject    TEXT NOT NULL CHECK (subject IN ('physics','chemistry','cs','both')),
  summary    TEXT NOT NULL DEFAULT '',
  body_md    TEXT NOT NULL DEFAULT '',
  image_url  TEXT
);
ALTER TABLE exhibits ADD COLUMN exhibition_id INTEGER REFERENCES exhibitions(id) ON DELETE SET NULL;
CREATE INDEX exhibits_exhibition_idx ON exhibits(exhibition_id);
