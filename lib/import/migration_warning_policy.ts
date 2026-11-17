/** Review severity shared by every migration warning policy. */
export type MigrationWarningSeverity = 'info' | 'review' | 'correction';

/** User-facing review and acceptance policy for one migration warning. */
export type MigrationWarningPolicy = {
  readonly title: string;
  readonly severity: MigrationWarningSeverity;
  readonly blocksAcceptance: boolean;
  readonly meaning: string;
  readonly reviewAction: string;
};
