ALTER TABLE migration_items
  ADD COLUMN review_state text NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN review_note text,
  ADD COLUMN reviewed_by uuid,
  ADD COLUMN reviewed_at timestamptz;

CREATE INDEX migration_items_review_state_idx ON migration_items (review_state);
