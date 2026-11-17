-- Preserve run authorship while each explicit execution owns its authority.
ALTER TABLE question_organization_runs ADD COLUMN execution_by uuid;
UPDATE question_organization_runs AS run SET execution_by = CASE
  WHEN run.state IN ('undoing','undo_failed','undone') THEN run.undo_by
  WHEN EXISTS (SELECT 1 FROM audit_logs a WHERE a.id = run.execution_id
    AND a.tenant_id = run.tenant_id AND a.action = 'question_organization_resumed')
    THEN (SELECT a.actor_user_id FROM audit_logs a WHERE a.id = run.execution_id
      AND a.tenant_id = run.tenant_id AND a.action = 'question_organization_resumed')
  ELSE run.created_by END;
ALTER TABLE question_organization_runs ALTER COLUMN execution_by SET NOT NULL;

-- Initial execution is always authorized by the creator, including inserts during deployment.
CREATE FUNCTION initialize_organization_execution_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.execution_by := NEW.created_by;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_execution_actor_insert BEFORE INSERT ON question_organization_runs
  FOR EACH ROW EXECUTE FUNCTION initialize_organization_execution_actor();

CREATE OR REPLACE FUNCTION guard_organization_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'question_organization_runs' THEN
    IF (NEW.id,NEW.tenant_id,NEW.setup_id,NEW.mode,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.setup_id,OLD.mode,OLD.created_by,OLD.created_at)
    THEN RAISE EXCEPTION 'Organization run inputs are immutable'; END IF;
    IF NEW.execution_id IS DISTINCT FROM OLD.execution_id AND
      (NOT ((OLD.state IN ('cancelled','failed') AND NEW.state = 'queued') OR
            (OLD.state IN ('completed','cancelled','failed','undo_failed') AND NEW.state = 'undoing')) OR
       NEW.reserved_micros IS DISTINCT FROM OLD.reserved_micros)
    THEN RAISE EXCEPTION 'Organization execution replacement requires a stopped run and unchanged spending'; END IF;
    IF NEW.undo_processed < OLD.undo_processed OR
      (NEW.undo_processed IS DISTINCT FROM OLD.undo_processed AND OLD.state <> 'undoing') OR
      (NEW.undo_cursor IS DISTINCT FROM OLD.undo_cursor AND
        (NEW.undo_processed <= OLD.undo_processed OR (OLD.undo_cursor IS NOT NULL AND NEW.undo_cursor <= OLD.undo_cursor)))
    THEN RAISE EXCEPTION 'Organization undo cursor must advance with a committed undo batch'; END IF;
    IF NEW.execution_by IS DISTINCT FROM OLD.execution_by AND NEW.execution_id = OLD.execution_id
    THEN RAISE EXCEPTION 'Organization execution actor requires a new execution'; END IF;
  ELSE
    IF (NEW.run_id,NEW.tenant_id,NEW.question_id,NEW.revision_id,NEW.content_hash,NEW.baseline,NEW.source)
      IS DISTINCT FROM (OLD.run_id,OLD.tenant_id,OLD.question_id,OLD.revision_id,OLD.content_hash,OLD.baseline,OLD.source)
    THEN RAISE EXCEPTION 'Organization item inputs are immutable'; END IF;
    IF OLD.decision IS NOT NULL AND NEW.decision IS DISTINCT FROM OLD.decision
    THEN RAISE EXCEPTION 'Organization receipts are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
