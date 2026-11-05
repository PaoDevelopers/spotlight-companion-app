-- Students share pictures of what they made at an event (paintings, a disassembled computer...). Visible to signed-in students;
-- teachers can remove any.
CREATE TABLE event_works (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_id  INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  caption   TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 200),
  at        INTEGER NOT NULL
);
CREATE INDEX event_works_event_idx ON event_works(event_id, at);
