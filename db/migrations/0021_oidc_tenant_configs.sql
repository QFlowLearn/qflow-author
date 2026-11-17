CREATE TABLE IF NOT EXISTS oidc_tenant_configs (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  client_id text,
  client_secret text,
  microsoft_tenant text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS oidc_tenant_configs_tenant_idx ON oidc_tenant_configs (tenant_id);
CREATE INDEX IF NOT EXISTS oidc_tenant_configs_enabled_idx ON oidc_tenant_configs (enabled);
