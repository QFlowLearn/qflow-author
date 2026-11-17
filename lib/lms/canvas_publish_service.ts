import type { ObjectReader } from '../storage_contract.ts';
import type { RequestContext } from '../tenants.ts';
import { readMaterializedAssessmentExportArtifact } from '../export/assessment_export_artifact.ts';
import {
  type CanvasConnectorFailure,
  type CanvasContentMigration,
  type CanvasUploadContract,
  createCanvasQtiMigration,
  getCanvasContentMigration,
  getCanvasImportProgress,
  refreshCanvasQtiMigrationUpload,
  uploadCanvasQtiPackage,
} from './canvas_api.ts';
import { authorizeCanvasConnection } from './canvas_connections.ts';
import type { AuthorizedCanvasConnection } from './canvas_connection_types.ts';
import {
  type ActiveCanvasPublishPhase,
  type CanvasPublishAttempt,
  type CanvasPublishFailure,
  type CanvasPublishId,
  type CanvasPublishOperation,
  canvasPublishOperationPolicy,
  type CanvasPublishRemote,
  createCanvasPublishReceipt,
} from './canvas_publish_contract.ts';
import type { RuntimeSource } from '../runtime.ts';
import {
  claimCanvasPublishAttempt,
  markCanvasPublishCompleted,
  markCanvasPublishFailed,
  markCanvasPublishProcessing,
  markCanvasPublishRetryable,
  markCanvasRemoteCreationStarted,
  markCanvasRemoteIdentityUnknown,
  markCanvasUploadAccepted,
  recordCanvasRemoteMigration,
  refreshCanvasObservedMigration,
  refreshCanvasUploadingMigration,
  renewCanvasPublishLease,
  type UpdateCanvasPublishAttemptResult,
} from './canvas_publish_transition_store.ts';

export type CanvasPublishServiceOptions = {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
  readonly requestTimeoutMs?: number;
};

/** Expected service result for one create or resume request. */
export type AdvanceCanvasPublishResult =
  | { readonly ok: true; readonly attempt: CanvasPublishAttempt }
  | {
    readonly ok: false;
    readonly error: {
      readonly _tag:
        | 'CanvasPublishNotFound'
        | 'CanvasPublishPersistenceFailed'
        | 'CanvasPublishLeaseLost';
      readonly message: string;
      readonly cause?: unknown;
    };
  };

type AdvanceInput = {
  readonly assessmentId: string;
  readonly publishId: CanvasPublishId;
  readonly storage: ObjectReader;
  readonly runtime?: RuntimeSource;
};

type CanvasPublishExecution = {
  readonly auth: RequestContext;
  readonly input: AdvanceInput;
  readonly leaseToken: string;
  readonly connection: AuthorizedCanvasConnection;
  readonly clock: () => Date;
  readonly fetchImpl?: typeof fetch;
  readonly callerSignal?: AbortSignal;
  readonly requestTimeoutMs: number;
};

type CanvasPackage = {
  readonly filename: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
};

const LEASE_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 90 * 1000;

