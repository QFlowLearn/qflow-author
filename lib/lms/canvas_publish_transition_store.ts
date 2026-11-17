import { and, eq, gt, lte, or, sql } from 'drizzle-orm';

import { getDb } from '../db.ts';
import { assessmentCanvasPublishAttempts } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import {
  type ActiveCanvasPublishPhase,
  CANVAS_PUBLISH_OPERATION_POLICIES,
  type CanvasPublishAttempt,
  type CanvasPublishFailure,
  type CanvasPublishId,
  type CanvasPublishOperation,
  canvasPublishOperationPolicy,
  type CanvasPublishPhase,
  type CanvasPublishReceipt,
  type CanvasPublishState,
  type CanvasRemoteIdentityResolution,
} from './canvas_publish_contract.ts';
import {
  type CanvasPublishRow,
  parseCanvasPublishRow,
  selectCanvasPublishRow,
} from './canvas_publish_record.ts';
import type { RuntimeSource } from '../runtime.ts';
import {
  type CanvasPublishPersistenceFailure,
  canvasPublishPersistenceFailure,
} from './canvas_publish_persistence_failure.ts';

type CanvasPublishTransitionValues = Partial<
  Pick<
    typeof assessmentCanvasPublishAttempts.$inferInsert,
    | 'phase'
    | 'leaseToken'
    | 'leaseExpiresAt'
    | 'remoteCreationStartedAt'
    | 'remoteMigrationId'
    | 'remoteProgressUrl'
    | 'remoteWorkflowState'
    | 'failureCode'
    | 'failureMessage'
    | 'remoteIdentityResolution'
    | 'remoteIdentityResolvedBy'
    | 'remoteIdentityResolvedAt'
    | 'receiptSchema'
    | 'receipt'
    | 'updatedAt'
    | 'publishedAt'
  >
>;

/** Result of acquiring bounded ownership for one explicit Canvas operation. */
export type ClaimCanvasPublishAttemptResult =
  | {
    readonly ok: true;
    readonly leaseToken: string;
    readonly operation: CanvasPublishOperation;
    readonly attempt: CanvasPublishAttempt;
  }
  | {
    readonly ok: false;
    readonly error:
      | { readonly _tag: 'CanvasPublishNotFound' }
      | { readonly _tag: 'CanvasPublishBusy'; readonly attempt: CanvasPublishAttempt }
      | { readonly _tag: 'CanvasPublishTerminal'; readonly attempt: CanvasPublishAttempt }
      | CanvasPublishPersistenceFailure;
  };

/** Result of a lease-owned Canvas state transition. */
export type UpdateCanvasPublishAttemptResult =
  | { readonly ok: true; readonly attempt: CanvasPublishAttempt }
  | {
    readonly ok: false;
    readonly error:
      | {
        readonly _tag: 'CanvasPublishLeaseLost';
        readonly message: 'The direct Canvas publish lease expired.';
      }
      | CanvasPublishPersistenceFailure;
  };

/** Result of recording the author's Canvas check for an uncertain create operation. */
export type ResolveCanvasRemoteIdentityResult =
  | { readonly ok: true; readonly attempt: CanvasPublishAttempt }
  | {
    readonly ok: false;
    readonly error:
      | { readonly _tag: 'CanvasPublishNotFound'; readonly message: string }
      | { readonly _tag: 'CanvasRemoteIdentityNotOpen'; readonly message: string }
      | CanvasPublishPersistenceFailure;
  };

/** Claims the legal next Canvas operation or returns the current terminal/busy aggregate. */
export async function claimCanvasPublishAttempt(
  auth: RequestContext,
  assessmentId: string,
  publishId: CanvasPublishId,
  now: Date,
  leaseDurationMs: number,
  runtime?: RuntimeSource,
): Promise<ClaimCanvasPublishAttemptResult> {
  try {
    const db = getDb(runtime);
    const uncertain = await markExpiredCreateUnknown(db, auth, assessmentId, publishId, now);
    if (uncertain) {
      return {
        ok: false,
        error: { _tag: 'CanvasPublishTerminal', attempt: parseCanvasPublishRow(uncertain) },
      };
    }

    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(now.valueOf() + leaseDurationMs);
    for (const policy of CANVAS_PUBLISH_OPERATION_POLICIES) {
      const claimedRow = await claimPhase(db, auth, assessmentId, publishId, {
        policy,
        leaseToken,
        leaseExpiresAt,
        now,
      });
      if (claimedRow) return claimed(claimedRow, leaseToken, policy.operation);
    }

    const existing = await selectCanvasPublishRow(db, auth, assessmentId, publishId);
    if (!existing) return { ok: false, error: { _tag: 'CanvasPublishNotFound' } };
    const attempt = parseCanvasPublishRow(existing);
    return isExecutionTerminalState(attempt.state)
      ? { ok: false, error: { _tag: 'CanvasPublishTerminal', attempt } }
      : { ok: false, error: { _tag: 'CanvasPublishBusy', attempt } };
  } catch (cause: unknown) {
    return canvasPublishPersistenceFailure(cause);
  }
}

