CREATE TABLE tenant_domains (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX tenant_domains_domain_unique_idx ON tenant_domains (domain);
CREATE INDEX tenant_domains_tenant_idx ON tenant_domains (tenant_id);
