-- The Spotlight Month reading list: books with an introduction, a public "read" count and comments.
CREATE TABLE books (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT '',
  subject    TEXT NOT NULL DEFAULT 'both' CHECK (subject IN ('physics','chemistry','cs','both')),
  summary    TEXT NOT NULL DEFAULT '',
  body_md    TEXT NOT NULL DEFAULT '',
  image_url  TEXT
);
CREATE TABLE book_reads (
  book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at       INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (book_id, user_id)
);
CREATE TABLE book_comments (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body     TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX book_comments_book_idx ON book_comments(book_id, at);
CREATE INDEX book_comments_user_idx ON book_comments(user_id, at);
