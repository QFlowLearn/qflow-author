ALTER TABLE assessment_placement_removals
  ADD COLUMN removal_sequence bigint GENERATED ALWAYS AS IDENTITY NOT NULL;

DROP INDEX assessment_placement_removals_actor_idx;
CREATE INDEX assessment_placement_removals_actor_idx
  ON assessment_placement_removals (tenant_id, assessment_id, removed_by, removal_sequence DESC)
  WHERE restored_at IS NULL;
