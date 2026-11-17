CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_tenant_idx ON audit_logs (tenant_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON audit_logs (target_user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at);
