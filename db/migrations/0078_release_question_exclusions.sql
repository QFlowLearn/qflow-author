-- Earlier Sakai builds were all-or-nothing. Their retained artifacts excluded no questions.
-- Extend stored evidence once without changing package bytes, hashes, pins, or acknowledgements.
LOCK TABLE release_artifacts, release_build_attempts IN ACCESS EXCLUSIVE MODE;
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE release_artifacts DISABLE TRIGGER release_artifact_guard;
UPDATE release_artifacts SET receipt = receipt || '{"excluded":[]}'::jsonb
WHERE receipt IS NOT NULL AND NOT (receipt ? 'excluded');
ALTER TABLE release_artifacts ENABLE TRIGGER release_artifact_guard;

ALTER TABLE release_build_attempts DISABLE TRIGGER release_build_attempt_guard;
UPDATE release_build_attempts SET report = report || '{"excluded":[]}'::jsonb
WHERE report IS NOT NULL AND NOT (report ? 'excluded');
ALTER TABLE release_build_attempts ENABLE TRIGGER release_build_attempt_guard;
