CREATE TABLE IF NOT EXISTS ai_generation_jobs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CHECK (progress >= 0 AND progress <= 100),
  CHECK (attempts >= 0),
  CHECK (max_attempts >= 1)
);

CREATE INDEX IF NOT EXISTS ai_generation_jobs_status_created_idx
  ON ai_generation_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS ai_generation_jobs_tenant_assessment_idx
  ON ai_generation_jobs (tenant_id, assessment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_generation_jobs_user_idx
  ON ai_generation_jobs (user_id, created_at DESC);
