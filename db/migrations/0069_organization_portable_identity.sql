ALTER TABLE bank_enrichment_schemes ADD COLUMN portable_id uuid;
UPDATE bank_enrichment_schemes SET portable_id = id;
ALTER TABLE bank_enrichment_schemes ALTER COLUMN portable_id SET NOT NULL;
ALTER TABLE bank_enrichment_schemes ALTER COLUMN portable_id SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX enrichment_scheme_portable_tenant_idx ON bank_enrichment_schemes (tenant_id, portable_id);

ALTER TABLE bank_enrichment_scheme_versions ADD COLUMN portable_id uuid;
ALTER TABLE bank_enrichment_scheme_versions DISABLE TRIGGER enrichment_version_immutable;
UPDATE bank_enrichment_scheme_versions SET portable_id = id;
ALTER TABLE bank_enrichment_scheme_versions ENABLE TRIGGER enrichment_version_immutable;
ALTER TABLE bank_enrichment_scheme_versions ALTER COLUMN portable_id SET NOT NULL;
ALTER TABLE bank_enrichment_scheme_versions ALTER COLUMN portable_id SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX enrichment_version_portable_tenant_idx ON bank_enrichment_scheme_versions (tenant_id, portable_id);

CREATE TRIGGER enrichment_scheme_immutable BEFORE UPDATE ON bank_enrichment_schemes
  FOR EACH ROW EXECUTE FUNCTION reject_enrichment_record_update();
