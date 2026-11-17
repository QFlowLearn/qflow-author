ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS login_policy text NOT NULL DEFAULT 'allow_password';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_login_policy_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_login_policy_check
      CHECK (login_policy IN ('allow_password', 'prefer_sso', 'require_sso'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS sso_domain_routes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sso_domain_routes_tenant_domain_unique_idx
  ON sso_domain_routes (tenant_id, domain);

CREATE INDEX IF NOT EXISTS sso_domain_routes_tenant_idx
  ON sso_domain_routes (tenant_id);
