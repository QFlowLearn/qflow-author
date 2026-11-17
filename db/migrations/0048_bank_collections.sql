CREATE TABLE bank_collections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (char_length(description) <= 4000),
  position integer NOT NULL CHECK (position >= 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id)
);
CREATE INDEX bank_collections_tenant_position_idx ON bank_collections(tenant_id, position, id);

CREATE TABLE bank_collection_items (
  tenant_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  question_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (collection_id, question_id),
  FOREIGN KEY (collection_id, tenant_id) REFERENCES bank_collections(id, tenant_id),
  FOREIGN KEY (question_id, tenant_id) REFERENCES questions(id, tenant_id)
);
CREATE INDEX bank_collection_items_question_idx ON bank_collection_items(tenant_id, question_id);
CREATE INDEX bank_collection_items_position_idx ON bank_collection_items(collection_id, position, question_id);

CREATE TABLE editorial_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  operation_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_label text NOT NULL,
  action text NOT NULL CHECK (action IN ('Create', 'Update', 'Archive', 'Restore', 'AddItems', 'RemoveItems', 'ReorderItems')),
  collection_id uuid NOT NULL,
  command jsonb NOT NULL CHECK (jsonb_typeof(command) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, operation_id),
  FOREIGN KEY (collection_id, tenant_id) REFERENCES bank_collections(id, tenant_id)
);
CREATE INDEX editorial_events_collection_idx ON editorial_events(tenant_id, collection_id, created_at);