/** Renews an unexpired lease before one Canvas network operation starts. */
export async function renewCanvasPublishLease(
  auth: RequestContext,
  input: CanvasLeaseIdentity & {
    readonly phase: ActiveCanvasPublishPhase;
    readonly renewedAt: Date;
    readonly leaseDurationMs: number;
  },
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    input.phase,
    {
      leaseExpiresAt: new Date(input.renewedAt.valueOf() + input.leaseDurationMs),
      updatedAt: input.renewedAt,
    },
    runtime,
    input.renewedAt,
  );
}

/** Records the non-replayable boundary immediately before Canvas migration creation. */
export async function markCanvasRemoteCreationStarted(
  auth: RequestContext,
  input: CanvasLeaseIdentity & {
    readonly startedAt: Date;
    readonly leaseDurationMs: number;
  },
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    'claiming-create',
    {
      phase: 'creating',
      remoteCreationStartedAt: input.startedAt,
      leaseExpiresAt: new Date(input.startedAt.valueOf() + input.leaseDurationMs),
      updatedAt: input.startedAt,
    },
    runtime,
    input.startedAt,
  );
}

/** Records the returned migration identity and advances the same lease to package upload. */
export async function recordCanvasRemoteMigration(
  auth: RequestContext,
  input: CanvasLeaseIdentity & {
    readonly contentMigrationId: string;
    readonly progressUrl: string;
    readonly workflowState: string | null;
    readonly updatedAt: Date;
    readonly leaseDurationMs: number;
  },
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    'creating',
    {
      phase: 'uploading',
      remoteMigrationId: input.contentMigrationId,
      remoteProgressUrl: input.progressUrl,
      remoteWorkflowState: input.workflowState,
      leaseExpiresAt: new Date(input.updatedAt.valueOf() + input.leaseDurationMs),
      updatedAt: input.updatedAt,
    },
    runtime,
    input.updatedAt,
  );
}

/** Refreshes the known migration while retaining upload ownership. */
export async function refreshCanvasUploadingMigration(
  auth: RequestContext,
  input: CanvasLeaseIdentity & CanvasRemoteUpdate,
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateRemote(auth, input, 'uploading', 'uploading', runtime);
}

/** Advances a confirmed package upload to read-only progress observation. */
export async function markCanvasUploadAccepted(
  auth: RequestContext,
  input: CanvasLeaseIdentity & { readonly updatedAt: Date; readonly leaseDurationMs: number },
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    'uploading',
    {
      phase: 'observing',
      leaseExpiresAt: new Date(input.updatedAt.valueOf() + input.leaseDurationMs),
      updatedAt: input.updatedAt,
    },
    runtime,
    input.updatedAt,
  );
}

/** Refreshes the known migration while retaining progress-observation ownership. */
export async function refreshCanvasObservedMigration(
  auth: RequestContext,
  input: CanvasLeaseIdentity & CanvasRemoteUpdate,
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateRemote(auth, input, 'observing', 'observing', runtime);
}

/** Releases observation ownership after Canvas reports queued or running. */
export async function markCanvasPublishProcessing(
  auth: RequestContext,
  input: CanvasLeaseIdentity & {
    readonly workflowState: 'queued' | 'running';
    readonly updatedAt: Date;
  },
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    'observing',
    {
      phase: 'processing',
      leaseToken: null,
      leaseExpiresAt: null,
      remoteWorkflowState: input.workflowState,
      updatedAt: input.updatedAt,
    },
    runtime,
    input.updatedAt,
  );
}

/** Releases ownership into one explicit retry phase chosen from the active operation. */
export async function markCanvasPublishRetryable(
  auth: RequestContext,
  input: CanvasLeaseIdentity & {
    readonly resumeFrom: CanvasPublishOperation;
    readonly phase: ActiveCanvasPublishPhase;
    readonly failure: CanvasPublishFailure;
    readonly updatedAt: Date;
  },
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  const transition = canvasPublishOperationPolicy(input.resumeFrom);
  if (!transition.ownedPhases.includes(input.phase)) {
    throw new Error('Canvas retry phase does not belong to the requested operation.');
  }
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    input.phase,
    {
      phase: transition.retryPhase,
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: input.failure.code,
      failureMessage: input.failure.message,
      remoteCreationStartedAt: input.resumeFrom === 'Create' ? null : undefined,
      updatedAt: input.updatedAt,
    },
    runtime,
    input.updatedAt,
  );
}

