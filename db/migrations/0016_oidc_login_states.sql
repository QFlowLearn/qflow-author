CREATE TABLE IF NOT EXISTS oidc_login_states (
  state text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  nonce text NOT NULL,
  redirect_path text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS oidc_login_states_tenant_idx ON oidc_login_states (tenant_id);
CREATE INDEX IF NOT EXISTS oidc_login_states_expires_idx ON oidc_login_states (expires_at);
