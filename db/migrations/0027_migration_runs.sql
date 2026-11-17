CREATE TABLE migration_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  created_by uuid NOT NULL,
  source_filename text NOT NULL,
  source_mime text,
  source_size integer NOT NULL DEFAULT 0,
  adapter_id text,
  adapter_label text,
  status text NOT NULL DEFAULT 'analyzed',
  parts jsonb NOT NULL DEFAULT '[]',
  summary jsonb NOT NULL DEFAULT '{}',
  assessment_id uuid REFERENCES assessments(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  committed_at timestamptz
);

CREATE TABLE migration_items (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
  source_href text NOT NULL,
  source_identifier text NOT NULL,
  title text NOT NULL,
  item_type text NOT NULL,
  position integer NOT NULL,
  status text NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]',
  source_xml text NOT NULL,
  imported_draft jsonb NOT NULL DEFAULT '{}',
  created_question_id uuid,
  created_revision integer,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE migration_assets (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
  source_path text NOT NULL,
  name text NOT NULL,
  mime_type text,
  size integer NOT NULL DEFAULT 0,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  data_base64 text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX migration_runs_tenant_idx ON migration_runs (tenant_id);
CREATE INDEX migration_runs_status_idx ON migration_runs (status);
CREATE INDEX migration_runs_created_idx ON migration_runs (created_at);
CREATE INDEX migration_items_run_idx ON migration_items (run_id);
CREATE INDEX migration_items_status_idx ON migration_items (status);
CREATE INDEX migration_assets_run_idx ON migration_assets (run_id);
CREATE UNIQUE INDEX migration_assets_run_canonical_path_idx
  ON migration_assets (run_id, lower(source_path));
