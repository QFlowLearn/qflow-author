ALTER TABLE password_reset_email_deliveries
  ADD COLUMN interface_locale text;

UPDATE password_reset_email_deliveries d
SET interface_locale = s.settings->>'interfaceLocale'
FROM user_settings s
WHERE s.user_id = d.user_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM password_reset_email_deliveries
    WHERE interface_locale IS NULL
      OR interface_locale NOT IN ('en-US','en-GB','es-ES','es-419')
  ) THEN
    RAISE EXCEPTION 'Invalid or missing password-reset delivery interface locale';
  END IF;
END $$;

ALTER TABLE password_reset_email_deliveries
  ALTER COLUMN interface_locale SET NOT NULL;

ALTER TABLE password_reset_email_deliveries
  ADD CONSTRAINT password_reset_email_deliveries_interface_locale_check
  CHECK (interface_locale IN ('en-US','en-GB','es-ES','es-419'));
