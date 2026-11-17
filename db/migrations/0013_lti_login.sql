CREATE TABLE lti_login_states (
  state text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform_id uuid NOT NULL REFERENCES lti_platforms(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  deployment_id text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX lti_login_states_tenant_idx ON lti_login_states (tenant_id);
CREATE INDEX lti_login_states_platform_idx ON lti_login_states (platform_id);
CREATE INDEX lti_login_states_expires_idx ON lti_login_states (expires_at);
