ALTER TABLE instructor_authoring_defaults
  ALTER COLUMN answer_choice_order DROP NOT NULL,
  ADD COLUMN maximum_score double precision,
  ADD CONSTRAINT instructor_defaults_nonempty
    CHECK (answer_choice_order IS NOT NULL OR maximum_score IS NOT NULL),
  ADD CONSTRAINT instructor_defaults_points_finite
    CHECK (maximum_score IS NULL OR
      (maximum_score >= 0 AND maximum_score < 'Infinity'::double precision));
