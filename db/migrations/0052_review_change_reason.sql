ALTER TABLE question_review_requests ADD COLUMN change_reason text;
ALTER TABLE question_review_requests ADD CONSTRAINT question_review_change_reason_check
  CHECK (change_reason IS NULL OR (length(btrim(change_reason)) BETWEEN 1 AND 4000));
