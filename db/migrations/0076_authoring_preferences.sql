CREATE TABLE assessment_authoring_preferences (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  type_id text NOT NULL,
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  PRIMARY KEY (tenant_id, user_id, assessment_id, type_id)
);
