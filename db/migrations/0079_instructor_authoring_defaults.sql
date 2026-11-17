CREATE TABLE instructor_authoring_defaults (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer_choice_order text NOT NULL CHECK (answer_choice_order IN ('authored', 'shuffled')),
  PRIMARY KEY (tenant_id, user_id)
);