/** Releases ownership into a terminal failure while preserving any known migration. */
export async function markCanvasPublishFailed(
  auth: RequestContext,
  input: CanvasLeaseIdentity & {
    readonly phase: ActiveCanvasPublishPhase;
    readonly failure: CanvasPublishFailure;
    readonly updatedAt: Date;
  },
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    input.phase,
    {
      phase: 'failed',
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: input.failure.code,
      failureMessage: input.failure.message,
      updatedAt: input.updatedAt,
    },
    runtime,
    input.updatedAt,
  );
}

/** Stops an uncertain migration create without permitting an automatic replay. */
export async function markCanvasRemoteIdentityUnknown(
  auth: RequestContext,
  input: CanvasLeaseIdentity & {
    readonly failure: CanvasPublishFailure;
    readonly updatedAt: Date;
  },
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    'creating',
    {
      phase: 'remote-identity-unknown',
      leaseToken: null,
      leaseExpiresAt: null,
      failureCode: input.failure.code,
      failureMessage: input.failure.message,
      updatedAt: input.updatedAt,
    },
    runtime,
    input.updatedAt,
  );
}

/** Atomically closes an uncertain create after an author records what they found in Canvas. */
export async function resolveCanvasRemoteIdentity(
  auth: RequestContext,
  input: {
    readonly assessmentId: string;
    readonly publishId: CanvasPublishId;
    readonly outcome: CanvasRemoteIdentityResolution['outcome'];
    readonly resolvedAt: Date;
  },
  runtime?: RuntimeSource,
): Promise<ResolveCanvasRemoteIdentityResult> {
  try {
    const db = getDb(runtime);
    const rows = await db.update(assessmentCanvasPublishAttempts).set({
      phase: 'remote-identity-resolved',
      remoteIdentityResolution: input.outcome,
      remoteIdentityResolvedBy: auth.userId,
      remoteIdentityResolvedAt: input.resolvedAt,
      updatedAt: input.resolvedAt,
    }).where(and(
      eq(assessmentCanvasPublishAttempts.id, input.publishId),
      eq(assessmentCanvasPublishAttempts.tenantId, auth.tenantId),
      eq(assessmentCanvasPublishAttempts.assessmentId, input.assessmentId),
      eq(assessmentCanvasPublishAttempts.phase, 'remote-identity-unknown'),
    )).returning();
    if (rows[0]) return { ok: true, attempt: parseCanvasPublishRow(rows[0]) };

    const existing = await selectCanvasPublishRow(db, auth, input.assessmentId, input.publishId);
    if (!existing) {
      return {
        ok: false,
        error: { _tag: 'CanvasPublishNotFound', message: 'Canvas publish not found.' },
      };
    }
    if (
      existing.phase === 'remote-identity-resolved' &&
      existing.remoteIdentityResolution === input.outcome
    ) return { ok: true, attempt: parseCanvasPublishRow(existing) };
    return {
      ok: false,
      error: {
        _tag: 'CanvasRemoteIdentityNotOpen',
        message: 'This Canvas publish no longer needs an uncertain-import decision.',
      },
    };
  } catch (cause: unknown) {
    return canvasPublishPersistenceFailure(cause);
  }
}

/** Atomically seals the immutable Canvas receipt after completed progress is observed. */
export async function markCanvasPublishCompleted(
  auth: RequestContext,
  input: CanvasLeaseIdentity & {
    readonly receipt: CanvasPublishReceipt;
    readonly publishedAt: Date;
  },
  runtime?: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    'observing',
    {
      phase: 'published',
      leaseToken: null,
      leaseExpiresAt: null,
      remoteWorkflowState: 'completed',
      receiptSchema: input.receipt.schema,
      receipt: JSON.stringify(input.receipt),
      failureCode: null,
      failureMessage: null,
      updatedAt: input.publishedAt,
      publishedAt: input.publishedAt,
    },
    runtime,
    input.publishedAt,
  );
}

type CanvasLeaseIdentity = {
  readonly assessmentId: string;
  readonly publishId: CanvasPublishId;
  readonly leaseToken: string;
};

type CanvasRemoteUpdate = {
  readonly contentMigrationId: string;
  readonly progressUrl: string;
  readonly workflowState: string | null;
  readonly updatedAt: Date;
  readonly leaseDurationMs: number;
};

async function updateRemote(
  auth: RequestContext,
  input: CanvasLeaseIdentity & CanvasRemoteUpdate,
  source: ActiveCanvasPublishPhase,
  target: ActiveCanvasPublishPhase,
  runtime: RuntimeSource,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await updateLeaseOwnedAttempt(
    auth,
    input,
    source,
    {
      phase: target,
      remoteMigrationId: input.contentMigrationId,
      remoteProgressUrl: input.progressUrl,
      remoteWorkflowState: input.workflowState,
      leaseExpiresAt: new Date(input.updatedAt.valueOf() + input.leaseDurationMs),
      updatedAt: input.updatedAt,
    },
    runtime,
    input.updatedAt,
  );
}

