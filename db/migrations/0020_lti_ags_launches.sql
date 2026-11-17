CREATE TABLE IF NOT EXISTS lti_ags_launches (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform_id UUID NOT NULL REFERENCES lti_platforms(id) ON DELETE CASCADE,
  deployment_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  line_items_url TEXT,
  line_item_url TEXT,
  resource_link_id TEXT,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lti_ags_launches_tenant_user_created_idx
  ON lti_ags_launches (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lti_ags_launches_platform_idx
  ON lti_ags_launches (platform_id);
