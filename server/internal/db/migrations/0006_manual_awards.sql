-- Awards are chosen by teachers, not computed. This drops the machinery that computed them (peer votes, judge scores,
-- computed award results, the "creators" list that fed "Most Creative") and adds the teacher-chosen awards.
DROP TABLE award_results;
DROP TABLE awards;
DROP TABLE votes;
DROP TABLE judge_scores;
DROP TABLE exhibit_owners;

-- One row per student who receives an award. Drafts are visible to teachers only; publishing shows them to students.
CREATE TABLE student_awards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL DEFAULT '',
  published     INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  published_at  INTEGER,
  UNIQUE (title, user_id)
);
CREATE INDEX student_awards_user_idx ON student_awards(user_id);