/** Claims and advances one durable Canvas operation without touching the canonical assessment. */
export async function advanceCanvasPublish(
  auth: RequestContext,
  input: AdvanceInput,
  options: CanvasPublishServiceOptions = {},
): Promise<AdvanceCanvasPublishResult> {
  const clock = options.now ?? (() => new Date());
  const claim = await claimCanvasPublishAttempt(
    auth,
    input.assessmentId,
    input.publishId,
    clock(),
    LEASE_DURATION_MS,
    input.runtime,
  );
  if (!claim.ok) {
    if (claim.error._tag === 'CanvasPublishBusy' || claim.error._tag === 'CanvasPublishTerminal') {
      return { ok: true, attempt: claim.error.attempt };
    }
    return serviceFailure(claim.error);
  }

  const authorized = await authorizeCanvasConnection(
    input.runtime,
    auth,
    claim.attempt.connection.id,
    { fetchImpl: options.fetchImpl, signal: options.signal },
  );
  if (!authorized.ok) {
    return await persistOperationFailure(
      auth,
      input,
      claim.operation,
      canvasPublishOperationPolicy(claim.operation).activePhase,
      claim.leaseToken,
      {
        code: authorized.error._tag,
        message: authorized.error.message,
      },
      true,
      clock(),
    );
  }
  if (!connectionMatchesSnapshot(authorized.connection, claim.attempt)) {
    return await persistOperationFailure(
      auth,
      input,
      claim.operation,
      canvasPublishOperationPolicy(claim.operation).activePhase,
      claim.leaseToken,
      {
        code: 'CanvasConnectionChanged',
        message:
          'The selected Canvas connection changed after this publish started. Start a new publish with the current connection.',
      },
      false,
      clock(),
    );
  }

  const artifact = await readMaterializedAssessmentExportArtifact(
    input.storage,
    claim.attempt.artifact,
  );
  if (!artifact.ok) {
    return await persistOperationFailure(
      auth,
      input,
      claim.operation,
      canvasPublishOperationPolicy(claim.operation).activePhase,
      claim.leaseToken,
      {
        code: artifact.error._tag,
        message: artifact.error.message,
      },
      true,
      clock(),
    );
  }

  const execution: CanvasPublishExecution = {
    auth,
    input,
    leaseToken: claim.leaseToken,
    connection: authorized.connection,
    clock,
    fetchImpl: options.fetchImpl,
    callerSignal: options.signal,
    requestTimeoutMs: validRequestTimeout(options.requestTimeoutMs),
  };
  const packageInput: CanvasPackage = {
    filename: canvasUploadFilename(claim.attempt),
    mediaType: claim.attempt.artifact.mediaType,
    bytes: artifact.value,
  };

  switch (claim.operation) {
    case 'Create':
      return await createMigration(execution, claim.attempt, packageInput);
    case 'Upload':
      return await resumeUpload(execution, claim.attempt, packageInput);
    case 'Observe':
      return await resumeObservation(execution, claim.attempt);
  }
}

function canvasUploadFilename(attempt: CanvasPublishAttempt): string {
  const prefix = `qflow-${attempt.id}-`;
  const filename = `${prefix}${attempt.artifact.filename}`;
  return filename.length <= 255 ? filename : `${prefix}${attempt.artifact.sha256.slice(0, 24)}.zip`;
}

async function createMigration(
  execution: CanvasPublishExecution,
  attempt: CanvasPublishAttempt,
  artifact: CanvasPackage,
): Promise<AdvanceCanvasPublishResult> {
  if (attempt.state._tag !== 'ClaimingCreate') {
    throw new Error('Create ownership did not produce a claiming-create state.');
  }
  const startedAt = execution.clock();
  const started = await markCanvasRemoteCreationStarted(execution.auth, {
    assessmentId: execution.input.assessmentId,
    publishId: execution.input.publishId,
    leaseToken: execution.leaseToken,
    startedAt,
    leaseDurationMs: LEASE_DURATION_MS,
  }, execution.input.runtime);
  if (!started.ok) return serviceFailure(started.error);

  const created = await createCanvasQtiMigration(execution.connection, {
    targetId: started.attempt.targetId,
    destination: started.attempt.destination,
    artifact,
  }, requestOptions(execution));
  if (!created.ok) {
    if (isDefinitiveCanvasCreateRejection(created.error)) {
      return await persistOperationFailure(
        execution.auth,
        execution.input,
        'Create',
        'creating',
        execution.leaseToken,
        created.error,
        created.error.retryable,
        execution.clock(),
      );
    }
    return await persistUnknownRemoteIdentity(execution, created.error);
  }

  const recordedAt = execution.clock();
  const recorded = await recordCanvasRemoteMigration(execution.auth, {
    assessmentId: execution.input.assessmentId,
    publishId: execution.input.publishId,
    leaseToken: execution.leaseToken,
    contentMigrationId: created.value.id,
    progressUrl: created.value.progressUrl,
    workflowState: created.value.workflowState,
    updatedAt: recordedAt,
    leaseDurationMs: LEASE_DURATION_MS,
  }, execution.input.runtime);
  if (!recorded.ok) return serviceFailure(recorded.error);
  return await uploadPackage(execution, recorded.attempt, created.value.upload, artifact);
}

