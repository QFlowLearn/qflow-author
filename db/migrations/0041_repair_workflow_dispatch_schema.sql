-- Repair environments where an earlier draft of migration 0039 created the legacy outbox shape.
DO $qflow$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workflow_dispatches'
      AND column_name = 'dispatched_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workflow_dispatches'
      AND column_name = 'state'
  ) THEN
    ALTER TABLE workflow_dispatches
      ADD COLUMN state text,
      ADD COLUMN workflow_status text,
      ADD COLUMN started_at timestamptz,
      ADD COLUMN completed_at timestamptz,
      ADD COLUMN last_checked_at timestamptz;

    UPDATE workflow_dispatches
    SET
      state = CASE WHEN dispatched_at IS NULL THEN 'pending' ELSE 'active' END,
      started_at = dispatched_at;

    ALTER TABLE workflow_dispatches
      ALTER COLUMN state SET NOT NULL,
      DROP COLUMN dispatched_at,
      DROP CONSTRAINT IF EXISTS workflow_dispatches_kind_check,
      DROP CONSTRAINT IF EXISTS workflow_dispatches_state_check,
      DROP CONSTRAINT IF EXISTS workflow_dispatches_workflow_status_check,
      DROP CONSTRAINT IF EXISTS workflow_dispatches_attempts_check,
      DROP CONSTRAINT IF EXISTS workflow_dispatches_lifecycle_check;

    ALTER TABLE workflow_dispatches
      ADD CONSTRAINT workflow_dispatches_kind_check
        CHECK (kind IN ('source_migration', 'ai_generation')),
      ADD CONSTRAINT workflow_dispatches_state_check
        CHECK (state IN ('pending', 'active', 'complete', 'failed')),
      ADD CONSTRAINT workflow_dispatches_workflow_status_check
        CHECK (
          workflow_status IS NULL OR
          workflow_status IN (
            'queued',
            'running',
            'paused',
            'errored',
            'terminated',
            'complete',
            'waiting',
            'waitingForPause',
            'unknown'
          )
        ),
      ADD CONSTRAINT workflow_dispatches_attempts_check CHECK (attempts >= 0),
      ADD CONSTRAINT workflow_dispatches_lifecycle_check
        CHECK (
          (state = 'pending' AND started_at IS NULL AND completed_at IS NULL) OR
          (state = 'active' AND started_at IS NOT NULL AND completed_at IS NULL) OR
          (
            state IN ('complete', 'failed') AND
            started_at IS NOT NULL AND
            completed_at IS NOT NULL
          )
        );

    DROP INDEX IF EXISTS workflow_dispatches_pending_idx;
    DROP INDEX IF EXISTS workflow_dispatches_state_idx;
    DROP INDEX IF EXISTS workflow_dispatches_job_idx;
    DROP INDEX IF EXISTS workflow_dispatches_open_job_idx;

    CREATE INDEX workflow_dispatches_state_idx
      ON workflow_dispatches (state, updated_at);

    CREATE INDEX workflow_dispatches_job_idx
      ON workflow_dispatches (kind, job_id);

    CREATE UNIQUE INDEX workflow_dispatches_open_job_idx
      ON workflow_dispatches (kind, job_id)
      WHERE state IN ('pending', 'active');
  END IF;
END
$qflow$;
