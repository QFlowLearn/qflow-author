CREATE TABLE lti_platforms (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  client_id text NOT NULL,
  name text,
  auth_endpoint text,
  token_endpoint text,
  jwks_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX lti_platforms_tenant_issuer_client_unique_idx
  ON lti_platforms (tenant_id, issuer, client_id);
CREATE INDEX lti_platforms_tenant_idx ON lti_platforms (tenant_id);

CREATE TABLE lti_deployments (
  id uuid PRIMARY KEY,
  platform_id uuid NOT NULL REFERENCES lti_platforms(id) ON DELETE CASCADE,
  deployment_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX lti_deployments_platform_deployment_unique_idx
  ON lti_deployments (platform_id, deployment_id);
CREATE INDEX lti_deployments_platform_idx ON lti_deployments (platform_id);

CREATE TABLE lti_registrations (
  id uuid PRIMARY KEY,
  platform_id uuid NOT NULL REFERENCES lti_platforms(id) ON DELETE CASCADE,
  registration_type text NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX lti_registrations_platform_idx ON lti_registrations (platform_id);

CREATE TABLE lti_tool_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  public_jwk jsonb NOT NULL,
  private_jwk jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  rotated_at timestamptz,
  retired_at timestamptz
);

CREATE UNIQUE INDEX lti_tool_keys_tenant_key_unique_idx ON lti_tool_keys (tenant_id, key_id);
CREATE UNIQUE INDEX lti_tool_keys_active_unique_idx ON lti_tool_keys (tenant_id) WHERE active;
CREATE INDEX lti_tool_keys_tenant_idx ON lti_tool_keys (tenant_id);