async function resumeUpload(
  execution: CanvasPublishExecution,
  attempt: CanvasPublishAttempt,
  artifact: CanvasPackage,
): Promise<AdvanceCanvasPublishResult> {
  if (attempt.state._tag !== 'Uploading') {
    throw new Error('Upload ownership did not produce an uploading state.');
  }
  const migration = await loadMigration(execution, attempt.state.remote, 'uploading');
  if (!migration.ok) return migration.result;
  if (
    migration.value.workflowState !== null && migration.value.workflowState !== 'created'
  ) {
    const observing = await acceptUpload(execution);
    return observing.ok
      ? await observeProgress(execution, observing.attempt)
      : serviceFailure(observing.error);
  }

  const renewed = await renewLease(execution, 'uploading');
  if (!renewed.ok) return serviceFailure(renewed.error);
  const refreshed = await refreshCanvasQtiMigrationUpload(execution.connection, {
    courseId: renewed.attempt.destination.courseId,
    contentMigrationId: migration.value.id,
    artifact,
  }, requestOptions(execution));
  if (!refreshed.ok) {
    return await persistOperationFailure(
      execution.auth,
      execution.input,
      'Upload',
      'uploading',
      execution.leaseToken,
      refreshed.error,
      refreshed.error.retryable,
      execution.clock(),
    );
  }

  const refreshedRecord = await refreshCanvasUploadingMigration(execution.auth, {
    assessmentId: execution.input.assessmentId,
    publishId: execution.input.publishId,
    leaseToken: execution.leaseToken,
    contentMigrationId: refreshed.value.id,
    progressUrl: refreshed.value.progressUrl,
    workflowState: refreshed.value.workflowState,
    updatedAt: execution.clock(),
    leaseDurationMs: LEASE_DURATION_MS,
  }, execution.input.runtime);
  if (!refreshedRecord.ok) return serviceFailure(refreshedRecord.error);
  return await uploadPackage(execution, refreshedRecord.attempt, refreshed.value.upload, artifact);
}

async function uploadPackage(
  execution: CanvasPublishExecution,
  attempt: CanvasPublishAttempt,
  upload: CanvasUploadContract,
  artifact: CanvasPackage,
): Promise<AdvanceCanvasPublishResult> {
  if (attempt.state._tag !== 'Uploading') {
    throw new Error('Canvas package upload requires an uploading state.');
  }
  const renewed = await renewLease(execution, 'uploading');
  if (!renewed.ok) return serviceFailure(renewed.error);
  const uploaded = await uploadCanvasQtiPackage(
    execution.connection,
    upload,
    artifact,
    requestOptions(execution),
  );
  if (!uploaded.ok) {
    return await persistOperationFailure(
      execution.auth,
      execution.input,
      'Upload',
      'uploading',
      execution.leaseToken,
      uploaded.error,
      uploaded.error.retryable,
      execution.clock(),
    );
  }

  const observing = await acceptUpload(execution);
  if (!observing.ok) return serviceFailure(observing.error);
  return await resumeObservationFromOwnedState(execution, observing.attempt);
}

async function resumeObservation(
  execution: CanvasPublishExecution,
  attempt: CanvasPublishAttempt,
): Promise<AdvanceCanvasPublishResult> {
  if (attempt.state._tag !== 'Observing') {
    throw new Error('Observe ownership did not produce an observing state.');
  }
  return await resumeObservationFromOwnedState(execution, attempt);
}

async function resumeObservationFromOwnedState(
  execution: CanvasPublishExecution,
  attempt: CanvasPublishAttempt,
): Promise<AdvanceCanvasPublishResult> {
  if (attempt.state._tag !== 'Observing') {
    throw new Error('Canvas progress observation requires an observing state.');
  }
  const migration = await loadMigration(execution, attempt.state.remote, 'observing');
  if (!migration.ok) return migration.result;
  return await observeProgress(execution, migration.attempt);
}

async function loadMigration(
  execution: CanvasPublishExecution,
  remote: CanvasPublishRemote,
  phase: 'uploading' | 'observing',
): Promise<
  | {
    readonly ok: true;
    readonly value: CanvasContentMigration;
    readonly attempt: CanvasPublishAttempt;
  }
  | { readonly ok: false; readonly result: AdvanceCanvasPublishResult }
