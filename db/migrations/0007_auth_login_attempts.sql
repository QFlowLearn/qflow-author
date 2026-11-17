CREATE TABLE auth_login_attempts (
  email_normalized text PRIMARY KEY,
  attempts int NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  locked_until timestamptz
);

CREATE INDEX auth_login_attempts_locked_idx ON auth_login_attempts (locked_until);
