CREATE TABLE workspace_publication_grants (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES organization_memberships(tenant_id, user_id) ON DELETE CASCADE,
  CHECK (user_id <> '00000000-0000-0000-0000-000000000000')
);

-- Final review records are immutable exact-revision sign-off evidence.
CREATE FUNCTION protect_final_question_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'open' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Final question review evidence is immutable';
  END IF;
  IF (NEW.tenant_id, NEW.question_id, NEW.revision_id, NEW.requested_by, NEW.reviewer_user_id, NEW.requested_at, NEW.change_reason)
    IS DISTINCT FROM
    (OLD.tenant_id, OLD.question_id, OLD.revision_id, OLD.requested_by, OLD.reviewer_user_id, OLD.requested_at, OLD.change_reason) THEN
    RAISE EXCEPTION 'Question review assignment is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_final_question_review BEFORE UPDATE ON question_review_requests
FOR EACH ROW EXECUTE FUNCTION protect_final_question_review();