> {
  const renewed = await renewLease(execution, phase);
  if (!renewed.ok) return { ok: false, result: serviceFailure(renewed.error) };
  const migration = await getCanvasContentMigration(execution.connection, {
    courseId: renewed.attempt.destination.courseId,
    contentMigrationId: remote.contentMigrationId,
  }, requestOptions(execution));
  if (!migration.ok) {
    return {
      ok: false,
      result: await persistOperationFailure(
        execution.auth,
        execution.input,
        phase === 'uploading' ? 'Upload' : 'Observe',
        phase,
        execution.leaseToken,
        migration.error,
        migration.error.retryable,
        execution.clock(),
      ),
    };
  }
  if (migration.value.id !== remote.contentMigrationId) {
    return {
      ok: false,
      result: await persistOperationFailure(
        execution.auth,
        execution.input,
        phase === 'uploading' ? 'Upload' : 'Observe',
        phase,
        execution.leaseToken,
        {
          code: 'CanvasMigrationIdentityMismatch',
          message: 'Canvas returned a different migration identity for this publish.',
        },
        false,
        execution.clock(),
      ),
    };
  }
  const update = {
    assessmentId: execution.input.assessmentId,
    publishId: execution.input.publishId,
    leaseToken: execution.leaseToken,
    contentMigrationId: migration.value.id,
    progressUrl: migration.value.progressUrl,
    workflowState: migration.value.workflowState,
    updatedAt: execution.clock(),
    leaseDurationMs: LEASE_DURATION_MS,
  };
  const recorded = phase === 'uploading'
    ? await refreshCanvasUploadingMigration(execution.auth, update, execution.input.runtime)
    : await refreshCanvasObservedMigration(execution.auth, update, execution.input.runtime);
  return recorded.ok
    ? { ok: true, value: migration.value, attempt: recorded.attempt }
    : { ok: false, result: serviceFailure(recorded.error) };
}

async function observeProgress(
  execution: CanvasPublishExecution,
  attempt: CanvasPublishAttempt,
): Promise<AdvanceCanvasPublishResult> {
  if (attempt.state._tag !== 'Observing') {
    throw new Error('Canvas progress can only be read from an observing state.');
  }
  const renewed = await renewLease(execution, 'observing');
  if (!renewed.ok) return serviceFailure(renewed.error);
  const progress = await getCanvasImportProgress(
    execution.connection,
    attempt.state.remote.progressUrl,
    requestOptions(execution),
  );
  if (!progress.ok) {
    return await persistOperationFailure(
      execution.auth,
      execution.input,
      'Observe',
      'observing',
      execution.leaseToken,
      progress.error,
      progress.error.retryable,
      execution.clock(),
    );
  }

  if (progress.value.workflowState === 'failed') {
    return await persistTerminalFailure(execution, 'observing', {
      code: 'CanvasImportFailed',
      message: 'Canvas could not finish importing the preserved package.',
    });
  }
  if (progress.value.workflowState === 'queued' || progress.value.workflowState === 'running') {
    const processing = await markCanvasPublishProcessing(execution.auth, {
      assessmentId: execution.input.assessmentId,
      publishId: execution.input.publishId,
      leaseToken: execution.leaseToken,
      workflowState: progress.value.workflowState,
      updatedAt: execution.clock(),
    }, execution.input.runtime);
    return transitionResult(processing);
  }

  const publishedAt = execution.clock();
  const receipt = createCanvasPublishReceipt({ attempt: renewed.attempt, publishedAt });
  const completed = await markCanvasPublishCompleted(execution.auth, {
    assessmentId: execution.input.assessmentId,
    publishId: execution.input.publishId,
    leaseToken: execution.leaseToken,
    receipt,
    publishedAt,
  }, execution.input.runtime);
  return transitionResult(completed);
}

async function acceptUpload(
  execution: CanvasPublishExecution,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await markCanvasUploadAccepted(execution.auth, {
    assessmentId: execution.input.assessmentId,
    publishId: execution.input.publishId,
    leaseToken: execution.leaseToken,
    updatedAt: execution.clock(),
    leaseDurationMs: LEASE_DURATION_MS,
  }, execution.input.runtime);
}

async function renewLease(
  execution: CanvasPublishExecution,
  phase: ActiveCanvasPublishPhase,
): Promise<UpdateCanvasPublishAttemptResult> {
  return await renewCanvasPublishLease(execution.auth, {
    assessmentId: execution.input.assessmentId,
    publishId: execution.input.publishId,
    leaseToken: execution.leaseToken,
    phase,
    renewedAt: execution.clock(),
    leaseDurationMs: LEASE_DURATION_MS,
  }, execution.input.runtime);
}

