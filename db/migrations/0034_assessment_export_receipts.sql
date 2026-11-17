CREATE TABLE assessment_export_receipts (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  created_by uuid NOT NULL,
  authorized_by uuid NOT NULL,
  preflight_id text NOT NULL,
  target_id text NOT NULL,
  scoring_selection text NOT NULL,
  interaction_selection text NOT NULL,
  acknowledgement_token text,
  schema text NOT NULL,
  receipt text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT assessment_export_receipts_id_check
    CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT assessment_export_receipts_preflight_id_check
    CHECK (preflight_id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT assessment_export_receipts_acknowledgement_token_check
    CHECK (
      acknowledgement_token IS NULL OR
      acknowledgement_token ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT assessment_export_receipts_scoring_selection_check
    CHECK (scoring_selection IN ('automatic', 'manual-accepted')),
  CONSTRAINT assessment_export_receipts_interaction_selection_check
    CHECK (interaction_selection IN ('preserve', 'fallback-accepted')),
  CONSTRAINT assessment_export_receipts_schema_check
    CHECK (schema = 'qflow.export-receipt.v1'),
  CONSTRAINT assessment_export_receipts_document_check
    CHECK (
      (receipt::jsonb ->> 'receiptId') = id AND
      (receipt::jsonb ->> 'schema') = schema AND
      (receipt::jsonb ->> 'authorizedBy') = authorized_by::text AND
      (receipt::jsonb ->> 'preflightId') = preflight_id AND
      (receipt::jsonb -> 'assessment' ->> 'id') = assessment_id::text AND
      (receipt::jsonb -> 'target' ->> 'destinationId') = target_id AND
      (
        (
          scoring_selection = 'automatic' AND
          (receipt::jsonb -> 'requirements' -> 'scoring' ->> '_tag') =
            'AutomaticScoringRequired'
        ) OR
        (
          scoring_selection = 'manual-accepted' AND
          (receipt::jsonb -> 'requirements' -> 'scoring' ->> '_tag') =
            'ManualScoringAccepted'
        )
      ) AND
      (
        (
          interaction_selection = 'preserve' AND
          (receipt::jsonb -> 'requirements' -> 'interaction' ->> '_tag') =
            'BehaviorMustBePreserved'
        ) OR
        (
          interaction_selection = 'fallback-accepted' AND
          (receipt::jsonb -> 'requirements' -> 'interaction' ->> '_tag') =
            'DiagnosedFallbackAccepted'
        )
      ) AND
      (
        (
          acknowledgement_token IS NULL AND
          jsonb_array_length(receipt::jsonb -> 'acknowledgements') = 0
        ) OR
        (
          acknowledgement_token IS NOT NULL AND
          (receipt::jsonb -> 'acknowledgements' -> 0 ->> 'token') =
            acknowledgement_token
        )
      )
    )
);

CREATE INDEX assessment_export_receipts_tenant_assessment_created_idx
  ON assessment_export_receipts (tenant_id, assessment_id, created_at);
