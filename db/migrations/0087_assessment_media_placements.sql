ALTER TABLE assessment_placements
  DROP CONSTRAINT assessment_placements_content_owner_check,
  ADD CONSTRAINT assessment_placements_content_owner_check CHECK (
((question_id IS NOT NULL AND content IS NULL)
  OR (
    question_id IS NULL AND content IS NOT NULL
    AND pinned_revision IS NULL AND blueprint_target_id IS NULL AND fixed = true
    AND jsonb_typeof(content) = 'object'
    AND (
      (
        content->>'kind' = 'text'
        AND jsonb_typeof(content->'text') = 'string'
        AND length(content->>'text') BETWEEN 1 AND 100000
        AND content->>'text' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'text', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND content - 'kind' - 'text' = '{}'::jsonb
      )
      OR
      (
        content->>'kind' = 'image'
        AND jsonb_typeof(content->'src') = 'string'
        AND length(content->>'src') BETWEEN 1 AND 2048
        AND content->>'src' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'src', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'alt') = 'string'
        AND length(content->>'alt') BETWEEN 1 AND 2000
        AND content->>'alt' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'alt', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'longDescription') = 'string'
        AND length(content->>'longDescription') BETWEEN 0 AND 100000
        AND content->>'longDescription' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND (length(content->>'longDescription') = 0 OR length(btrim(content->>'longDescription', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0)
        AND content->>'src' ~ '/uploads/[0-9a-fA-F-]{36}$'
        AND content - 'kind' - 'src' - 'alt' - 'longDescription' = '{}'::jsonb
      )
      OR
      (
        content->>'kind' = 'video'
        AND jsonb_typeof(content->'src') = 'string'
        AND length(content->>'src') BETWEEN 1 AND 2048
        AND content->>'src' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'src', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'mimeType') = 'string'
        AND length(content->>'mimeType') BETWEEN 1 AND 100
        AND content->>'mimeType' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'mimeType', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'title') = 'string'
        AND length(content->>'title') BETWEEN 1 AND 2000
        AND content->>'title' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'title', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'captionSrc') = 'string'
        AND length(content->>'captionSrc') BETWEEN 1 AND 2048
        AND content->>'captionSrc' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'captionSrc', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'captionLanguage') = 'string'
        AND length(content->>'captionLanguage') BETWEEN 1 AND 100
        AND content->>'captionLanguage' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'captionLanguage', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'transcript') = 'string'
        AND length(content->>'transcript') BETWEEN 1 AND 100000
        AND content->>'transcript' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'transcript', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND content->>'src' ~ '/uploads/[0-9a-fA-F-]{36}$'
        AND content->>'captionSrc' ~ '/uploads/[0-9a-fA-F-]{36}$'
        AND content->>'mimeType' IN ('video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v')
        AND content->>'captionLanguage' ~ '^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$'
        AND content - 'kind' - 'src' - 'mimeType' - 'title' - 'captionSrc' - 'captionLanguage' - 'transcript' = '{}'::jsonb
      )
      OR
      (
        content->>'kind' = 'video-link'
        AND jsonb_typeof(content->'url') = 'string'
        AND length(content->>'url') BETWEEN 1 AND 2048
        AND content->>'url' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'url', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'title') = 'string'
        AND length(content->>'title') BETWEEN 1 AND 2000
        AND content->>'title' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'title', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'transcript') = 'string'
        AND length(content->>'transcript') BETWEEN 1 AND 100000
        AND content->>'transcript' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'transcript', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND jsonb_typeof(content->'networkNotice') = 'string'
        AND length(content->>'networkNotice') BETWEEN 1 AND 2000
        AND content->>'networkNotice' !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]'
        AND length(btrim(content->>'networkNotice', E' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) > 0
        AND content->>'url' ~* '^https://((www\.)?(youtube\.com|vimeo\.com)|youtu\.be)/[^[:space:]]*$'
        AND content - 'kind' - 'url' - 'title' - 'transcript' - 'networkNotice' = '{}'::jsonb
      )
    )
  )) IS TRUE
  );
