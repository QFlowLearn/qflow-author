CREATE TABLE release_artifacts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, release_id uuid NOT NULL,
 release_digest text NOT NULL CHECK (release_digest ~ '^[0-9a-f]{64}$'),
 destination text NOT NULL, compiler text NOT NULL, policy text NOT NULL,
 current_attempt_id uuid NOT NULL, receipt jsonb,
 created_at timestamptz NOT NULL,
 UNIQUE(id,tenant_id), UNIQUE(tenant_id,release_id,destination,compiler,policy),
 FOREIGN KEY(release_id,tenant_id) REFERENCES bank_releases(id,tenant_id),
 CHECK (receipt IS NULL OR jsonb_typeof(receipt) = 'object')
);
CREATE TABLE release_build_attempts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, artifact_id uuid NOT NULL,
 actor_id uuid NOT NULL, previous_attempt_id uuid, state text NOT NULL
 CHECK (state IN ('queued','running','candidate','ready','blocked','failed')),
 object_key text NOT NULL UNIQUE, report jsonb, sha256 text,
 byte_length integer, candidate_digest text, created_at timestamptz NOT NULL,
 generated_at timestamptz,
 UNIQUE(id,artifact_id,tenant_id),
 FOREIGN KEY(artifact_id,tenant_id) REFERENCES release_artifacts(id,tenant_id),
 FOREIGN KEY(previous_attempt_id,artifact_id,tenant_id) REFERENCES release_build_attempts(id,artifact_id,tenant_id),
 CHECK ((sha256 IS NULL AND byte_length IS NULL AND candidate_digest IS NULL) OR
 (sha256 ~ '^[0-9a-f]{64}$' AND byte_length >= 0 AND candidate_digest ~ '^[0-9a-f]{64}$')),
 CHECK (state NOT IN ('candidate','ready') OR (sha256 IS NOT NULL AND report IS NOT NULL AND generated_at IS NOT NULL)),
 CHECK (report IS NULL OR jsonb_typeof(report) = 'object')
);
ALTER TABLE release_artifacts ADD CONSTRAINT release_artifact_current_attempt
 FOREIGN KEY(current_attempt_id,id,tenant_id) REFERENCES release_build_attempts(id,artifact_id,tenant_id)
 DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION guard_release_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retained artifacts cannot be deleted'; END IF;
 IF TG_OP = 'UPDATE' THEN
  IF OLD.receipt IS NOT NULL OR
    (to_jsonb(NEW) - 'current_attempt_id' - 'receipt') IS DISTINCT FROM
    (to_jsonb(OLD) - 'current_attempt_id' - 'receipt') THEN
   RAISE EXCEPTION 'Artifact identity and ready receipt are immutable';
  END IF;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM bank_releases r WHERE r.id = NEW.release_id AND
   r.tenant_id = NEW.tenant_id AND r.state = 'frozen' AND r.digest = NEW.release_digest) THEN
  RAISE EXCEPTION 'Artifact requires an exact frozen edition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER release_artifact_guard BEFORE INSERT OR UPDATE OR DELETE ON release_artifacts
 FOR EACH ROW EXECUTE FUNCTION guard_release_artifact();

CREATE FUNCTION guard_release_build_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Release build attempts cannot be deleted'; END IF;
 IF OLD.state = 'ready' OR
   (to_jsonb(NEW) - 'state' - 'report' - 'sha256' - 'byte_length' - 'candidate_digest' - 'generated_at') IS DISTINCT FROM
   (to_jsonb(OLD) - 'state' - 'report' - 'sha256' - 'byte_length' - 'candidate_digest' - 'generated_at') THEN
  RAISE EXCEPTION 'Release attempt identity and ready output are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER release_build_attempt_guard BEFORE UPDATE OR DELETE ON release_build_attempts
 FOR EACH ROW EXECUTE FUNCTION guard_release_build_attempt();

ALTER TABLE workflow_dispatches DROP CONSTRAINT workflow_dispatches_kind_check;
ALTER TABLE workflow_dispatches ADD CONSTRAINT workflow_dispatches_kind_check
 CHECK (kind IN ('source_migration','ai_generation','release_build'));
