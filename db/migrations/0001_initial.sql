CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE assessments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX assessments_tenant_slug_idx ON assessments (tenant_id, slug);

CREATE TABLE assessment_versions (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  version int NOT NULL,
  label text,
  published_at timestamptz,
  published_by uuid,
  UNIQUE (assessment_id, version)
);

CREATE TABLE questions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stable_key text NOT NULL,
  title text NOT NULL DEFAULT 'Untitled',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  latest_revision_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, stable_key)
);

CREATE TABLE question_revisions (
  id uuid PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  draft_state text NOT NULL DEFAULT 'draft'
    CONSTRAINT question_revisions_draft_state_check
    CHECK (draft_state IN ('draft', 'ready', 'published')),
  revision int NOT NULL,
  body jsonb NOT NULL,
  rubric jsonb,
  scoring jsonb,
  metadata jsonb,
  provenance jsonb NOT NULL,
  qti_xml text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT question_revisions_publication_timestamp_check CHECK (
    (draft_state = 'published' AND published_at IS NOT NULL)
    OR (draft_state IN ('draft', 'ready') AND published_at IS NULL)
  ),
  UNIQUE (question_id, revision)
);

ALTER TABLE questions
  ADD CONSTRAINT questions_latest_revision_fk
  FOREIGN KEY (latest_revision_id)
  REFERENCES question_revisions(id);

CREATE TABLE assessment_question_links (
  id uuid PRIMARY KEY,
  assessment_version_id uuid NOT NULL REFERENCES assessment_versions(id) ON DELETE CASCADE,
  question_revision_id uuid NOT NULL REFERENCES question_revisions(id) ON DELETE CASCADE,
  position int NOT NULL,
  points numeric(6,2) DEFAULT 0,
  part_metadata jsonb,
  UNIQUE (assessment_version_id, position)
);

CREATE TABLE question_assets (
  id uuid PRIMARY KEY,
  question_revision_id uuid NOT NULL REFERENCES question_revisions(id) ON DELETE CASCADE,
  asset_key text NOT NULL,
  mime_type text NOT NULL,
  r2_url text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE draft_sessions (
  id uuid PRIMARY KEY,
  question_revision_id uuid REFERENCES question_revisions(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  client_state jsonb NOT NULL,
  last_heartbeat timestamptz DEFAULT now()
);

CREATE INDEX question_revisions_question_id_idx ON question_revisions (question_id);
CREATE INDEX assessment_question_links_version_idx ON assessment_question_links (assessment_version_id);
CREATE INDEX outbox_events_processed_idx ON outbox_events (processed_at) WHERE processed_at IS NULL;
