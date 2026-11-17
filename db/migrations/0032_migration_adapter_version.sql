ALTER TABLE migration_runs
  ADD COLUMN IF NOT EXISTS adapter_version text;
