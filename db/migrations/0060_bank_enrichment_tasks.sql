ALTER TABLE bank_enrichment_runs ADD COLUMN workflow_execution_id uuid;
ALTER TABLE bank_enrichment_batches ADD COLUMN attempt_id uuid;
ALTER TABLE bank_enrichment_batches ADD COLUMN error_code text;
ALTER TABLE bank_enrichment_batches ADD COLUMN retries_remaining integer NOT NULL DEFAULT 3 CHECK (retries_remaining BETWEEN 0 AND 3);
CREATE TABLE bank_enrichment_tasks (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('preview', 'classify')),
  UNIQUE(id, tenant_id), FOREIGN KEY (id, tenant_id) REFERENCES bank_enrichment_budgets(id, tenant_id)
);
CREATE TABLE bank_enrichment_previews (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, seed uuid NOT NULL,
  audience text NOT NULL CHECK (length(btrim(audience)) BETWEEN 1 AND 1000), definition jsonb,
  state text NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  phase text NOT NULL CHECK (phase IN ('propose', 'measure')), proposal jsonb,
  attempt_id uuid, attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retries_remaining integer NOT NULL DEFAULT 3 CHECK (retries_remaining BETWEEN 0 AND 3),
  sample jsonb, result jsonb, error_code text,
  workflow_execution_id uuid NOT NULL, lease_token uuid, lease_expires_at timestamptz,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  CHECK ((state = 'running') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  FOREIGN KEY (id, tenant_id) REFERENCES bank_enrichment_tasks(id, tenant_id)
);
CREATE FUNCTION guard_enrichment_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Enrichment task identity is immutable'; END $$;
CREATE TRIGGER enrichment_task_immutable BEFORE UPDATE ON bank_enrichment_tasks FOR EACH ROW EXECUTE FUNCTION guard_enrichment_task();
CREATE FUNCTION guard_enrichment_preview_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.seed IS DISTINCT FROM OLD.seed OR NEW.audience IS DISTINCT FROM OLD.audience
    OR NEW.definition IS DISTINCT FROM OLD.definition OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.sample IS NOT NULL AND NEW.sample IS DISTINCT FROM OLD.sample)
    OR (OLD.proposal IS NOT NULL AND NEW.proposal IS DISTINCT FROM OLD.proposal)
    OR (OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result) THEN
    RAISE EXCEPTION 'Enrichment preview input is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrichment_preview_input_immutable BEFORE UPDATE ON bank_enrichment_previews FOR EACH ROW EXECUTE FUNCTION guard_enrichment_preview_input();
CREATE FUNCTION guard_enrichment_batch_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.scheme_id IS DISTINCT FROM OLD.scheme_id OR NEW.sequence IS DISTINCT FROM OLD.sequence
    OR NEW.question_ids IS DISTINCT FROM OLD.question_ids OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.response IS NOT NULL AND (NEW.response IS DISTINCT FROM OLD.response
      OR NEW.input_tokens IS DISTINCT FROM OLD.input_tokens OR NEW.output_tokens IS DISTINCT FROM OLD.output_tokens)) THEN
    RAISE EXCEPTION 'Enrichment batch input and receipt are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrichment_batch_input_immutable BEFORE UPDATE ON bank_enrichment_batches FOR EACH ROW EXECUTE FUNCTION guard_enrichment_batch_input();
ALTER TABLE workflow_dispatches DROP CONSTRAINT workflow_dispatches_kind_check;
ALTER TABLE workflow_dispatches ADD CONSTRAINT workflow_dispatches_kind_check
  CHECK (kind IN ('source_migration', 'ai_generation', 'release_build', 'migration_commit', 'bank_enrichment'));
