ALTER TABLE question_organization_runs DROP CONSTRAINT organization_undo_progress;
ALTER TABLE question_organization_runs ADD CONSTRAINT organization_undo_progress
  CHECK ((undo_processed = 0 AND undo_cursor IS NULL) OR
    (undo_processed BETWEEN 1 AND 10000 AND undo_cursor IS NOT NULL));
