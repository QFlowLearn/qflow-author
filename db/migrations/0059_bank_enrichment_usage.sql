CREATE TABLE bank_enrichment_budgets (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, snapshot_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('preview', 'run')),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  limit_micros integer NOT NULL CHECK (limit_micros > 0),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (snapshot_id, tenant_id) REFERENCES bank_enrichment_snapshots(id, tenant_id)
);
CREATE TABLE bank_enrichment_usage_attempts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, budget_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  reserved_micros bigint NOT NULL CHECK (reserved_micros > 0),
  charged_micros bigint CHECK (charged_micros >= 0),
  state text NOT NULL CHECK (state IN ('dispatched', 'settled')),
  receipt jsonb, created_at timestamptz NOT NULL, settled_at timestamptz,
  CHECK ((state = 'settled') = (receipt IS NOT NULL AND settled_at IS NOT NULL AND charged_micros IS NOT NULL)),
  FOREIGN KEY (budget_id, tenant_id) REFERENCES bank_enrichment_budgets(id, tenant_id)
);
CREATE INDEX enrichment_usage_budget_idx ON bank_enrichment_usage_attempts(budget_id);
CREATE FUNCTION guard_enrichment_budget() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Enrichment budget inputs are immutable';
END $$;
CREATE TRIGGER enrichment_budget_immutable BEFORE UPDATE ON bank_enrichment_budgets
  FOR EACH ROW EXECUTE FUNCTION guard_enrichment_budget();
CREATE FUNCTION guard_enrichment_usage_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.budget_id IS DISTINCT FROM OLD.budget_id OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
    OR NEW.reserved_micros IS DISTINCT FROM OLD.reserved_micros OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.state <> 'dispatched' OR NEW.state <> 'settled' THEN
    RAISE EXCEPTION 'Enrichment attempt may only settle once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrichment_usage_immutable BEFORE UPDATE ON bank_enrichment_usage_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_enrichment_usage_attempt();
