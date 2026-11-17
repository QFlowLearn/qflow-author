/** Retryable durable-job failure with a stable safe code and message. */
export type RetryableJobFailure<Code extends string = string> = {
  readonly _tag: 'Retryable';
  readonly code: Code;
  readonly message: string;
};

/** Permanent durable-job failure with a stable safe code and message. */
export type PermanentJobFailure<Code extends string = string> = {
  readonly _tag: 'Permanent';
  readonly code: Code;
  readonly message: string;
};

/** Lost ownership outcome for a durable-job attempt. */
export type LeaseLostJobFailure<Code extends string = string> = {
  readonly _tag: 'LeaseLost';
  readonly code: Code;
  readonly message: string;
};

/** Result of settling a terminal Workflow against its durable domain job. */
export type WorkflowTerminalDomainOutcome =
  | { readonly _tag: 'Failed' }
  | { readonly _tag: 'AlreadyFailed' }
  | { readonly _tag: 'AlreadyCompleted' }
  | { readonly _tag: 'JobMissing' };
