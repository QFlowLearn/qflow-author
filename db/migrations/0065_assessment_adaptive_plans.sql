CREATE TABLE assessment_adaptive_plans (
  assessment_id uuid PRIMARY KEY REFERENCES assessments(id) ON DELETE CASCADE,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
