CREATE TABLE uploads (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL,
  path text NOT NULL,
  url text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX uploads_tenant_idx ON uploads (tenant_id);
