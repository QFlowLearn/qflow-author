-- Human corrections and undo use the same dispatcher without creating an AI budget.
ALTER TABLE bank_enrichment_tasks ADD COLUMN budget_id uuid;
ALTER TABLE bank_enrichment_tasks DISABLE TRIGGER enrichment_task_immutable;
UPDATE bank_enrichment_tasks SET budget_id = id;
ALTER TABLE bank_enrichment_tasks ENABLE TRIGGER enrichment_task_immutable;
ALTER TABLE bank_enrichment_tasks DROP CONSTRAINT bank_enrichment_tasks_id_tenant_id_fkey;
ALTER TABLE bank_enrichment_tasks DROP CONSTRAINT bank_enrichment_tasks_kind_check;
ALTER TABLE bank_enrichment_tasks ADD CONSTRAINT enrichment_task_kind
  CHECK (kind IN ('preview', 'classify', 'correct', 'undo'));
ALTER TABLE bank_enrichment_tasks ADD CONSTRAINT enrichment_task_budget_identity
  CHECK ((kind IN ('preview', 'classify')) = (budget_id IS NOT NULL)
    AND (budget_id IS NULL OR budget_id = id));
ALTER TABLE bank_enrichment_tasks ADD CONSTRAINT enrichment_task_budget_fk
  FOREIGN KEY (budget_id, tenant_id) REFERENCES bank_enrichment_budgets(id, tenant_id);
ALTER TABLE bank_enrichment_tasks ADD CONSTRAINT enrichment_task_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Human operations may run alongside AI; each dimension still uses captured change tokens.
DROP INDEX enrichment_one_active_scheme_idx;
CREATE UNIQUE INDEX enrichment_one_active_scheme_idx
  ON bank_enrichment_runs(tenant_id, scheme_id)
  WHERE kind = 'classify' AND state IN ('queued', 'running');

-- Restoring a previously missing value retains an undo token and the complete history.
ALTER TABLE bank_enrichment_changes ADD CONSTRAINT enrichment_absence_is_undo
  CHECK (value ->> 'state' <> 'absent' OR (
    value = '{"state":"absent"}'::jsonb AND origin = 'undo' AND previous_change_id IS NOT NULL
  ));
CREATE INDEX enrichment_change_operation_lookup_idx
  ON bank_enrichment_changes(tenant_id, operation_id, question_id, dimension);
