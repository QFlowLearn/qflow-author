-- Canonical Draft JSON is persisted in question_revisions.body. Repair the source once so
-- persisted parsing can require itemLanguage with no read-time compatibility path.
UPDATE question_revisions
SET body = jsonb_set(body, '{itemLanguage}', '"en-US"'::jsonb, true)
WHERE NOT (body ? 'itemLanguage');

ALTER TABLE question_revisions
  ADD CONSTRAINT question_revisions_item_language_check
  CHECK (
    jsonb_typeof(body->'itemLanguage') = 'string' AND
    char_length(body->>'itemLanguage') > 0
  );
