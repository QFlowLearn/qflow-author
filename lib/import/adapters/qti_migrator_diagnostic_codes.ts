import type { MigrationWarningCode } from '../migration_warning_catalog.ts';

/** Exact migration warning codes accepted from qti3-migrator. */
export const QTI_MIGRATOR_DIAGNOSTIC_CODES = {
  qti12_bank_points_unassigned: 'CANVAS_BANK_POINTS_UNASSIGNED',
  qti12_feedback_review: 'LMS_CONTENT_REVIEW',
  qti12_manual_points_review: 'QTI12_MANUAL_POINTS_REVIEW',
  assessment_test_structure_not_migrated: 'QTI_ASSESSMENT_STRUCTURE_FLATTENED',
  qti12_associate_correct_response_missing_repaired:
    'QTI12_ASSOCIATE_CORRECT_RESPONSE_MISSING_REPAIRED',
  qti12_choice_correct_response_missing_repaired: 'QTI12_CHOICE_CORRECT_RESPONSE_MISSING_REPAIRED',
  qti2_choice_correct_response_missing_repaired: 'QTI2_CHOICE_CORRECT_RESPONSE_MISSING_REPAIRED',
  qti12_composite_responses_unsupported: 'QTI12_COMPOSITE_RESPONSES_UNSUPPORTED',
  qti12_material_not_preserved: 'QTI12_MATERIAL_NOT_PRESERVED',
  qti12_response_processing_unsupported: 'QTI12_RESPONSE_PROCESSING_UNSUPPORTED',
  qti2_response_processing_not_preserved: 'QTI2_RESPONSE_PROCESSING_NOT_PRESERVED',
  qti2_outcomes_not_preserved: 'QTI2_OUTCOMES_NOT_PRESERVED',
  writer_diagnostics: 'QTI_MIGRATION_WRITER_REJECTED',
  unsupported_item_stubbed: 'UNSUPPORTED_ITEM_STUBBED',
} as const satisfies Readonly<Record<string, MigrationWarningCode>>;
