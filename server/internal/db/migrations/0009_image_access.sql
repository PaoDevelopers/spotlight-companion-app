-- Who may see a picture. 'content' is what teachers put into pages (any signed-in user may see it). 'work' is a student's
-- shared work on an event (any signed-in user). 'hunt' is evidence for a scavenger hunt: only its owner and teachers.
ALTER TABLE images ADD COLUMN kind TEXT NOT NULL DEFAULT 'content' CHECK (kind IN ('content','work','hunt'));
CREATE INDEX images_owner_idx ON images(uploaded_by, kind, at);
