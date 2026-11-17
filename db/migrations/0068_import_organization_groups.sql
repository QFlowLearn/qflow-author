ALTER TABLE migration_runs ADD COLUMN organization_groups jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(organization_groups) = 'array');

-- Preserve the existing flat source identities once. Runtime reads only this catalog.
-- This does not reparse accepted sources or infer previously discarded section titles.
UPDATE migration_runs AS run SET organization_groups = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', part->>'id', 'title', part->>'title',
    'hrefs', (SELECT COALESCE(jsonb_agg(placement->>'href'), '[]'::jsonb)
              FROM jsonb_array_elements(part->'placements') AS placement)
  ) ORDER BY position), '[]'::jsonb)
  FROM jsonb_array_elements(run.parts) WITH ORDINALITY AS source(part, position)
);
