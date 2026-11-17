CREATE TABLE migration_sources (
  run_id uuid PRIMARY KEY REFERENCES migration_runs(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text,
  size integer NOT NULL DEFAULT 0,
  data_base64 text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX migration_sources_created_idx ON migration_sources (created_at);
