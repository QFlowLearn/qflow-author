import {
  type LeaseLostJobFailure,
  type PermanentJobFailure,
  type RetryableJobFailure,
} from '../job_failure.ts';

type MigrationFailureDisposition = 'lease_lost' | 'permanent' | 'retryable';

const MIGRATION_FAILURE_POLICY = {
  source_read_unavailable: {
    disposition: 'retryable',
    message: 'QFlowLearn could not read the preserved source.',
  },
  source_parse_invalid: {
    disposition: 'permanent',
    message: 'QFlowLearn could not read this source with the selected format.',
  },
  source_contains_no_items: {
    disposition: 'permanent',
    message: 'This source does not contain any assessment questions.',
  },
  source_evidence_invalid: {
    disposition: 'permanent',
    message: 'QFlowLearn could not build a consistent review record from this source.',
  },
  source_write_unavailable: {
    disposition: 'retryable',
    message: 'QFlowLearn could not preserve the prepared source.',
  },
  persistence_unavailable: {
    disposition: 'retryable',
    message: 'QFlowLearn could not save or reload the source analysis.',
  },
  processing_cancelled: {
    disposition: 'retryable',
    message: 'Source processing stopped before it finished.',
  },
  lease_lost: {
    disposition: 'lease_lost',
    message: 'Another worker owns this source-processing attempt.',
  },
  unexpected_failure: {
    disposition: 'retryable',
    message: 'QFlowLearn could not finish source processing because an internal dependency failed.',
  },
} as const satisfies Record<
  string,
  { readonly disposition: MigrationFailureDisposition; readonly message: string }
>;

/** Stable failure codes emitted by source processing. */
export type MigrationProcessingFailureCode = keyof typeof MIGRATION_FAILURE_POLICY;

type MigrationFailurePolicy = typeof MIGRATION_FAILURE_POLICY;
type CodesWithDisposition<Disposition extends MigrationFailureDisposition> = {
  [Code in MigrationProcessingFailureCode]: MigrationFailurePolicy[Code]['disposition'] extends
    Disposition ? Code : never;
}[MigrationProcessingFailureCode];

/** Codes that stop source processing without another attempt. */
export type PermanentMigrationFailureCode = CodesWithDisposition<'permanent'>;

/** Codes eligible for another source-processing attempt. */
export type RetryableMigrationFailureCode = CodesWithDisposition<'retryable'>;

const MIGRATION_RETRY_DELAYS = {
  source_read_unavailable: '30 seconds',
  source_write_unavailable: '30 seconds',
  persistence_unavailable: '15 seconds',
  processing_cancelled: '10 seconds',
  unexpected_failure: '30 seconds',
} as const satisfies Record<RetryableMigrationFailureCode, string>;

type LeaseLostMigrationFailureCode = CodesWithDisposition<'lease_lost'>;

/** Retryable source-processing failure with its retained dependency cause. */
export type RetryableMigrationFailure =
  & RetryableJobFailure<RetryableMigrationFailureCode>
  & { readonly cause: unknown };

/** Permanent source-processing failure with its retained dependency cause. */
export type PermanentMigrationFailure =
  & PermanentJobFailure<PermanentMigrationFailureCode>
  & { readonly cause: unknown };

/** Lost migration lease control outcome with its retained cause. */
export type LeaseLostMigrationFailure =
  & LeaseLostJobFailure<LeaseLostMigrationFailureCode>
  & { readonly cause: unknown };

/** Expected source-processing failures with one catalog-owned retry decision and safe message. */
export type MigrationProcessingFailure =
  | RetryableMigrationFailure
  | PermanentMigrationFailure
  | LeaseLostMigrationFailure;

/** Failures that may terminally end one source-processing attempt. */
export type TerminalMigrationFailure =
  | RetryableMigrationFailure
  | PermanentMigrationFailure;

/** Typed result returned by the source processor. */
export type MigrationProcessingResult<T> =
  | { readonly _tag: 'Success'; readonly value: T }
  | { readonly _tag: 'Failure'; readonly failure: MigrationProcessingFailure };

/** Construct a catalog-defined permanent source-processing failure. */
export function permanentMigrationFailure(
  code: PermanentMigrationFailureCode,
  cause: unknown,
): PermanentMigrationFailure {
  return {
    _tag: 'Permanent',
    code,
    message: MIGRATION_FAILURE_POLICY[code].message,
    cause,
  };
}

/** Construct a catalog-defined retryable source-processing failure. */
export function retryableMigrationFailure(
  code: RetryableMigrationFailureCode,
  cause: unknown,
): RetryableMigrationFailure {
  return {
    _tag: 'Retryable',
    code,
    message: MIGRATION_FAILURE_POLICY[code].message,
    cause,
  };
}

/** Construct a lost-lease control outcome. */
export function migrationLeaseLost(cause: unknown): LeaseLostMigrationFailure {
  return {
    _tag: 'LeaseLost',
    code: 'lease_lost',
    message: MIGRATION_FAILURE_POLICY.lease_lost.message,
    cause,
  };
}

/** Translate an unexpected thrown value without exposing its message. */
export function unexpectedMigrationFailure(cause: unknown): MigrationProcessingFailure {
  if (isAbortCause(cause)) {
    return retryableMigrationFailure('processing_cancelled', cause);
  }
  return retryableMigrationFailure('unexpected_failure', cause);
}

/** Return the catalog-approved summary for logs and persistence. */
export function migrationFailureSummary(failure: MigrationProcessingFailure): string {
  return failure.message;
}

/** Return the durable wait applied before another source-processing attempt. */
export function migrationRetryDelay(
  code: RetryableMigrationFailureCode,
): (typeof MIGRATION_RETRY_DELAYS)[RetryableMigrationFailureCode] {
  return MIGRATION_RETRY_DELAYS[code];
}

function isAbortCause(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}
