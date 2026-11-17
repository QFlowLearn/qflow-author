ALTER TABLE bank_releases ADD COLUMN replacement_id uuid;
ALTER TABLE bank_releases ADD CONSTRAINT bank_release_replacement_workspace
  FOREIGN KEY (replacement_id, tenant_id) REFERENCES bank_releases(id, tenant_id);
ALTER TABLE bank_releases ADD CONSTRAINT bank_release_replacement_not_self
  CHECK (replacement_id IS NULL OR replacement_id <> id);
