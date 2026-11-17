CREATE EXTENSION pg_trgm;

ALTER TABLE questions
  ADD COLUMN owner_user_id uuid NOT NULL REFERENCES users(id),
  ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active',
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES users(id);

ALTER TABLE questions
  ADD CONSTRAINT questions_lifecycle_state_check CHECK (
    lifecycle_state IN ('active', 'archived')
  ),
  ADD CONSTRAINT questions_archive_state_check CHECK (
    (lifecycle_state = 'active' AND archived_at IS NULL AND archived_by IS NULL)
    OR
    (lifecycle_state = 'archived' AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
  );

ALTER TABLE questions ALTER COLUMN lifecycle_state DROP DEFAULT;

ALTER TABLE question_revisions
  ADD COLUMN content_hash text NOT NULL,
  ADD COLUMN search_text text NOT NULL,
  ADD COLUMN compatibility jsonb NOT NULL,
  ADD CONSTRAINT question_revisions_content_hash_check CHECK (
    content_hash ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT question_revisions_compatibility_check CHECK (
    jsonb_typeof(compatibility) = 'array'
  );

CREATE UNIQUE INDEX questions_id_tenant_idx ON questions (id, tenant_id);
CREATE UNIQUE INDEX question_revisions_identity_tenant_idx
  ON question_revisions (id, question_id, tenant_id);
CREATE UNIQUE INDEX question_revisions_id_tenant_idx
  ON question_revisions (id, tenant_id);

ALTER TABLE draft_sessions
  ALTER COLUMN question_revision_id SET NOT NULL,
  ADD CONSTRAINT draft_sessions_question_revision_tenant_fk
    FOREIGN KEY (question_revision_id, tenant_id)
    REFERENCES question_revisions(id, tenant_id);

CREATE UNIQUE INDEX draft_sessions_author_revision_idx
  ON draft_sessions (tenant_id, author_id, question_revision_id);

CREATE INDEX questions_tenant_lifecycle_updated_idx
  ON questions (tenant_id, lifecycle_state, updated_at DESC);

CREATE INDEX questions_tags_gin_idx ON questions USING gin (tags);
CREATE INDEX question_revisions_tenant_content_hash_idx
  ON question_revisions (tenant_id, content_hash);
CREATE INDEX question_revisions_search_text_trgm_idx
  ON question_revisions USING gin (search_text gin_trgm_ops);
CREATE INDEX question_revisions_body_gin_idx ON question_revisions USING gin (body);
CREATE INDEX question_revisions_compatibility_gin_idx
  ON question_revisions USING gin (compatibility);

CREATE TABLE question_review_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  question_id uuid NOT NULL,
  revision_id uuid NOT NULL UNIQUE,
  requested_by uuid NOT NULL REFERENCES users(id),
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  state text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id),
  decision_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_review_requests_state_check CHECK (
    state IN ('open', 'approved', 'changes_requested')
  ),
  CONSTRAINT question_review_requests_decision_check CHECK (
    (state = 'open' AND decided_at IS NULL AND decided_by IS NULL AND decision_note IS NULL)
    OR
    (state = 'approved' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
    OR
    (state = 'changes_requested' AND decided_at IS NOT NULL AND decided_by IS NOT NULL AND decision_note IS NOT NULL)
  ),
  CONSTRAINT question_review_requests_decision_note_check CHECK (
    decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 1 AND 4000
  ),
  CONSTRAINT question_review_requests_question_tenant_fk
    FOREIGN KEY (question_id, tenant_id) REFERENCES questions(id, tenant_id),
  CONSTRAINT question_review_requests_revision_question_tenant_fk
    FOREIGN KEY (revision_id, question_id, tenant_id)
    REFERENCES question_revisions(id, question_id, tenant_id),
  UNIQUE (id, tenant_id)
);

CREATE INDEX question_review_requests_tenant_question_idx
  ON question_review_requests (tenant_id, question_id, requested_at DESC);
CREATE INDEX question_review_requests_tenant_reviewer_state_idx
  ON question_review_requests (tenant_id, reviewer_user_id, state);

CREATE TABLE question_review_comments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  review_request_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_review_comments_body_check CHECK (
    char_length(btrim(body)) BETWEEN 1 AND 4000
  ),
  CONSTRAINT question_review_comments_request_tenant_fk
    FOREIGN KEY (review_request_id, tenant_id)
    REFERENCES question_review_requests(id, tenant_id)
);

CREATE INDEX question_review_comments_request_created_idx
  ON question_review_comments (tenant_id, review_request_id, created_at, id);