async function updateLeaseOwnedAttempt(
  auth: RequestContext,
  identity: CanvasLeaseIdentity,
  expectedPhase: ActiveCanvasPublishPhase,
  values: CanvasPublishTransitionValues,
  runtime: RuntimeSource,
  requireUnexpiredAt?: Date,
): Promise<UpdateCanvasPublishAttemptResult> {
  try {
    const conditions = [
      eq(assessmentCanvasPublishAttempts.id, identity.publishId),
      eq(assessmentCanvasPublishAttempts.tenantId, auth.tenantId),
      eq(assessmentCanvasPublishAttempts.assessmentId, identity.assessmentId),
      eq(assessmentCanvasPublishAttempts.phase, expectedPhase),
      eq(assessmentCanvasPublishAttempts.leaseToken, identity.leaseToken),
    ];
    if (requireUnexpiredAt) {
      conditions.push(gt(assessmentCanvasPublishAttempts.leaseExpiresAt, requireUnexpiredAt));
    }
    const rows = await getDb(runtime).update(assessmentCanvasPublishAttempts).set(values).where(
      and(...conditions),
    ).returning();
    return rows[0] ? { ok: true, attempt: parseCanvasPublishRow(rows[0]) } : leaseLost();
  } catch (cause: unknown) {
    return canvasPublishPersistenceFailure(cause);
  }
}

async function markExpiredCreateUnknown(
  db: ReturnType<typeof getDb>,
  auth: RequestContext,
  assessmentId: string,
  publishId: CanvasPublishId,
  now: Date,
): Promise<CanvasPublishRow | null> {
  const rows = await db.update(assessmentCanvasPublishAttempts).set({
    phase: 'remote-identity-unknown',
    leaseToken: null,
    leaseExpiresAt: null,
    failureCode: 'CanvasRemoteIdentityUnknown',
    failureMessage:
      'Canvas may have created the import, but QFlowLearn did not receive its ID. Check the course before starting a new publish.',
    updatedAt: now,
  }).where(and(
    eq(assessmentCanvasPublishAttempts.id, publishId),
    eq(assessmentCanvasPublishAttempts.tenantId, auth.tenantId),
    eq(assessmentCanvasPublishAttempts.assessmentId, assessmentId),
    eq(assessmentCanvasPublishAttempts.phase, 'creating'),
    lte(assessmentCanvasPublishAttempts.leaseExpiresAt, now),
  )).returning();
  return rows[0] ?? null;
}

async function claimPhase(
  db: ReturnType<typeof getDb>,
  auth: RequestContext,
  assessmentId: string,
  publishId: CanvasPublishId,
  input: {
    readonly policy: {
      readonly sourcePhases: readonly CanvasPublishPhase[];
      readonly activePhase: ActiveCanvasPublishPhase;
    };
    readonly leaseToken: string;
    readonly leaseExpiresAt: Date;
    readonly now: Date;
  },
): Promise<CanvasPublishRow | null> {
  const rows = await db.update(assessmentCanvasPublishAttempts).set({
    phase: input.policy.activePhase,
    attemptCount: sql`${assessmentCanvasPublishAttempts.attemptCount} + 1`,
    leaseToken: input.leaseToken,
    leaseExpiresAt: input.leaseExpiresAt,
    failureCode: null,
    failureMessage: null,
    updatedAt: input.now,
  }).where(and(
    eq(assessmentCanvasPublishAttempts.id, publishId),
    eq(assessmentCanvasPublishAttempts.tenantId, auth.tenantId),
    eq(assessmentCanvasPublishAttempts.assessmentId, assessmentId),
    or(
      ...input.policy.sourcePhases.map((phase) =>
        phase === input.policy.activePhase
          ? and(
            eq(assessmentCanvasPublishAttempts.phase, phase),
            lte(assessmentCanvasPublishAttempts.leaseExpiresAt, input.now),
          )
          : eq(assessmentCanvasPublishAttempts.phase, phase)
      ),
    ),
  )).returning();
  return rows[0] ?? null;
}

function claimed(
  row: CanvasPublishRow,
  leaseToken: string,
  operation: CanvasPublishOperation,
): ClaimCanvasPublishAttemptResult {
  return { ok: true, leaseToken, operation, attempt: parseCanvasPublishRow(row) };
}

function isExecutionTerminalState(state: CanvasPublishState): boolean {
  return state._tag === 'Published' ||
    state._tag === 'Failed' ||
    state._tag === 'RemoteIdentityResolved' ||
    state._tag === 'RemoteIdentityUnknown';
}

function leaseLost(): UpdateCanvasPublishAttemptResult {
  return {
    ok: false,
    error: {
      _tag: 'CanvasPublishLeaseLost',
      message: 'The direct Canvas publish lease expired.',
    },
  };
}
