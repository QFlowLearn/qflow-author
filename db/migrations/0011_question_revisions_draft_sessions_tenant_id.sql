ALTER TABLE question_revisions
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE draft_sessions
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX question_revisions_tenant_idx ON question_revisions (tenant_id);
CREATE INDEX draft_sessions_tenant_idx ON draft_sessions (tenant_id);