async function persistTerminalFailure(
  execution: CanvasPublishExecution,
  phase: ActiveCanvasPublishPhase,
  failure: CanvasPublishFailure,
): Promise<AdvanceCanvasPublishResult> {
  const failed = await markCanvasPublishFailed(execution.auth, {
    assessmentId: execution.input.assessmentId,
    publishId: execution.input.publishId,
    leaseToken: execution.leaseToken,
    phase,
    failure,
    updatedAt: execution.clock(),
  }, execution.input.runtime);
  return transitionResult(failed);
}

async function persistUnknownRemoteIdentity(
  execution: CanvasPublishExecution,
  cause: CanvasConnectorFailure,
): Promise<AdvanceCanvasPublishResult> {
  const unknown = await markCanvasRemoteIdentityUnknown(execution.auth, {
    assessmentId: execution.input.assessmentId,
    publishId: execution.input.publishId,
    leaseToken: execution.leaseToken,
    failure: {
      code: 'CanvasRemoteIdentityUnknown',
      message: cause.code === 'CanvasRequestCancelled'
        ? 'The create request was cancelled after it may have reached Canvas. Check the course before starting a new publish.'
        : 'Canvas may have created the import, but QFlowLearn did not receive its ID. Check the course before starting a new publish.',
    },
    updatedAt: execution.clock(),
  }, execution.input.runtime);
  return transitionResult(unknown);
}

async function persistOperationFailure(
  auth: RequestContext,
  input: AdvanceInput,
  operation: CanvasPublishOperation,
  phase: ActiveCanvasPublishPhase,
  leaseToken: string,
  failure: CanvasPublishFailure,
  retryable: boolean,
  updatedAt: Date,
): Promise<AdvanceCanvasPublishResult> {
  const result = retryable
    ? await markCanvasPublishRetryable(auth, {
      assessmentId: input.assessmentId,
      publishId: input.publishId,
      leaseToken,
      resumeFrom: operation,
      phase,
      failure,
      updatedAt,
    }, input.runtime)
    : await markCanvasPublishFailed(auth, {
      assessmentId: input.assessmentId,
      publishId: input.publishId,
      leaseToken,
      phase,
      failure,
      updatedAt,
    }, input.runtime);
  return transitionResult(result);
}

function requestOptions(execution: CanvasPublishExecution): {
  readonly fetchImpl?: typeof fetch;
  readonly signal: AbortSignal;
} {
  const deadline = AbortSignal.timeout(execution.requestTimeoutMs);
  return {
    fetchImpl: execution.fetchImpl,
    signal: execution.callerSignal ? AbortSignal.any([execution.callerSignal, deadline]) : deadline,
  };
}

function isDefinitiveCanvasCreateRejection(error: CanvasConnectorFailure): boolean {
  return error.code === 'CanvasAuthenticationFailed' ||
    error.code === 'CanvasPermissionDenied' ||
    error.code === 'CanvasDestinationNotFound' ||
    error.code === 'CanvasRequestRejected';
}

function connectionMatchesSnapshot(
  connection: AuthorizedCanvasConnection,
  attempt: CanvasPublishAttempt,
): boolean {
  return connection.name === attempt.connection.name &&
    connection.baseUrl === attempt.connection.baseUrl &&
    connection.supportedTargetIds.includes(attempt.targetId);
}

function validRequestTimeout(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 &&
      value < LEASE_DURATION_MS
    ? value
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function transitionResult(result: UpdateCanvasPublishAttemptResult): AdvanceCanvasPublishResult {
  return result.ok ? { ok: true, attempt: result.attempt } : serviceFailure(result.error);
}

function serviceFailure(error: {
  readonly _tag: string;
  readonly message?: string;
  readonly cause?: unknown;
}): Extract<AdvanceCanvasPublishResult, { readonly ok: false }> {
  const tag = error._tag === 'CanvasPublishNotFound' ||
      error._tag === 'CanvasPublishLeaseLost' ||
      error._tag === 'CanvasPublishPersistenceFailed'
    ? error._tag
    : 'CanvasPublishPersistenceFailed';
  return {
    ok: false,
    error: {
      _tag: tag,
      message: error.message ?? 'QFlowLearn could not record direct Canvas publishing.',
      ...(error.cause !== undefined ? { cause: error.cause } : {}),
    },
  };
}
