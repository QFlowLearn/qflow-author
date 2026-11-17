ALTER TABLE question_organization_setups ADD CONSTRAINT organization_setup_collection_identity UNIQUE (id, tenant_id, collection_id);
CREATE TABLE question_organization_activation (
  collection_id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  setup_id uuid, revision integer NOT NULL CHECK (revision > 0),
  operation_id uuid NOT NULL, changed_by uuid NOT NULL, changed_at timestamptz NOT NULL,
  FOREIGN KEY (collection_id, tenant_id) REFERENCES bank_collections(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (setup_id, tenant_id, collection_id) REFERENCES question_organization_setups(id, tenant_id, collection_id)
);
ALTER TABLE question_organization_runs ADD COLUMN mode text NOT NULL DEFAULT 'apply' CHECK (mode IN ('preview','apply'));
ALTER TABLE question_organization_runs ALTER COLUMN mode DROP DEFAULT;
ALTER TABLE question_organization_items DROP CONSTRAINT question_organization_items_state_check;
ALTER TABLE question_organization_items ADD CONSTRAINT question_organization_items_state_check CHECK (state IN ('pending','processing','received','previewed','applied','protected','outdated','unassigned','unsupported','failed','cancelled'));
CREATE FUNCTION guard_organization_run_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode IS DISTINCT FROM OLD.mode THEN RAISE EXCEPTION 'Organization run mode is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_run_mode BEFORE UPDATE ON question_organization_runs
  FOR EACH ROW EXECUTE FUNCTION guard_organization_run_mode();
