-- The execution is replaceable only for explicit recovery; the run's inputs stay frozen.
CREATE OR REPLACE FUNCTION guard_organization_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'question_organization_runs' THEN
    IF (NEW.id,NEW.tenant_id,NEW.setup_id,NEW.mode,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.setup_id,OLD.mode,OLD.created_by,OLD.created_at)
    THEN RAISE EXCEPTION 'Organization run inputs are immutable'; END IF;
    IF NEW.execution_id IS DISTINCT FROM OLD.execution_id AND
      (OLD.state NOT IN ('cancelled','failed') OR NEW.state <> 'queued' OR
       NEW.reserved_micros IS DISTINCT FROM OLD.reserved_micros)
    THEN RAISE EXCEPTION 'Organization execution replacement requires a stopped run and unchanged spending'; END IF;
  ELSE
    IF (NEW.run_id,NEW.tenant_id,NEW.question_id,NEW.revision_id,NEW.content_hash,NEW.baseline,NEW.source)
      IS DISTINCT FROM (OLD.run_id,OLD.tenant_id,OLD.question_id,OLD.revision_id,OLD.content_hash,OLD.baseline,OLD.source)
    THEN RAISE EXCEPTION 'Organization item inputs are immutable'; END IF;
    IF OLD.decision IS NOT NULL AND NEW.decision IS DISTINCT FROM OLD.decision
    THEN RAISE EXCEPTION 'Organization receipts are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
