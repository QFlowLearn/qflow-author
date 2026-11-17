CREATE TABLE workflow_dispatches (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  job_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  state text NOT NULL,
  workflow_status text,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_dispatches_kind_check
    CHECK (kind IN ('source_migration', 'ai_generation')),
  CONSTRAINT workflow_dispatches_state_check
    CHECK (state IN ('pending', 'active', 'complete', 'failed')),
  CONSTRAINT workflow_dispatches_workflow_status_check
    CHECK (
      workflow_status IS NULL OR
      workflow_status IN (
        'queued',
        'running',
        'paused',
        'errored',
        'terminated',
        'complete',
        'waiting',
        'waitingForPause',
        'unknown'
      )
    ),
  CONSTRAINT workflow_dispatches_attempts_check CHECK (attempts >= 0),
  CONSTRAINT workflow_dispatches_lifecycle_check
    CHECK (
      (state = 'pending' AND started_at IS NULL AND completed_at IS NULL) OR
      (state = 'active' AND started_at IS NOT NULL AND completed_at IS NULL) OR
      (state IN ('complete', 'failed') AND started_at IS NOT NULL AND completed_at IS NOT NULL)
    )
);

CREATE INDEX workflow_dispatches_state_idx
  ON workflow_dispatches (state, updated_at);

CREATE INDEX workflow_dispatches_job_idx
  ON workflow_dispatches (kind, job_id);

CREATE UNIQUE INDEX workflow_dispatches_open_job_idx
  ON workflow_dispatches (kind, job_id)
  WHERE state IN ('pending', 'active');

ALTER TABLE migration_runs
  DROP CONSTRAINT migration_runs_lease_state_check,
  ADD CONSTRAINT migration_runs_lease_state_check
    CHECK (
      (
        status = 'queued' AND
        lease_token IS NULL AND
        started_at IS NULL AND
        completed_at IS NULL
      ) OR (
        status = 'analyzing' AND
        lease_token IS NOT NULL AND
        last_error IS NULL AND
        started_at IS NOT NULL AND
        completed_at IS NULL
      ) OR (
        status IN ('analyzed', 'committed') AND
        lease_token IS NULL AND
        last_error IS NULL AND
        started_at IS NULL AND
        completed_at IS NOT NULL
      ) OR (
        status = 'failed' AND
        lease_token IS NULL AND
        last_error IS NOT NULL AND
        started_at IS NULL AND
        completed_at IS NOT NULL
      )
    );

ALTER TABLE ai_generation_jobs
  DROP CONSTRAINT ai_generation_jobs_lease_state_check,
  ADD CONSTRAINT ai_generation_jobs_lease_state_check
    CHECK (
      (
        status = 'queued' AND
        lease_token IS NULL AND
        started_at IS NULL AND
        completed_at IS NULL
      ) OR (
        status = 'running' AND
        lease_token IS NOT NULL AND
        started_at IS NOT NULL AND
        completed_at IS NULL
      ) OR (
        status IN ('completed', 'failed') AND
        lease_token IS NULL AND
        completed_at IS NOT NULL
      )
    );

CREATE TABLE canvas_connections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_url text NOT NULL,
  client_id text NOT NULL,
  encrypted_client_secret text NOT NULL,
  credential_version integer NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canvas_connections_lifecycle_state_check
    CHECK (lifecycle_state IN ('active', 'disabled')),
  CONSTRAINT canvas_connections_credential_version_check
    CHECK (credential_version >= 1),
  CONSTRAINT canvas_connections_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT canvas_connections_creator_membership_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES organization_memberships (tenant_id, user_id)
);

CREATE UNIQUE INDEX canvas_connections_tenant_base_url_idx
  ON canvas_connections (tenant_id, base_url);

CREATE TABLE canvas_user_grants (
  connection_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  encrypted_refresh_token text NOT NULL,
  canvas_user_id text,
  authorized_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canvas_user_grants_pkey PRIMARY KEY (connection_id, user_id),
  CONSTRAINT canvas_user_grants_connection_tenant_fk
    FOREIGN KEY (connection_id, tenant_id)
    REFERENCES canvas_connections (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT canvas_user_grants_user_membership_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES organization_memberships (tenant_id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX canvas_user_grants_tenant_user_idx
  ON canvas_user_grants (tenant_id, user_id);

CREATE TABLE canvas_oauth_states (
  state_hash text PRIMARY KEY,
  connection_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  credential_version integer NOT NULL,
  return_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT canvas_oauth_states_credential_version_check
    CHECK (credential_version >= 1),
  CONSTRAINT canvas_oauth_states_lifetime_check
    CHECK (expires_at > created_at),
  CONSTRAINT canvas_oauth_states_connection_tenant_fk
    FOREIGN KEY (connection_id, tenant_id)
    REFERENCES canvas_connections (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT canvas_oauth_states_user_membership_fk
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES organization_memberships (tenant_id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX canvas_oauth_states_expiry_idx ON canvas_oauth_states (expires_at);
