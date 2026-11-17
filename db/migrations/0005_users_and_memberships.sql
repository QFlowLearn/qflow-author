CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  display_name text,
  avatar_url text,
  auth_provider text,
  auth_provider_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique_idx ON users (lower(email));
CREATE UNIQUE INDEX users_provider_unique_idx ON users (auth_provider, auth_provider_id) WHERE auth_provider_id IS NOT NULL;

CREATE TABLE organization_memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  invited_at timestamptz DEFAULT now(),
  joined_at timestamptz DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX organization_memberships_unique_idx
  ON organization_memberships (tenant_id, user_id);
