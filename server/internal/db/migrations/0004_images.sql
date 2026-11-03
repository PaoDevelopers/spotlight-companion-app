-- Pictures that teachers add to event and exhibit descriptions. Kept in the database so the app stays one file and
-- the nightly backup covers them. Only png, jpeg, gif and webp are accepted (never svg, which can carry scripts).
CREATE TABLE images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/gif','image/webp')),
  data          BLOB NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at            INTEGER NOT NULL DEFAULT (unixepoch())
);
