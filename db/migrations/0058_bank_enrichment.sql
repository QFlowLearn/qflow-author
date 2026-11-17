CREATE TABLE bank_enrichment_schemes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id)
);

CREATE TABLE bank_enrichment_scheme_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (id, scheme_id, tenant_id),
  UNIQUE (scheme_id, version),
  FOREIGN KEY (scheme_id, tenant_id) REFERENCES bank_enrichment_schemes(id, tenant_id)
);

CREATE TABLE bank_enrichment_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  item_count integer NOT NULL CHECK (item_count >= 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id)
);

CREATE TABLE bank_enrichment_snapshot_items (
  snapshot_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  question_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  PRIMARY KEY (snapshot_id, question_id),
  FOREIGN KEY (snapshot_id, tenant_id) REFERENCES bank_enrichment_snapshots(id, tenant_id),
  FOREIGN KEY (revision_id, question_id, tenant_id) REFERENCES question_revisions(id, question_id, tenant_id)
);

CREATE TABLE bank_enrichment_changes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  question_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  version_id uuid NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('subject', 'topic', 'difficulty')),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  origin text NOT NULL CHECK (origin IN ('ai', 'human', 'undo')),
  operation_id uuid NOT NULL,
  previous_change_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id, scheme_id, question_id, dimension),
  UNIQUE (tenant_id, operation_id, scheme_id, question_id, dimension),
  FOREIGN KEY (version_id, scheme_id, tenant_id) REFERENCES bank_enrichment_scheme_versions(id, scheme_id, tenant_id),
  FOREIGN KEY (revision_id, question_id, tenant_id) REFERENCES question_revisions(id, question_id, tenant_id),
  FOREIGN KEY (previous_change_id, tenant_id, scheme_id, question_id, dimension)
    REFERENCES bank_enrichment_changes(id, tenant_id, scheme_id, question_id, dimension)
);
CREATE INDEX enrichment_change_history_idx ON bank_enrichment_changes(tenant_id, question_id, scheme_id, created_at);

CREATE TABLE bank_enrichment_assignments (
  tenant_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  question_id uuid NOT NULL,
  dimension text NOT NULL,
  change_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, scheme_id, question_id, dimension),
  FOREIGN KEY (change_id, tenant_id, scheme_id, question_id, dimension)
    REFERENCES bank_enrichment_changes(id, tenant_id, scheme_id, question_id, dimension),
  FOREIGN KEY (question_id, tenant_id) REFERENCES questions(id, tenant_id)
);

-- Published definitions, input references and change values never mutate in place.
CREATE FUNCTION reject_enrichment_record_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Enrichment records are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER enrichment_version_immutable BEFORE UPDATE ON bank_enrichment_scheme_versions
  FOR EACH ROW EXECUTE FUNCTION reject_enrichment_record_update();
CREATE TRIGGER enrichment_snapshot_item_immutable BEFORE UPDATE ON bank_enrichment_snapshot_items
  FOR EACH ROW EXECUTE FUNCTION reject_enrichment_record_update();
CREATE TRIGGER enrichment_change_immutable BEFORE UPDATE ON bank_enrichment_changes
  FOR EACH ROW EXECUTE FUNCTION reject_enrichment_record_update();

-- A snapshot is created empty and sealed once after INSERT SELECT in the same transaction.
CREATE FUNCTION seal_enrichment_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.item_count <> 0 OR NEW.item_count <= 0 OR
    NEW.item_count <> (SELECT count(*) FROM bank_enrichment_snapshot_items WHERE snapshot_id = NEW.id) OR
    (NEW.id, NEW.tenant_id, NEW.scope, NEW.created_by, NEW.created_at) IS DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.scope, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Enrichment snapshot is sealed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enrichment_snapshot_sealed BEFORE UPDATE ON bank_enrichment_snapshots
  FOR EACH ROW EXECUTE FUNCTION seal_enrichment_snapshot();

CREATE FUNCTION check_enrichment_snapshot_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured_count integer;
BEGIN
  SELECT item_count INTO captured_count FROM bank_enrichment_snapshots
    WHERE id = NEW.snapshot_id AND tenant_id = NEW.tenant_id FOR SHARE;
  IF captured_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Enrichment snapshot is sealed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enrichment_snapshot_insert_guard BEFORE INSERT ON bank_enrichment_snapshot_items
  FOR EACH ROW EXECUTE FUNCTION check_enrichment_snapshot_open();

