CREATE TABLE assessment_delivery_publish_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  export_receipt_id text NOT NULL REFERENCES assessment_export_receipts(id),
  preflight_id text NOT NULL,
  request jsonb NOT NULL,
  phase text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  failure_code text,
  failure_message text,
  response jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz,
  CONSTRAINT assessment_delivery_publish_attempts_phase_check
    CHECK (phase IN ('prepared', 'publishing', 'retryable', 'published')),
  CONSTRAINT assessment_delivery_publish_attempts_preflight_id_check
    CHECK (preflight_id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT assessment_delivery_publish_attempts_request_check
    CHECK (
      jsonb_typeof(request) = 'object' AND
      request ? 'publishId' AND
      request ? 'qflowTenantId' AND
      request ? 'qflowAssessmentId' AND
      request ? 'packageUrl' AND
      (request ->> 'publishId') = 'qflow-' || id::text AND
      (request ->> 'qflowTenantId') = tenant_id::text AND
      (request ->> 'qflowAssessmentId') = assessment_id::text AND
      char_length(request ->> 'packageUrl') > 0
    ),
  CONSTRAINT assessment_delivery_publish_attempts_state_check
    CHECK (
      (
        phase = 'prepared' AND
        attempt_count = 0 AND
        lease_token IS NULL AND
        lease_expires_at IS NULL AND
        failure_code IS NULL AND
        failure_message IS NULL AND
        response IS NULL AND
        published_at IS NULL
      ) OR (
        phase = 'publishing' AND
        attempt_count >= 1 AND
        lease_token IS NOT NULL AND
        lease_expires_at IS NOT NULL AND
        failure_code IS NULL AND
        failure_message IS NULL AND
        response IS NULL AND
        published_at IS NULL
      ) OR (
        phase = 'retryable' AND
        attempt_count >= 1 AND
        lease_token IS NULL AND
        lease_expires_at IS NULL AND
        failure_code IS NOT NULL AND
        failure_message IS NOT NULL AND
        char_length(failure_code) BETWEEN 1 AND 120 AND
        char_length(failure_message) BETWEEN 1 AND 1000 AND
        response IS NULL AND
        published_at IS NULL
      ) OR (
        phase = 'published' AND
        attempt_count >= 1 AND
        lease_token IS NULL AND
        lease_expires_at IS NULL AND
        failure_code IS NULL AND
        failure_message IS NULL AND
        response IS NOT NULL AND
        jsonb_typeof(response) = 'object' AND
        response ? 'publishId' AND
        response ? 'status' AND
        (response ->> 'publishId') = (request ->> 'publishId') AND
        (response ->> 'status') = 'published' AND
        published_at IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX delivery_publish_attempts_preflight_unique_idx
  ON assessment_delivery_publish_attempts (tenant_id, assessment_id, preflight_id);

CREATE INDEX delivery_publish_attempts_tenant_assessment_created_idx
  ON assessment_delivery_publish_attempts (tenant_id, assessment_id, created_at DESC);
