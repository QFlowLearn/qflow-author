ALTER TABLE assessments
  ADD COLUMN blueprint jsonb NOT NULL
    DEFAULT '{"_tag":"Unspecified","version":1}'::jsonb;

ALTER TABLE assessments
  ALTER COLUMN blueprint DROP DEFAULT,
  ADD CONSTRAINT assessments_blueprint_state_check CHECK (
    blueprint->>'_tag' IN ('Unspecified', 'Defined') AND
    blueprint->>'version' = '1'
  );

ALTER TABLE migration_runs
  ADD COLUMN blueprint jsonb NOT NULL
    DEFAULT '{"_tag":"Unspecified","version":1}'::jsonb;

ALTER TABLE migration_runs
  ALTER COLUMN blueprint DROP DEFAULT,
  ADD CONSTRAINT migration_runs_blueprint_state_check CHECK (
    blueprint->>'_tag' IN ('Unspecified', 'Defined') AND
    blueprint->>'version' = '1'
  );

ALTER TABLE assessment_placements
  ADD COLUMN blueprint_target_id text;

ALTER TABLE migration_items
  ADD COLUMN blueprint_target_id text,
  ADD COLUMN review_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE migration_items
  ALTER COLUMN review_suggestions DROP DEFAULT;

ALTER TABLE question_revisions
  ADD COLUMN review_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE question_revisions
  ALTER COLUMN review_suggestions DROP DEFAULT;
