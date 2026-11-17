import type { MigrationWarningPolicy } from './migration_warning_policy.ts';
/** Source rules which require an explicit authoring decision before acceptance. */
export const LMS_MIGRATION_WARNING_POLICIES = {
  LMS_SCORING_REVIEW: {
    title: 'Rebuild the source scoring rule',
    severity: 'correction',
    blocksAcceptance: true,
    meaning:
      'The source scoring rule is retained in the original file but cannot be represented by this draft.',
    reviewAction:
      'Compare the original rule and rebuild scoring explicitly before accepting the question.',
  },
  LMS_MEDIA_REVIEW: {
    title: 'Restore source media',
    severity: 'correction',
    blocksAcceptance: true,
    meaning: 'A source media file cannot be resolved safely in its original text field.',
    reviewAction:
      'Restore the missing or conflicting file in the original export and import it again.',
  },
  LMS_CONTENT_REVIEW: {
    title: 'Review retained source content',
    severity: 'review',
    blocksAcceptance: false,
    meaning:
      'Some source content or delivery settings require a deliberate review after conversion.',
    reviewAction:
      'Compare the retained source details and configure the required content or delivery behavior.',
  },
  LMS_MANUAL_POINTS_REVIEW: {
    title: 'Configure manual points in delivery',
    severity: 'review',
    blocksAcceptance: false,
    meaning: 'Source essay points are retained in scorer guidance.',
    reviewAction: 'Use the scorer guidance to configure the manual point ceiling in delivery.',
  },
} as const satisfies Readonly<Record<string, MigrationWarningPolicy>>;
