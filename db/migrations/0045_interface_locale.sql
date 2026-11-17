-- Make interface locale a complete, authoritative user preference.
UPDATE user_settings
SET settings = settings || '{"interfaceLocale":"en-US"}'::jsonb
WHERE NOT (settings ? 'interfaceLocale');

INSERT INTO user_settings (user_id, settings)
SELECT u.id, '{"theme":"system","choiceRichText":false,"interfaceLocale":"en-US"}'::jsonb
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id = u.id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE s.user_id IS NULL OR s.settings->>'interfaceLocale' NOT IN ('en-US','en-GB','es-ES','es-419')
  ) THEN RAISE EXCEPTION 'Invalid or missing interface locale'; END IF;
END $$;
