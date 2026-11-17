CREATE TABLE IF NOT EXISTS lti_launch_handoffs (
  state TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  destination TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS lti_launch_handoffs_tenant_idx ON lti_launch_handoffs (tenant_id);
CREATE INDEX IF NOT EXISTS lti_launch_handoffs_user_idx ON lti_launch_handoffs (user_id);
CREATE INDEX IF NOT EXISTS lti_launch_handoffs_expires_idx ON lti_launch_handoffs (expires_at);
