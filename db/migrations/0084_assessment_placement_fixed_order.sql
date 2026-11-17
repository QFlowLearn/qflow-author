ALTER TABLE assessment_placements
  ADD COLUMN fixed boolean NOT NULL DEFAULT false;

ALTER TABLE assessment_placement_removals
  ADD COLUMN fixed boolean NOT NULL DEFAULT false;
