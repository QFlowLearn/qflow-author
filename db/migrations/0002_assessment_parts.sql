ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS brief text,
  ADD COLUMN IF NOT EXISTS grade_level text,
  ADD COLUMN IF NOT EXISTS target_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attachment_id text;

CREATE TABLE IF NOT EXISTS assessment_parts (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  title text NOT NULL,
  position int NOT NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessment_placements (
  id uuid PRIMARY KEY,
  assessment_part_id uuid NOT NULL REFERENCES assessment_parts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  pinned_revision int,
  position int NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessment_parts_assessment_idx ON assessment_parts (assessment_id);
CREATE INDEX IF NOT EXISTS assessment_placements_part_idx ON assessment_placements (assessment_part_id);
