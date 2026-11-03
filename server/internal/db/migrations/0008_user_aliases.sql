-- Other addresses that belong to the same person. A student may be loaded from the school's list as s12345@stu...
-- and then sign in with Microsoft under another address (their mail alias). Both addresses must lead to ONE account, with
-- its check-ins, sign-ups and results, so the second address is remembered here.
CREATE TABLE user_aliases (
  email    TEXT PRIMARY KEY,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX user_aliases_user_idx ON user_aliases(user_id);
