ALTER TABLE draft_sessions ADD COLUMN kind text;
UPDATE draft_sessions SET kind = 'Revision';
ALTER TABLE draft_sessions ALTER COLUMN kind SET NOT NULL;
ALTER TABLE draft_sessions ALTER COLUMN question_revision_id DROP NOT NULL;
ALTER TABLE draft_sessions ADD COLUMN collection_id uuid;
ALTER TABLE draft_sessions ADD COLUMN published_question_id uuid;
ALTER TABLE draft_sessions ADD CONSTRAINT draft_sessions_binding_check CHECK (
  (kind = 'Revision' AND question_revision_id IS NOT NULL AND collection_id IS NULL AND published_question_id IS NULL) OR
  (kind = 'Bank' AND question_revision_id IS NULL)
);
ALTER TABLE draft_sessions ADD CONSTRAINT draft_sessions_collection_tenant_fk
  FOREIGN KEY (collection_id, tenant_id) REFERENCES bank_collections(id, tenant_id);
ALTER TABLE draft_sessions ADD CONSTRAINT draft_sessions_published_question_tenant_fk
  FOREIGN KEY (published_question_id, tenant_id) REFERENCES questions(id, tenant_id);
