CREATE TABLE assessment_question_defaults (
  assessment_id uuid PRIMARY KEY REFERENCES assessments(id) ON DELETE CASCADE,
  maximum_score double precision NOT NULL,
  CONSTRAINT assessment_question_defaults_points_finite
    CHECK (maximum_score >= 0 AND maximum_score < 'Infinity'::double precision)
);
