CREATE TABLE migration_commit_jobs (
 id uuid PRIMARY KEY REFERENCES migration_runs(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL, user_id uuid NOT NULL, state text NOT NULL,
 total integer NOT NULL, completed integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT migration_commit_jobs_state_check CHECK(state IN ('queued','running','complete','failed')),
 CONSTRAINT migration_commit_jobs_progress_check CHECK(completed >= 0 AND completed <= total AND total > 0)
);
CREATE TABLE migration_commit_selections (
 item_id uuid PRIMARY KEY REFERENCES migration_items(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES migration_commit_jobs(id) ON DELETE CASCADE,
 snapshot_hash text NOT NULL, position integer NOT NULL
);
CREATE INDEX migration_commit_selections_job_idx ON migration_commit_selections(job_id,position);
ALTER TABLE workflow_dispatches DROP CONSTRAINT workflow_dispatches_kind_check;
ALTER TABLE workflow_dispatches ADD CONSTRAINT workflow_dispatches_kind_check
 CHECK(kind IN ('source_migration','ai_generation','release_build','migration_commit'));
