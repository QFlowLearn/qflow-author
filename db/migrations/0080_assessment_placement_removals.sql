CREATE TABLE assessment_placement_removals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  removed_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  placement_id uuid NOT NULL,
  part_id uuid NOT NULL,
  question_id uuid NOT NULL,
  pinned_revision integer CHECK (pinned_revision > 0),
  blueprint_target_id text,
  position integer NOT NULL CHECK (position > 0),
  title text NOT NULL,
  expected_revision integer NOT NULL CHECK (expected_revision > 0),
  remaining_order jsonb NOT NULL CHECK (jsonb_typeof(remaining_order) = 'array'),
  placement_created_at timestamptz,
  placement_updated_at timestamptz,
  removed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  restored_at timestamptz,
  CHECK (expires_at > removed_at),
  CHECK (restored_at IS NULL OR restored_at >= removed_at)
);
CREATE INDEX assessment_placement_removals_actor_idx
  ON assessment_placement_removals (tenant_id, assessment_id, removed_by, removed_at DESC);
