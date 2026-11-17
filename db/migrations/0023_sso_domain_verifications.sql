CREATE TABLE IF NOT EXISTS sso_domain_verifications (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  verification_token text NOT NULL,
  dns_verified_at timestamptz,
  https_verified_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, domain)
);

CREATE INDEX IF NOT EXISTS sso_domain_verifications_tenant_idx
  ON sso_domain_verifications (tenant_id);

CREATE INDEX IF NOT EXISTS sso_domain_verifications_verified_idx
  ON sso_domain_verifications (tenant_id, verified_at);
