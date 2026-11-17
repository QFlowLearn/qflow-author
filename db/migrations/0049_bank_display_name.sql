ALTER TABLE tenants ADD COLUMN bank_display_name text;
ALTER TABLE tenants ADD CONSTRAINT tenants_bank_display_name_check
  CHECK (bank_display_name IS NULL OR (bank_display_name = btrim(bank_display_name) AND char_length(bank_display_name) BETWEEN 1 AND 160));
