ALTER TABLE password_reset_email_deliveries
  DROP CONSTRAINT password_reset_email_deliveries_interface_locale_check;

ALTER TABLE password_reset_email_deliveries
  ADD CONSTRAINT password_reset_email_deliveries_interface_locale_check
  CHECK (interface_locale IN ('en-US','en-GB','es-ES','es-419','sv-SE'));
