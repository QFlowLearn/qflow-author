ALTER TABLE users
ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';

ALTER TABLE users
ADD COLUMN plan_period_start TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE ai_usage (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  generation_mode TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  questions_generated INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_tenant_user_created_at
ON ai_usage (tenant_id, user_id, created_at DESC);
