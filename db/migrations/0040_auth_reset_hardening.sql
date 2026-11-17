-- Existing lockout rows use email-only keys; reset them before adopting account-and-origin keys.
TRUNCATE TABLE auth_login_attempts;

ALTER TABLE auth_login_attempts
  RENAME COLUMN email_normalized TO attempt_key;

CREATE INDEX auth_login_attempts_last_attempt_idx
  ON auth_login_attempts (last_attempt_at);

CREATE INDEX password_reset_tokens_expires_idx
  ON password_reset_tokens (expires_at);

CREATE TABLE password_reset_email_deliveries (
  id uuid PRIMARY KEY,
  reset_token_id uuid NOT NULL REFERENCES password_reset_tokens(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  email text NOT NULL,
  encrypted_token text,
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  leased_until timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_email_deliveries_terminal_check CHECK (
    NOT (delivered_at IS NOT NULL AND invalidated_at IS NOT NULL)
  ),
  CONSTRAINT password_reset_email_deliveries_secret_check CHECK (
    encrypted_token IS NOT NULL OR delivered_at IS NOT NULL OR invalidated_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX password_reset_email_deliveries_reset_token_idx
  ON password_reset_email_deliveries (reset_token_id);

CREATE INDEX password_reset_email_deliveries_pending_idx
  ON password_reset_email_deliveries (delivered_at, invalidated_at, leased_until, created_at);
