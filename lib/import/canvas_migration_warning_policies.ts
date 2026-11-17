import type { MigrationWarningPolicy } from './migration_warning_policy.ts';

/** Disclosed Canvas conversion limits retained with the reviewed questions. */
export const CANVAS_MIGRATION_WARNING_POLICIES = {
  CANVAS_BANK_POINTS_UNASSIGNED: {
    title: 'Assign the bank question points',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The question content and original percentage program are retained, but the source bank has no assigned point ceiling.',
    reviewAction:
      'Assign points in Canvas or the exported source and import again before accepting this question.',
  },
  CANVAS_GROUP_SELECTION_REVIEW: {
    title: 'Review the fixed-question conversion',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'Random groups become fixed questions. Source draws and group point overrides are recorded in the receipt.',
    reviewAction:
      'Set the intended question points before delivery, or use the original Canvas quiz for random draws.',
  },
  QTI_RESOURCE_ASSET_REVIEW: {
    title: 'Restore required resource media',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A required media reference in this converted question is invalid or missing.',
    reviewAction: 'Restore the referenced source file or correct its URL and import again.',
  },
  CANVAS_ASSESSMENT_SETTINGS_REVIEW: {
    title: 'Review Canvas quiz settings',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'Canvas quiz settings are retained in the original package rather than applied to delivery.',
    reviewAction:
      'Configure timing, attempts and feedback release before publishing the assessment.',
  },
  QTI12_MANUAL_POINTS_REVIEW: {
    title: 'Review the manual point ceiling',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'The response and manual grading are retained. Source points are preserved in scorer guidance.',
    reviewAction: 'Use the scorer guidance to configure the manual point ceiling in delivery.',
  },
} as const satisfies Readonly<Record<string, MigrationWarningPolicy>>;
