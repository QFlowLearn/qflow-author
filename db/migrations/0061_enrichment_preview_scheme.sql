CREATE UNIQUE INDEX enrichment_version_tenant_idx ON bank_enrichment_scheme_versions(id, tenant_id);
ALTER TABLE bank_enrichment_previews ADD COLUMN base_version_id uuid;
ALTER TABLE bank_enrichment_previews ADD CONSTRAINT enrichment_preview_base_version_fk
  FOREIGN KEY (base_version_id, tenant_id) REFERENCES bank_enrichment_scheme_versions(id, tenant_id);
CREATE OR REPLACE FUNCTION guard_enrichment_preview_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.seed IS DISTINCT FROM OLD.seed OR NEW.audience IS DISTINCT FROM OLD.audience
    OR NEW.definition IS DISTINCT FROM OLD.definition OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.base_version_id IS DISTINCT FROM OLD.base_version_id
    OR (OLD.sample IS NOT NULL AND NEW.sample IS DISTINCT FROM OLD.sample)
    OR (OLD.proposal IS NOT NULL AND NEW.proposal IS DISTINCT FROM OLD.proposal)
    OR (OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result) THEN
    RAISE EXCEPTION 'Enrichment preview input is immutable';
  END IF;
  RETURN NEW;
END $$;