CREATE TABLE bank_enrichment_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  version_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('classify', 'correct', 'undo')),
  state text NOT NULL CHECK (state IN ('prepared', 'queued', 'running', 'completed', 'completed_with_issues', 'failed', 'cancelled')),
  dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions) = 'array' AND jsonb_array_length(dimensions) BETWEEN 1 AND 3),
  replacement text NOT NULL CHECK (replacement IN ('preserve_manual', 'replace_captured')),
  configuration jsonb,
  result jsonb,
  source_run_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id, scheme_id),
  FOREIGN KEY (snapshot_id, tenant_id) REFERENCES bank_enrichment_snapshots(id, tenant_id),
  FOREIGN KEY (version_id, scheme_id, tenant_id) REFERENCES bank_enrichment_scheme_versions(id, scheme_id, tenant_id),
  FOREIGN KEY (source_run_id, tenant_id, scheme_id) REFERENCES bank_enrichment_runs(id, tenant_id, scheme_id),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((state = 'running') = (lease_token IS NOT NULL)),
  CHECK ((kind = 'undo') = (source_run_id IS NOT NULL)),
  CHECK (state IN ('prepared', 'cancelled') OR (configuration IS NOT NULL AND jsonb_typeof(configuration) = 'object'))
);
CREATE UNIQUE INDEX enrichment_one_active_scheme_idx ON bank_enrichment_runs(tenant_id, scheme_id) WHERE state IN ('queued', 'running');

CREATE TABLE bank_enrichment_run_items (
  run_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  question_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  baseline jsonb NOT NULL CHECK (jsonb_typeof(baseline) = 'object'),
  state text NOT NULL CHECK (state IN ('pending', 'classified', 'unassigned', 'protected', 'outdated', 'failed', 'cancelled')),
  detail jsonb,
  PRIMARY KEY (run_id, question_id),
  FOREIGN KEY (run_id, tenant_id, scheme_id) REFERENCES bank_enrichment_runs(id, tenant_id, scheme_id),
  FOREIGN KEY (revision_id, question_id, tenant_id) REFERENCES question_revisions(id, question_id, tenant_id)
);
CREATE INDEX enrichment_run_items_state_idx ON bank_enrichment_run_items(run_id, state, question_id);

CREATE TABLE bank_enrichment_batches (
  run_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  scheme_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  state text NOT NULL CHECK (state IN ('reserved', 'received', 'applied', 'failed')),
  question_ids jsonb NOT NULL CHECK (jsonb_typeof(question_ids) = 'array'),
  response jsonb,
  attempts integer NOT NULL CHECK (attempts >= 0),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, sequence),
  FOREIGN KEY (run_id, tenant_id, scheme_id) REFERENCES bank_enrichment_runs(id, tenant_id, scheme_id),
  CHECK (state NOT IN ('received', 'applied') OR response IS NOT NULL)
);

CREATE FUNCTION protect_enrichment_run_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.snapshot_id, NEW.scheme_id, NEW.version_id, NEW.kind,
      NEW.dimensions, NEW.replacement, NEW.source_run_id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.snapshot_id, OLD.scheme_id, OLD.version_id, OLD.kind,
      OLD.dimensions, OLD.replacement, OLD.source_run_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Enrichment run input is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.configuration IS NOT NULL AND NEW.configuration IS DISTINCT FROM OLD.configuration THEN
    RAISE EXCEPTION 'Enrichment run configuration is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enrichment_run_input_immutable BEFORE UPDATE ON bank_enrichment_runs
  FOR EACH ROW EXECUTE FUNCTION protect_enrichment_run_input();

CREATE FUNCTION protect_enrichment_item_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.run_id, NEW.tenant_id, NEW.scheme_id, NEW.question_id, NEW.revision_id, NEW.baseline)
    IS DISTINCT FROM (OLD.run_id, OLD.tenant_id, OLD.scheme_id, OLD.question_id, OLD.revision_id, OLD.baseline) THEN
    RAISE EXCEPTION 'Enrichment item input is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enrichment_item_input_immutable BEFORE UPDATE ON bank_enrichment_run_items
  FOR EACH ROW EXECUTE FUNCTION protect_enrichment_item_input();

CREATE FUNCTION check_enrichment_run_item_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bank_enrichment_runs r
    JOIN bank_enrichment_snapshot_items s ON s.snapshot_id = r.snapshot_id AND s.tenant_id = r.tenant_id
    WHERE r.id = NEW.run_id AND r.tenant_id = NEW.tenant_id AND r.scheme_id = NEW.scheme_id
      AND r.state = 'prepared' AND s.question_id = NEW.question_id AND s.revision_id = NEW.revision_id
  ) THEN
    RAISE EXCEPTION 'Question is outside the captured run scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enrichment_run_item_source_guard BEFORE INSERT ON bank_enrichment_run_items
  FOR EACH ROW EXECUTE FUNCTION check_enrichment_run_item_source();
