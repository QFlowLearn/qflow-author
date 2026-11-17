-- Intentional pre-production cutover: migration runs now belong to an idempotent batch and use
-- lease-guarded worker ownership. Existing development rows cannot satisfy that contract.
TRUNCATE TABLE ai_generation_jobs, conversion_source_artifacts, migration_items, migration_assets,
  migration_runs;

CREATE TABLE migration_batches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_by_snapshot jsonb NOT NULL,
  purpose text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  source_count integer NOT NULL,
  assigned_reviewer_id uuid,
  assigned_by uuid,
  assigned_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT migration_batches_purpose_check
    CHECK (purpose IN ('recover_existing', 'generate_new')),
  CONSTRAINT migration_batches_request_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_batches_source_count_check
    CHECK (source_count BETWEEN 1 AND 10),
  CONSTRAINT migration_batches_reviewer_assignment_check
    CHECK (
      (
        assigned_reviewer_id IS NULL AND
        assigned_by IS NULL AND
        assigned_at IS NULL
      ) OR (
        assigned_reviewer_id IS NOT NULL AND
        assigned_by IS NOT NULL AND
        assigned_at IS NOT NULL
    )
  )
);

CREATE INDEX migration_batches_tenant_created_idx
  ON migration_batches (tenant_id, created_at DESC);

CREATE UNIQUE INDEX migration_batches_tenant_idempotency_idx
  ON migration_batches (tenant_id, idempotency_key);

CREATE UNIQUE INDEX migration_batches_id_tenant_idx
  ON migration_batches (id, tenant_id);

ALTER TABLE migration_runs
  DROP CONSTRAINT IF EXISTS migration_runs_status_check,
  DROP CONSTRAINT IF EXISTS migration_runs_purpose_check,
  DROP CONSTRAINT IF EXISTS migration_runs_terminal_state_check,
  DROP COLUMN created_by,
  DROP COLUMN purpose,
  ADD COLUMN batch_id uuid NOT NULL,
  ADD COLUMN batch_position integer NOT NULL,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN lease_token uuid,
  ADD COLUMN last_error text,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN approval_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN submitted_by uuid,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN decided_by uuid,
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN approval_note text;

ALTER TABLE migration_runs
  ALTER COLUMN adapter_id SET NOT NULL,
  ALTER COLUMN adapter_label SET NOT NULL,
  ALTER COLUMN adapter_version SET NOT NULL,
  ALTER COLUMN attempts DROP DEFAULT,
  ALTER COLUMN max_attempts DROP DEFAULT,
  ALTER COLUMN approval_status DROP DEFAULT,
  ADD CONSTRAINT migration_runs_batch_tenant_fk
    FOREIGN KEY (batch_id, tenant_id)
    REFERENCES migration_batches(id, tenant_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT migration_runs_status_check
    CHECK (status IN ('queued', 'analyzing', 'analyzed', 'failed', 'committed')),
  ADD CONSTRAINT migration_runs_attempts_check
    CHECK (attempts >= 0 AND max_attempts >= 1 AND attempts <= max_attempts),
  ADD CONSTRAINT migration_runs_lease_state_check
    CHECK (
      (
        status = 'queued' AND
        lease_token IS NULL AND
        started_at IS NULL AND
        completed_at IS NULL
      ) OR (
        status = 'analyzing' AND
        lease_token IS NOT NULL AND
        last_error IS NULL AND
        started_at IS NOT NULL AND
        completed_at IS NULL
      ) OR (
        status IN ('analyzed', 'committed') AND
        lease_token IS NULL AND
        last_error IS NULL AND
        started_at IS NULL AND
        completed_at IS NOT NULL
      ) OR (
        status = 'failed' AND
        lease_token IS NULL AND
        last_error IS NOT NULL AND
        started_at IS NULL AND
        completed_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT migration_runs_approval_status_check
    CHECK (approval_status IN ('draft', 'submitted', 'approved', 'changes_requested')),
  ADD CONSTRAINT migration_runs_approval_state_check
    CHECK (
      (
        approval_status = 'draft' AND
        submitted_by IS NULL AND
        submitted_at IS NULL AND
        decided_by IS NULL AND
        decided_at IS NULL AND
        approval_note IS NULL
      ) OR (
        approval_status = 'submitted' AND
        submitted_by IS NOT NULL AND
        submitted_at IS NOT NULL AND
        decided_by IS NULL AND
        decided_at IS NULL AND
        approval_note IS NULL
      ) OR (
        approval_status = 'approved' AND
        submitted_by IS NOT NULL AND
        submitted_at IS NOT NULL AND
        decided_by IS NOT NULL AND
        decided_at IS NOT NULL
      ) OR (
        approval_status = 'changes_requested' AND
        submitted_by IS NOT NULL AND
        submitted_at IS NOT NULL AND
        decided_by IS NOT NULL AND
        decided_at IS NOT NULL AND
        approval_note IS NOT NULL
      )
    ),
  ADD CONSTRAINT migration_runs_workflow_state_check
    CHECK (
      (
        status IN ('queued', 'analyzing', 'failed') AND
        approval_status = 'draft'
      ) OR
      status = 'analyzed' OR
      (
        status = 'committed' AND
        approval_status IN ('draft', 'approved')
      )
    ),
  ADD CONSTRAINT migration_runs_terminal_state_check
    CHECK (
      (
        status = 'committed' AND
        assessment_id IS NOT NULL AND
        committed_at IS NOT NULL
      ) OR (
        status <> 'committed' AND
        assessment_id IS NULL AND
        committed_at IS NULL
      )
    );

CREATE INDEX migration_runs_claim_idx
  ON migration_runs (status, created_at)
  WHERE status = 'queued';

CREATE UNIQUE INDEX migration_runs_batch_position_idx
  ON migration_runs (batch_id, batch_position);
