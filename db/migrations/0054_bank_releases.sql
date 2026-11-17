CREATE TABLE bank_releases (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 160),
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('draft', 'frozen')),
  distribution text NOT NULL CHECK (distribution IN ('available', 'withdrawn')),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  frozen_at timestamptz,
  evidence jsonb,
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, label),
  CHECK ((state = 'draft' AND frozen_at IS NULL AND evidence IS NULL AND distribution = 'available') OR
         (state = 'frozen' AND frozen_at IS NOT NULL AND evidence IS NOT NULL))
);
CREATE TABLE bank_release_revisions (
  tenant_id uuid NOT NULL,
  release_id uuid NOT NULL,
  question_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  PRIMARY KEY (release_id, question_id),
  FOREIGN KEY (release_id, tenant_id) REFERENCES bank_releases(id, tenant_id),
  FOREIGN KEY (revision_id, question_id, tenant_id) REFERENCES question_revisions(id, question_id, tenant_id)
);
CREATE TABLE bank_release_events (
  tenant_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  release_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  actor_label text NOT NULL,
  command jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, operation_id),
  FOREIGN KEY (release_id, tenant_id) REFERENCES bank_releases(id, tenant_id)
);
CREATE TABLE bank_release_preparations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  release_id uuid NOT NULL,
  base_digest text NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'ready', 'adopted', 'deleting', 'deleted')),
  object_key text NOT NULL UNIQUE,
  sha256 text,
  byte_length integer,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (release_id, tenant_id) REFERENCES bank_releases(id, tenant_id),
  CHECK ((sha256 IS NULL AND byte_length IS NULL) OR (sha256 ~ '^[0-9a-f]{64}$' AND byte_length >= 0))
);
CREATE FUNCTION protect_frozen_bank_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'frozen' AND (
    NEW.id, NEW.tenant_id, NEW.label, NEW.version, NEW.state, NEW.manifest, NEW.digest,
    NEW.created_by, NEW.created_at, NEW.frozen_at, NEW.evidence
  ) IS DISTINCT FROM (
    OLD.id, OLD.tenant_id, OLD.label, OLD.version, OLD.state, OLD.manifest, OLD.digest,
    OLD.created_by, OLD.created_at, OLD.frozen_at, OLD.evidence
  ) THEN RAISE EXCEPTION 'Frozen edition content and evidence are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_releases_frozen_immutable BEFORE UPDATE ON bank_releases
  FOR EACH ROW EXECUTE FUNCTION protect_frozen_bank_release();
CREATE FUNCTION protect_bank_release_pin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE release_uuid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN release_uuid := NEW.release_id; ELSE release_uuid := OLD.release_id; END IF;
  IF EXISTS (SELECT 1 FROM bank_releases WHERE id = release_uuid AND state = 'frozen') THEN
    RAISE EXCEPTION 'Frozen edition revision references are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER bank_release_pins_immutable BEFORE INSERT OR UPDATE OR DELETE ON bank_release_revisions
  FOR EACH ROW EXECUTE FUNCTION protect_bank_release_pin();
CREATE FUNCTION protect_bank_release_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Edition operation receipts are immutable'; END $$;
CREATE TRIGGER bank_release_events_immutable BEFORE UPDATE OR DELETE ON bank_release_events
  FOR EACH ROW EXECUTE FUNCTION protect_bank_release_event();
