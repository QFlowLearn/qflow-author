CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN email_normalized text,
  ADD COLUMN email_verified_at timestamptz;

UPDATE users
  SET email_normalized = lower(email)
  WHERE email_normalized IS NULL;

ALTER TABLE users
  ALTER COLUMN email_normalized SET NOT NULL;

CREATE UNIQUE INDEX users_email_normalized_unique_idx ON users (email_normalized);

CREATE UNIQUE INDEX organization_memberships_user_unique_idx
  ON organization_memberships (user_id);

CREATE TABLE user_passwords (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE auth_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_id text NOT NULL,
  email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX auth_identities_provider_unique_idx
  ON auth_identities (provider, provider_id);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  user_agent text,
  ip_address text,
  created_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX auth_sessions_token_hash_idx ON auth_sessions (token_hash);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_tenant_idx ON auth_sessions (tenant_id);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE UNIQUE INDEX password_reset_tokens_token_hash_idx ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

INSERT INTO auth_identities (id, user_id, provider, provider_id, email)
SELECT gen_random_uuid(), id, 'local', email_normalized, email
FROM users
WHERE email_normalized IS NOT NULL
ON CONFLICT DO NOTHING;
