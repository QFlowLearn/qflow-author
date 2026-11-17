CREATE TABLE question_organization_setups (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, collection_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0), version_id uuid NOT NULL,
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id), UNIQUE (collection_id, version),
  FOREIGN KEY (collection_id, tenant_id) REFERENCES bank_collections(id, tenant_id),
  FOREIGN KEY (version_id, tenant_id) REFERENCES bank_enrichment_scheme_versions(id, tenant_id)
);
CREATE TRIGGER organization_setup_immutable BEFORE UPDATE ON question_organization_setups
  FOR EACH ROW EXECUTE FUNCTION reject_enrichment_record_update();
CREATE TABLE question_organization_origins (
  tenant_id uuid NOT NULL, question_id uuid PRIMARY KEY, collection_id uuid NOT NULL, source jsonb,
  FOREIGN KEY (question_id, tenant_id) REFERENCES questions(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id, tenant_id) REFERENCES bank_collections(id, tenant_id) ON DELETE CASCADE
);
CREATE TRIGGER organization_origin_immutable BEFORE UPDATE ON question_organization_origins
  FOR EACH ROW EXECUTE FUNCTION reject_enrichment_record_update();
CREATE TABLE question_organization_runs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, setup_id uuid NOT NULL, execution_id uuid NOT NULL,
  created_by uuid NOT NULL, state text NOT NULL CHECK (state IN ('queued','completed','failed','cancelled','undone')),
  reserved_micros integer NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0), created_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (setup_id, tenant_id) REFERENCES question_organization_setups(id, tenant_id)
);
CREATE TABLE question_organization_items (
  tenant_id uuid NOT NULL, run_id uuid NOT NULL, question_id uuid NOT NULL, revision_id uuid NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  baseline jsonb NOT NULL CHECK (jsonb_typeof(baseline) = 'object'), source jsonb,
  state text NOT NULL CHECK (state IN ('pending','processing','received','applied','protected','outdated','unassigned','unsupported','failed','cancelled')),
  decision jsonb, attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_token uuid, lease_expires_at timestamptz, detail text,
  PRIMARY KEY (run_id, question_id),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  FOREIGN KEY (run_id, tenant_id) REFERENCES question_organization_runs(id, tenant_id),
  FOREIGN KEY (revision_id, question_id, tenant_id) REFERENCES question_revisions(id, question_id, tenant_id)
);
CREATE INDEX organization_item_pending ON question_organization_items(run_id, state, question_id);
CREATE FUNCTION guard_organization_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'question_organization_runs' THEN
    IF (NEW.id,NEW.tenant_id,NEW.setup_id,NEW.execution_id,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.setup_id,OLD.execution_id,OLD.created_by,OLD.created_at)
    THEN RAISE EXCEPTION 'Organization run inputs are immutable'; END IF;
  ELSE
    IF (NEW.run_id,NEW.tenant_id,NEW.question_id,NEW.revision_id,NEW.content_hash,NEW.baseline,NEW.source)
      IS DISTINCT FROM (OLD.run_id,OLD.tenant_id,OLD.question_id,OLD.revision_id,OLD.content_hash,OLD.baseline,OLD.source)
    THEN RAISE EXCEPTION 'Organization item inputs are immutable'; END IF;
    IF OLD.decision IS NOT NULL AND NEW.decision IS DISTINCT FROM OLD.decision
    THEN RAISE EXCEPTION 'Organization receipts are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_run_inputs BEFORE UPDATE ON question_organization_runs
  FOR EACH ROW EXECUTE FUNCTION guard_organization_inputs();
CREATE TRIGGER organization_item_inputs BEFORE UPDATE ON question_organization_items
  FOR EACH ROW EXECUTE FUNCTION guard_organization_inputs();
CREATE TABLE question_organization_memberships (
  tenant_id uuid NOT NULL, collection_id uuid NOT NULL, question_id uuid NOT NULL,
  change_id uuid NOT NULL, origin text NOT NULL CHECK (origin IN ('human','organization','undo')),
  state text NOT NULL CHECK (state IN ('present','removed')),
  PRIMARY KEY (collection_id, question_id),
  FOREIGN KEY (question_id, tenant_id) REFERENCES questions(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id, tenant_id) REFERENCES bank_collections(id, tenant_id) ON DELETE CASCADE
);
ALTER TABLE bank_enrichment_changes DROP CONSTRAINT bank_enrichment_changes_origin_check;
ALTER TABLE bank_enrichment_changes ADD CONSTRAINT enrichment_change_origin CHECK (origin IN ('ai','human','undo','source'));
ALTER TABLE workflow_dispatches DROP CONSTRAINT workflow_dispatches_kind_check;
ALTER TABLE workflow_dispatches ADD CONSTRAINT workflow_dispatches_kind_check
  CHECK (kind IN ('source_migration','ai_generation','release_build','migration_commit','bank_enrichment','question_organization'));
CREATE TABLE question_organization_attempts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, run_id uuid NOT NULL, question_id uuid NOT NULL,
  reserved_micros integer NOT NULL CHECK (reserved_micros > 0), charged_micros integer,
  state text NOT NULL CHECK (state IN ('reserved','received','uncertain','skipped')), code text,
  created_at timestamptz NOT NULL,
  CHECK (charged_micros IS NULL OR charged_micros BETWEEN 0 AND reserved_micros),
  FOREIGN KEY (run_id, question_id) REFERENCES question_organization_items(run_id, question_id),
  FOREIGN KEY (run_id, tenant_id) REFERENCES question_organization_runs(id, tenant_id)
);
