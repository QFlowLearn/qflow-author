-- Undo remains one run but checkpoints bounded compensation work in the existing Workflow.
ALTER TABLE question_organization_runs
  ADD COLUMN undo_by uuid,
  ADD COLUMN undo_cursor uuid,
  ADD COLUMN undo_processed integer NOT NULL DEFAULT 0;
ALTER TABLE question_organization_runs DROP CONSTRAINT question_organization_runs_state_check;
ALTER TABLE question_organization_runs ADD CONSTRAINT question_organization_runs_state_check
  CHECK (state IN ('queued','completed','failed','cancelled','undoing','undo_failed','undone'));
ALTER TABLE question_organization_runs ADD CONSTRAINT organization_undo_progress
  CHECK ((undo_processed = 0 AND undo_cursor IS NULL) OR
    (undo_processed BETWEEN 1 AND 5000 AND undo_cursor IS NOT NULL));
ALTER TABLE question_organization_runs ADD CONSTRAINT organization_undo_actor
  CHECK (state NOT IN ('undoing','undo_failed') OR (undo_by IS NOT NULL AND mode = 'apply'));
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
  ELSE
    IF (NEW.run_id,NEW.tenant_id,NEW.question_id,NEW.revision_id,NEW.content_hash,NEW.baseline,NEW.source)
      IS DISTINCT FROM (OLD.run_id,OLD.tenant_id,OLD.question_id,OLD.revision_id,OLD.content_hash,OLD.baseline,OLD.source)
    THEN RAISE EXCEPTION 'Organization item inputs are immutable'; END IF;
    IF OLD.decision IS NOT NULL AND NEW.decision IS DISTINCT FROM OLD.decision
    THEN RAISE EXCEPTION 'Organization receipts are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
