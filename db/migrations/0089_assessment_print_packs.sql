CREATE TABLE assessment_print_packs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  state text NOT NULL,
  workflow_execution_id uuid,
  candidate jsonb,
  failure_code text,
  confirmed_by uuid,
  confirmed_at timestamptz,
  manifest text,
  manifest_sha256 text,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, operation_id),
  UNIQUE (tenant_id, id),
  CONSTRAINT assessment_print_packs_state_check CHECK (state IN ('preparing','queued','building','preview-ready','confirmed','failed')),
  CONSTRAINT assessment_print_packs_complete_check CHECK ((state IN ('preview-ready','confirmed') AND candidate IS NOT NULL) OR (state NOT IN ('preview-ready','confirmed') AND candidate IS NULL)),
  CONSTRAINT assessment_print_packs_confirmed_check CHECK ((state = 'confirmed' AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND manifest IS NOT NULL AND manifest_sha256 IS NOT NULL) OR (state <> 'confirmed' AND confirmed_at IS NULL AND confirmed_by IS NULL AND manifest IS NULL AND manifest_sha256 IS NULL))
);
CREATE INDEX assessment_print_packs_assessment_idx ON assessment_print_packs(tenant_id, assessment_id, created_at);
ALTER TABLE workflow_dispatches DROP CONSTRAINT workflow_dispatches_kind_check;
ALTER TABLE workflow_dispatches ADD CONSTRAINT workflow_dispatches_kind_check CHECK (kind IN ('source_migration','ai_generation','release_build','migration_commit','bank_enrichment','question_organization','assessment_print'));
