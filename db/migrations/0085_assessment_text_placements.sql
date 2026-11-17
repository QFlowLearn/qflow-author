ALTER TABLE assessment_placements
  ALTER COLUMN question_id DROP NOT NULL,
  ADD COLUMN content jsonb,
  ADD CONSTRAINT assessment_placements_content_owner_check CHECK ((
    (question_id IS NOT NULL AND content IS NULL)
    OR (
      question_id IS NULL AND content IS NOT NULL
      AND pinned_revision IS NULL AND blueprint_target_id IS NULL AND fixed = true
      AND jsonb_typeof(content) = 'object'
      AND content ? 'kind' AND content ? 'text'
      AND content->>'kind' = 'text'
      AND jsonb_typeof(content->'text') = 'string'
      AND length(content->>'text') BETWEEN 1 AND 100000
      AND length(btrim(content->>'text', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
      AND content->>'text' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
      AND content - 'kind' - 'text' = '{}'::jsonb
    )
  ) IS TRUE);
