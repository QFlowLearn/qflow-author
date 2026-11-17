ALTER TABLE migration_runs ADD COLUMN destination text;
ALTER TABLE migration_runs ADD COLUMN collection_id uuid;
UPDATE migration_runs SET destination = 'Assessment';
ALTER TABLE migration_runs ALTER COLUMN destination SET NOT NULL;
ALTER TABLE migration_runs ALTER COLUMN blueprint DROP NOT NULL;
ALTER TABLE migration_runs ADD CONSTRAINT migration_runs_collection_tenant_fk
  FOREIGN KEY (collection_id, tenant_id) REFERENCES bank_collections (id, tenant_id);
ALTER TABLE migration_runs ADD CONSTRAINT migration_runs_destination_check CHECK (
  (destination = 'Assessment' AND blueprint IS NOT NULL AND collection_id IS NULL) OR
  (destination = 'WorkspaceBank' AND blueprint IS NULL AND assessment_id IS NULL)
);
ALTER TABLE migration_runs DROP CONSTRAINT migration_runs_terminal_state_check;
ALTER TABLE migration_runs ADD CONSTRAINT migration_runs_terminal_state_check CHECK (
  (status = 'committed' AND committed_at IS NOT NULL AND
    (destination = 'WorkspaceBank' OR assessment_id IS NOT NULL)) OR
  (status <> 'committed' AND assessment_id IS NULL AND committed_at IS NULL)
);
