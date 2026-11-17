-- Replace the classifier contract in storage once; keep original receipt model attribution and charges.
LOCK TABLE question_organization_setups, question_organization_items IN ACCESS EXCLUSIVE MODE;

ALTER TABLE question_organization_setups DISABLE TRIGGER organization_setup_immutable;
UPDATE question_organization_setups SET policy =
  jsonb_set(jsonb_set(jsonb_set(policy,
    '{classifier,kind}', '"clef"'::jsonb),
    '{classifier,config,modelVersion}', '"clef"'::jsonb),
    '{classifier,config,inputMicrosPerMillion}', '240000'::jsonb)
WHERE policy #>> '{classifier,kind}' = 'jev';
ALTER TABLE question_organization_setups ENABLE TRIGGER organization_setup_immutable;

ALTER TABLE question_organization_items DISABLE TRIGGER organization_item_inputs;
UPDATE question_organization_items SET decision = jsonb_set(decision, '{kind}', '"clef"'::jsonb)
WHERE decision->>'kind' = 'jev';
ALTER TABLE question_organization_items ENABLE TRIGGER organization_item_inputs;

ALTER TABLE question_organization_setups ADD CONSTRAINT organization_classifier_kind
  CHECK (policy #>> '{classifier,kind}' IN ('source_only', 'clef'));
ALTER TABLE question_organization_items ADD CONSTRAINT organization_decision_kind
  CHECK (decision IS NULL OR decision->>'kind' IN
    ('source', 'preserved', 'clef', 'unassigned', 'unsupported', 'protected'));
