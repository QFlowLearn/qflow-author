CREATE TABLE assessment_canvas_publish_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  connection_id uuid NOT NULL,
  connection_name text NOT NULL,
  connection_base_url text NOT NULL,
  target_id text NOT NULL,
  destination_kind text NOT NULL,
  course_id text NOT NULL,
  question_bank_id text,
  question_bank_name text,
  request_fingerprint text NOT NULL,
  export_receipt_id text NOT NULL REFERENCES assessment_export_receipts(id),
  artifact_storage_key text NOT NULL,
  artifact_filename text NOT NULL,
  artifact_media_type text NOT NULL,
  artifact_sha256 text NOT NULL,
  artifact_byte_length integer NOT NULL,
  phase text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  remote_creation_started_at timestamptz,
  remote_migration_id text,
  remote_progress_url text,
  remote_workflow_state text,
  failure_code text,
  failure_message text,
  remote_identity_resolution text,
  remote_identity_resolved_by uuid REFERENCES users(id),
  remote_identity_resolved_at timestamptz,
  receipt_schema text,
  receipt text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz,
  CONSTRAINT assessment_canvas_publish_attempts_connection_check
    CHECK (
      char_length(connection_name) > 0 AND
      connection_base_url ~ '^https://[^/]+$'
    ),
  CONSTRAINT assessment_canvas_publish_attempts_target_check
    CHECK (target_id IN ('canvas-classic', 'canvas-new-quizzes')),
  CONSTRAINT assessment_canvas_publish_attempts_destination_check
    CHECK (
      char_length(course_id) BETWEEN 1 AND 255 AND
      course_id = btrim(course_id) AND
      course_id !~ '[[:cntrl:]]' AND
      (
        (destination_kind = 'course' AND question_bank_id IS NULL AND question_bank_name IS NULL)
        OR
        (
          destination_kind = 'question-bank' AND
          target_id = 'canvas-classic' AND
          (
            (question_bank_id ~ '^[0-9]{1,30}$' AND question_bank_name IS NULL)
            OR
            (
              question_bank_id IS NULL AND
              char_length(question_bank_name) BETWEEN 1 AND 255 AND
              question_bank_name = btrim(question_bank_name) AND
              question_bank_name !~ '[[:cntrl:]]'
            )
          )
        )
      )
    ),
  CONSTRAINT assessment_canvas_publish_attempts_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT assessment_canvas_publish_attempts_artifact_check
    CHECK (
      artifact_sha256 ~ '^[0-9a-f]{64}$' AND
      artifact_byte_length >= 0 AND
      char_length(artifact_storage_key) > 0 AND
      char_length(artifact_filename) > 0 AND
      char_length(artifact_media_type) > 0
    ),
  CONSTRAINT assessment_canvas_publish_attempts_phase_check
    CHECK (
      phase IN (
        'prepared',
        'claiming-create',
        'creating',
        'uploading',
        'observing',
        'processing',
        'retry-create',
        'retry-upload',
        'retry-observe',
        'remote-identity-unknown',
        'remote-identity-resolved',
        'published',
        'failed'
      )
    ),
  CONSTRAINT assessment_canvas_publish_attempts_attempt_count_check
    CHECK (
      (phase = 'prepared' AND attempt_count = 0)
      OR
      (phase <> 'prepared' AND attempt_count >= 1)
    ),
  CONSTRAINT assessment_canvas_publish_attempts_lease_check
    CHECK (
      (
        phase IN ('claiming-create', 'creating', 'uploading', 'observing') AND
        lease_token IS NOT NULL AND
        lease_expires_at IS NOT NULL
      )
      OR
      (
        phase NOT IN ('claiming-create', 'creating', 'uploading', 'observing') AND
        lease_token IS NULL AND
        lease_expires_at IS NULL
      )
    ),
  CONSTRAINT assessment_canvas_publish_attempts_remote_identity_check
    CHECK (
      (
        (remote_migration_id IS NULL AND remote_progress_url IS NULL)
        OR
        (remote_migration_id IS NOT NULL AND remote_progress_url IS NOT NULL)
      ) AND
      (remote_migration_id IS NULL OR remote_creation_started_at IS NOT NULL) AND
      (remote_migration_id IS NULL OR char_length(remote_migration_id) > 0) AND
      (remote_progress_url IS NULL OR char_length(remote_progress_url) > 0) AND
      (
        phase NOT IN ('uploading', 'observing', 'processing', 'retry-upload', 'retry-observe', 'published')
        OR remote_migration_id IS NOT NULL
      ) AND
      (
        phase NOT IN ('prepared', 'claiming-create', 'creating', 'retry-create', 'remote-identity-unknown', 'remote-identity-resolved')
        OR remote_migration_id IS NULL
      ) AND
      (
        phase NOT IN ('creating', 'uploading', 'observing', 'processing', 'retry-upload', 'retry-observe', 'remote-identity-unknown', 'remote-identity-resolved', 'published')
        OR remote_creation_started_at IS NOT NULL
      ) AND
      (
        phase NOT IN ('prepared', 'claiming-create', 'retry-create')
        OR remote_creation_started_at IS NULL
      )
    ),
  CONSTRAINT assessment_canvas_publish_attempts_failure_check
    CHECK (
      (
        phase IN ('retry-create', 'retry-upload', 'retry-observe', 'remote-identity-unknown', 'remote-identity-resolved', 'failed') AND
        failure_code IS NOT NULL AND
        failure_message IS NOT NULL AND
        char_length(failure_code) > 0 AND
        char_length(failure_message) > 0
      )
      OR
      (
        phase NOT IN ('retry-create', 'retry-upload', 'retry-observe', 'remote-identity-unknown', 'remote-identity-resolved', 'failed') AND
        failure_code IS NULL AND
        failure_message IS NULL
      )
    ),
  CONSTRAINT canvas_publish_remote_identity_resolution_check
    CHECK (
      (
        phase = 'remote-identity-resolved' AND
        remote_identity_resolution IN ('import-found', 'import-not-found') AND
        remote_identity_resolved_by IS NOT NULL AND
        remote_identity_resolved_at IS NOT NULL
      )
      OR
      (
        phase <> 'remote-identity-resolved' AND
        remote_identity_resolution IS NULL AND
        remote_identity_resolved_by IS NULL AND
        remote_identity_resolved_at IS NULL
      )
    ),
  CONSTRAINT assessment_canvas_publish_attempts_receipt_check
    CHECK (
      (
        phase = 'published' AND
        published_at IS NOT NULL AND
        receipt_schema = 'qflow.canvas-publish-receipt.v1' AND
        receipt IS NOT NULL AND
        (receipt::jsonb ->> 'schema') = receipt_schema AND
        (receipt::jsonb ->> 'publishId') = id::text AND
        (receipt::jsonb ->> 'exportReceiptId') = export_receipt_id AND
        (receipt::jsonb ->> 'publishedBy') = created_by::text AND
        (receipt::jsonb -> 'connection' ->> 'id') = connection_id::text AND
        (receipt::jsonb -> 'connection' ->> 'name') = connection_name AND
        (receipt::jsonb -> 'connection' ->> 'baseUrl') = connection_base_url AND
        (receipt::jsonb ->> 'targetId') = target_id AND
        (receipt::jsonb -> 'artifact' ->> 'sha256') = artifact_sha256 AND
        (receipt::jsonb -> 'remote' ->> 'contentMigrationId') = remote_migration_id
      )
      OR
      (
        phase <> 'published' AND
        published_at IS NULL AND
        receipt_schema IS NULL AND
        receipt IS NULL
      )
    )
);

CREATE INDEX canvas_publish_attempts_tenant_assessment_created_idx
  ON assessment_canvas_publish_attempts (tenant_id, assessment_id, created_at DESC);

CREATE INDEX canvas_publish_attempts_tenant_connection_created_idx
  ON assessment_canvas_publish_attempts (tenant_id, connection_id, created_at DESC);

CREATE INDEX canvas_publish_attempts_recovery_idx
  ON assessment_canvas_publish_attempts (
    tenant_id,
    assessment_id,
    target_id,
    phase,
    created_at DESC,
    id DESC
  );
