CREATE TABLE question_organization_notices (
  execution_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  FOREIGN KEY (run_id, tenant_id) REFERENCES question_organization_runs(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX organization_notice_unread ON question_organization_notices(tenant_id, created_at DESC) WHERE read_at IS NULL;
