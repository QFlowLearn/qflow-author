CREATE TABLE IF NOT EXISTS lti_deep_link_states (
  state TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform_id UUID NOT NULL REFERENCES lti_platforms(id) ON DELETE CASCADE,
  deployment_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deep_link_return_url TEXT NOT NULL,
  deep_link_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS lti_deep_link_states_tenant_idx ON lti_deep_link_states (tenant_id);
CREATE INDEX IF NOT EXISTS lti_deep_link_states_platform_idx ON lti_deep_link_states (platform_id);
CREATE INDEX IF NOT EXISTS lti_deep_link_states_expires_idx ON lti_deep_link_states (expires_at);
