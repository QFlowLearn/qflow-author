-- Optional proof captured during import; unknown and edited content remains unclassified.
ALTER TABLE migration_items ADD COLUMN exact_content_identity text;
ALTER TABLE migration_items ADD CONSTRAINT migration_items_exact_content_identity_check
  CHECK (exact_content_identity IS NULL OR exact_content_identity ~ '^qti-self-contained-v1:[0-9a-f]{64}$');
CREATE INDEX migration_items_run_exact_content_idx ON migration_items (run_id, exact_content_identity);
