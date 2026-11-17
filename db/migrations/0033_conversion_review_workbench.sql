-- Intentional pre-production cutover: prior migration_sources / AI job rows cannot satisfy the
-- durable conversion artifact + hash-bound review contract. Environments with retained conversion
-- history must rebuild those runs after this migration.
TRUNCATE TABLE ai_generation_jobs, migration_sources, migration_items, migration_assets, migration_runs;

DROP TABLE migration_sources;

ALTER TABLE migration_runs
  ADD COLUMN purpose text NOT NULL DEFAULT 'recover_existing';

ALTER TABLE migration_runs
  ALTER COLUMN purpose DROP DEFAULT,
  ALTER COLUMN source_size DROP DEFAULT,
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN parts DROP DEFAULT,
  ALTER COLUMN summary DROP DEFAULT;

ALTER TABLE migration_runs
  ADD CONSTRAINT migration_runs_purpose_check
    CHECK (purpose IN ('recover_existing', 'generate_new')),
  ADD CONSTRAINT migration_runs_status_check
    CHECK (status IN ('queued', 'analyzing', 'analyzed', 'failed', 'committed')),
  ADD CONSTRAINT migration_runs_terminal_state_check
    CHECK (
      (status = 'committed' AND assessment_id IS NOT NULL AND committed_at IS NOT NULL) OR
      (status <> 'committed' AND assessment_id IS NULL AND committed_at IS NULL)
    );

ALTER TABLE migration_items
  RENAME COLUMN status TO readiness;

ALTER TABLE migration_items
  RENAME COLUMN review_state TO decision;

ALTER TABLE migration_items
  ADD COLUMN evidence jsonb NOT NULL,
  ADD COLUMN extraction_uncertainties jsonb NOT NULL,
  ADD COLUMN content_hash text NOT NULL,
  ADD COLUMN context_hash text NOT NULL,
  ADD COLUMN accepted_snapshot jsonb,
  ADD COLUMN accepted_snapshot_hash text;

ALTER TABLE migration_items
  ALTER COLUMN readiness DROP DEFAULT,
  ALTER COLUMN decision DROP DEFAULT,
  ALTER COLUMN warnings DROP DEFAULT,
  ALTER COLUMN imported_draft DROP DEFAULT,
  ADD CONSTRAINT migration_items_readiness_check
    CHECK (readiness IN ('ready', 'minor_review', 'major_review', 'blocked')),
  ADD CONSTRAINT migration_items_decision_check
    CHECK (decision IN ('pending', 'accepted', 'rejected')),
  ADD CONSTRAINT migration_items_content_hash_check
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT migration_items_context_hash_check
    CHECK (context_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT migration_items_accepted_snapshot_hash_check
    CHECK (
      accepted_snapshot_hash IS NULL OR
      accepted_snapshot_hash ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT migration_items_review_state_check
    CHECK (
      (
        decision = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND
        accepted_snapshot IS NULL AND accepted_snapshot_hash IS NULL
      ) OR (
        decision = 'accepted' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND
        accepted_snapshot IS NOT NULL AND accepted_snapshot_hash IS NOT NULL
      ) OR (
        decision = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND
        accepted_snapshot IS NULL AND accepted_snapshot_hash IS NULL
      )
    ),
  ADD CONSTRAINT migration_items_created_question_check
    CHECK (
      (created_question_id IS NULL AND created_revision IS NULL) OR
      (created_question_id IS NOT NULL AND created_revision IS NOT NULL)
    );

CREATE TABLE conversion_source_artifacts (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  document jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (run_id, kind),
  CONSTRAINT conversion_source_artifacts_kind_document_check
    CHECK (
      (kind = 'original' AND document IS NULL) OR
      (kind = 'normalized' AND document IS NOT NULL)
    )
);

CREATE INDEX conversion_source_artifacts_run_idx
  ON conversion_source_artifacts (run_id);

ALTER TABLE migration_assets
  ALTER COLUMN size DROP DEFAULT;

ALTER TABLE ai_generation_jobs
  DROP CONSTRAINT IF EXISTS ai_generation_jobs_assessment_id_fkey;

ALTER TABLE ai_generation_jobs
  RENAME COLUMN assessment_id TO conversion_run_id;

ALTER TABLE ai_generation_jobs
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN progress DROP DEFAULT,
  ALTER COLUMN input DROP DEFAULT,
  ALTER COLUMN attempts DROP DEFAULT,
  ALTER COLUMN max_attempts DROP DEFAULT,
  ADD COLUMN lease_token uuid,
  ADD CONSTRAINT ai_generation_jobs_conversion_run_id_fkey
    FOREIGN KEY (conversion_run_id) REFERENCES migration_runs(id) ON DELETE CASCADE,
  ADD CONSTRAINT ai_generation_jobs_lease_state_check
    CHECK (
      (
        status = 'queued' AND lease_token IS NULL AND
        started_at IS NULL AND completed_at IS NULL
      ) OR (
        status = 'running' AND lease_token IS NOT NULL AND
        started_at IS NOT NULL AND completed_at IS NULL
      ) OR (
        status IN ('completed', 'failed') AND lease_token IS NULL AND completed_at IS NOT NULL
      )
    );

DROP INDEX IF EXISTS ai_generation_jobs_tenant_assessment_idx;

CREATE INDEX ai_generation_jobs_tenant_conversion_idx
  ON ai_generation_jobs (tenant_id, conversion_run_id, created_at DESC);

CREATE UNIQUE INDEX ai_generation_jobs_one_active_run_idx
  ON ai_generation_jobs (conversion_run_id)
  WHERE status IN ('queued', 'running');
