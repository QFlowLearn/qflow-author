import {
  enqueueAcceptedBankMigration,
  getMigrationReviewPage,
} from '../../../services/migration_review_page.ts';
import { migrationCommittedHref } from '../../../import/migration_destination.ts';
import {
  migrationReviewHref,
  parseMigrationReviewFilter,
} from '../../../import/migration_review_filter.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { safeErrorSummary } from '../../../error_summary.ts';
import { attachmentContentDisposition } from '../../attachment_content_disposition.ts';
import { buildMigrationQaReport } from '../../../import/migration_qa_report.ts';
import {
  decideMigrationRunApproval,
  submitMigrationRunForApproval,
} from '../../../import/migration_approvals.ts';
import { getMigrationBatchReviewContext } from '../../../import/migration_batches.ts';
import { retryMigrationRun } from '../../../import/migration_jobs.ts';
import {
  ImportAssetCleanupRequiredError,
  ImportQuestionPreparationInvalidatedError,
} from '../../../import/commit_import_result.ts';
import { commitMigrationRun } from '../../../import/migration_run_commit.ts';
import {
  type ConversionItemVersion,
  updateMigrationItems,
} from '../../../import/migration_run_review.ts';
import { resolveStorage } from '../../../storage.ts';
import type { ObjectWriteLifecycle } from '../../../storage_contract.ts';
import { requireContentWrite } from '../../../services/roles.ts';
import { requireAuthContext } from '../../../tenants.ts';
import {
  dispatchPendingWorkflowJobs,
  requireWorkflowBindings,
} from '../../../workflows/workflow_dispatch.ts';
import MigrationReportPage, {
  qaReportFilename,
} from '../../../../components/imports/migration_report_page.tsx';
import type { RuntimeSource } from '../../../runtime.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../../../i18n/player_messages/catalogs.ts';
import type { I18n } from '../../../i18n/messages.ts';

type MigrationFeedbackCode =
  | 'approval-update-failed'
  | 'alignment-failed'
  | 'bulk-update-failed'
  | 'commit-failed'
  | 'preparation-invalidated'
  | 'question-update-failed'
  | 'retry-failed';

/** Parses the closed migration feedback values accepted in the URL. */
export function parseMigrationFeedback(value: string | null): MigrationFeedbackCode | null {
  switch (value) {
    case 'approval-update-failed':
    case 'alignment-failed':
    case 'bulk-update-failed':
    case 'commit-failed':
    case 'preparation-invalidated':
    case 'question-update-failed':
    case 'retry-failed':
      return value;
    default:
      return null;
  }
}

export function migrationFeedbackMessage(
  i18n: I18n,
  code: MigrationFeedbackCode,
): string {
  switch (code) {
    case 'approval-update-failed':
      return i18n.t('imports.feedback.approvalUpdateFailed');
    case 'alignment-failed':
      return i18n.t('imports.feedback.alignmentFailed');
    case 'bulk-update-failed':
      return i18n.t('imports.feedback.bulkUpdateFailed');
    case 'commit-failed':
      return i18n.t('imports.feedback.commitFailed');
    case 'preparation-invalidated':
      return i18n.t('imports.feedback.preparationInvalidated');
    case 'question-update-failed':
      return i18n.t('imports.feedback.questionUpdateFailed');
    case 'retry-failed':
      return i18n.t('imports.feedback.retryFailed');
  }
}

export const importReportRoute = defineHttpRoute('/imports/:id', {
  GET: handleGET,
  HEAD: handleGET,
  POST: handlePOST,
});

export { qaReportFilename };
export default MigrationReportPage;

async function handleRetry(
  runId: string,
  requestUrl: URL,
  auth: ReturnType<typeof requireAuthContext>,
  runtime: RuntimeSource,
) {
  try {
    requireWorkflowBindings(runtime);
    await retryMigrationRun(auth, runId);
    const dispatch = await dispatchPendingWorkflowJobs(runtime, {
      jobIds: [runId],
      tenantId: auth.tenantId,
    });
    if (!dispatch.ok) {
      console.error(JSON.stringify({
        event: 'source_workflow_retry_dispatch_deferred',
        runId,
        errorTag: dispatch.error._tag,
      }));
    }
    return new Response(null, {
      status: 303,
      headers: { location: `/imports/${runId}` },
    });
  } catch (cause: unknown) {
    logMigrationRouteFailure('migration_retry_failed', runId, cause);
    return redirectWithCommitError(
      runId,
      requestUrl,
      'retry-failed',
    );
  }
}

async function handleAlignment(
  runId: string,
  requestUrl: URL,
  form: FormData,
  auth: ReturnType<typeof requireAuthContext>,
) {
  const itemId = String(form.get('itemId') || '');
  try {
    const expectedVersions = parseExpectedVersions(form, [itemId]);
    await updateMigrationItems(auth, runId, [itemId], {
      kind: 'align_blueprint_target',
      targetId: String(form.get('blueprintTargetId') || ''),
    }, expectedVersions);
    return new Response(null, {
      status: 303,
      headers: { location: reviewReturnHref(runId, requestUrl, itemId) },
    });
  } catch (cause: unknown) {
    logMigrationRouteFailure('migration_alignment_failed', runId, cause);
    return redirectWithCommitError(
      runId,
      requestUrl,
      'alignment-failed',
    );
  }
}

async function handleCommit(
  runId: string,
  requestUrl: URL,
  form: FormData,
  auth: ReturnType<typeof requireAuthContext>,
  storage: ObjectWriteLifecycle,
  runtime: RuntimeSource,
) {
  try {
    requireWorkflowBindings(runtime);
    if (
      await enqueueAcceptedBankMigration(
        auth,
        runId,
        form.get('commitSelection'),
        form.get('approval') === 'approved',
      )
    ) {
      await dispatchPendingWorkflowJobs(runtime, { jobIds: [runId], tenantId: auth.tenantId });
      return new Response(null, { status: 303, headers: { location: `/imports/${runId}` } });
    }
    const committed = await commitMigrationRun(auth, runId, {
      storage,
      approvedItemIds: form.getAll('approvedItemId').map(String),
      approval: form.get('approval') === 'approved',
    });
    return new Response(null, {
      status: 303,
      headers: { location: migrationCommittedHref(committed.destination) },
    });
  } catch (cause: unknown) {
    logMigrationRouteFailure('migration_commit_failed', runId, cause);
    return redirectWithCommitError(
      runId,
      requestUrl,
      cause instanceof ImportQuestionPreparationInvalidatedError
        ? 'preparation-invalidated'
        : 'commit-failed',
    );
  }
}

async function handleApproval(
  runId: string,
  requestUrl: URL,
  action: 'submit-approval' | 'approve' | 'request-changes',
  form: FormData,
  auth: ReturnType<typeof requireAuthContext>,
) {
  try {
    if (action === 'submit-approval') {
      await submitMigrationRunForApproval(auth, runId);
    } else {
      await decideMigrationRunApproval(auth, runId, {
        decision: action === 'approve' ? 'approve' : 'request_changes',
        note: String(form.get('approvalNote') ?? ''),
      });
    }
    return new Response(null, {
      status: 303,
      headers: { location: `/imports/${runId}` },
    });
  } catch (cause: unknown) {
    logMigrationRouteFailure('migration_approval_update_failed', runId, cause);
    return redirectWithCommitError(
      runId,
      requestUrl,
      'approval-update-failed',
    );
  }
}

async function handleBulk(
  runId: string,
  requestUrl: URL,
  form: FormData,
  auth: ReturnType<typeof requireAuthContext>,
) {
  const itemIds = form.getAll('itemId').map(String);
  const action = String(form.get('bulkAction') || '');
  try {
    const expectedVersions = parseExpectedVersions(form, itemIds);
    if (action === 'accept' || action === 'reject') {
      await updateMigrationItems(auth, runId, itemIds, { kind: action }, expectedVersions);
    } else if (action === 'retag') {
      const tags = String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(
        Boolean,
      );
      await updateMigrationItems(
        auth,
        runId,
        itemIds,
        { kind: 'retag', tags },
        expectedVersions,
      );
    } else if (action === 'change_type') {
      await updateMigrationItems(auth, runId, itemIds, {
        kind: 'change_type',
        typeId: String(form.get('typeId') || ''),
      }, expectedVersions);
    } else {
      throw new Error('Choose a bulk action.');
    }
    return new Response(null, {
      status: 303,
      headers: {
        location: reviewReturnHref(runId, requestUrl),
      },
    });
  } catch (cause: unknown) {
    logMigrationRouteFailure('migration_bulk_update_failed', runId, cause);
    return redirectWithCommitError(
      runId,
      requestUrl,
      'bulk-update-failed',
    );
  }
}

async function handleEdit(
  runId: string,
  requestUrl: URL,
  form: FormData,
  auth: ReturnType<typeof requireAuthContext>,
) {
  const itemId = String(form.get('itemId') || '');
  try {
    const expectedVersions = parseExpectedVersions(form, [itemId]);
    await updateMigrationItems(auth, runId, [itemId], {
      kind: 'edit',
      title: String(form.get('title') || ''),
      bodyHtml: String(form.get('bodyHtml') || ''),
    }, expectedVersions);
    return new Response(null, {
      status: 303,
      headers: { location: reviewReturnHref(runId, requestUrl, itemId) },
    });
  } catch (cause: unknown) {
    logMigrationRouteFailure('migration_question_update_failed', runId, cause);
    return redirectWithCommitError(
      runId,
      requestUrl,
      'question-update-failed',
    );
  }
}

function reviewReturnHref(runId: string, requestUrl: URL, itemId?: string): string {
  const page = Number(requestUrl.searchParams.get('page') || '1');
  const filter = parseMigrationReviewFilter(requestUrl.searchParams.get('review'));
  if (!Number.isSafeInteger(page) || page < 1 || page > 200 || filter === null) {
    throw new Error('Invalid import review selection.');
  }
  return migrationReviewHref(runId, page, filter, itemId);
}

function redirectWithCommitError(
  runId: string,
  requestUrl: URL,
  code: MigrationFeedbackCode,
) {
  const url = new URL(`/imports/${runId}`, requestUrl);
  url.searchParams.set('feedback', code);
  return new Response(null, {
    status: 303,
    headers: { location: url.pathname + url.search },
  });
}

function logMigrationRouteFailure(event: string, runId: string, cause: unknown): void {
  console.error(JSON.stringify({
    event,
    runId,
    cause: safeErrorSummary(cause),
    ...(cause instanceof ImportAssetCleanupRequiredError
      ? {
        cleanupRequired: true,
        objectKeys: cause.objectKeys,
        operationCause: safeErrorSummary(cause.cause),
        cleanupFailures: cause.cleanupFailures.map((failure) => ({
          objectKey: failure.objectKey,
          cause: safeErrorSummary(failure.cause),
        })),
      }
      : {}),
  }));
}

function parseExpectedVersions(
  form: FormData,
  itemIds: readonly string[],
): Record<string, ConversionItemVersion> {
  const versions: Record<string, ConversionItemVersion> = {};
  for (const itemId of itemIds) {
    const raw = form.get(`itemVersion:${itemId}`);
    if (typeof raw !== 'string') throw new Error(`Missing version for item "${itemId}".`);
    const [contentHash, contextHash, decision, ...extra] = raw.split(':');
    if (
      extra.length ||
      !/^[0-9a-f]{64}$/.test(contentHash) ||
      !/^[0-9a-f]{64}$/.test(contextHash) ||
      (decision !== 'pending' && decision !== 'accepted' && decision !== 'rejected')
    ) {
      throw new Error(`Invalid version for item "${itemId}".`);
    }
    versions[itemId] = { contentHash, contextHash, decision };
  }
  return versions;
}

async function handleGET(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const requestedPage = Number(ctx.url.searchParams.get('page') || '1');
  const reviewFilter = parseMigrationReviewFilter(ctx.url.searchParams.get('review'));
  if (reviewFilter === null) return new Response('Invalid review filter.', { status: 400 });
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 200) {
    return new Response('Invalid page.', { status: 400 });
  }
  const pageData = await getMigrationReviewPage(
    auth,
    ctx.params.id,
    requestedPage,
    ctx.url.searchParams.get('download') === 'qa-report',
    reviewFilter,
  );
  const run = pageData?.run;
  if (!run) return new Response(ctx.state.i18n.t('imports.feedback.notFound'), { status: 404 });
  if (ctx.req.headers.get('accept') === 'application/json') {
    return Response.json({ state: run.execution._tag }, {
      headers: { 'cache-control': 'no-store', vary: 'Accept' },
    });
  }
  const batch = await getMigrationBatchReviewContext(auth, run.batchId);
  if (!batch) return new Response(ctx.state.i18n.t('imports.feedback.notFound'), { status: 404 });
  const url = ctx.url;
  if (url.searchParams.get('download') === 'qa-report') {
    return new Response(
      buildMigrationQaReport(run, new Date(), pageData?.exactRepeats, pageData?.importChecks),
      {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': attachmentContentDisposition(qaReportFilename(run)),
        },
      },
    );
  }
  const feedback = parseMigrationFeedback(url.searchParams.get('feedback'));
  const commitError = feedback ? migrationFeedbackMessage(ctx.state.i18n, feedback) : null;
  const editItemId = url.searchParams.get('edit');
  return ctx.render(
    <MigrationReportPage
      run={run}
      pagination={pageData?.pagination}
      exactRepeats={pageData?.exactRepeats}
      importChecks={pageData?.importChecks}
      commitProgress={pageData?.commitProgress}
      batch={batch}
      currentUserId={auth.userId}
      commitError={commitError}
      editItemId={editItemId}
      i18n={ctx.state.i18n}
      payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, [
        'authoring',
        'imports',
      ])}
      playerCatalog={playerMessageCatalogForLocale(ctx.state.interfaceLocale)}
    />,
  );
}

async function handlePOST(ctx: HttpRequest) {
  const auth = requireAuthContext(ctx.state);
  const page = Number(ctx.url.searchParams.get('page') || '1');
  if (
    !Number.isSafeInteger(page) || page < 1 || page > 200 ||
    parseMigrationReviewFilter(ctx.url.searchParams.get('review')) === null
  ) {
    return new Response('Invalid import review selection.', { status: 400 });
  }
  const form = await ctx.req.formData();
  const action = String(form.get('action') || '').trim();
  if (action !== 'approve' && action !== 'request-changes') {
    const denied = requireContentWrite(auth.role, ctx.req, ctx.state.i18n);
    if (denied) return denied;
  }
  if (action === 'bulk') {
    return handleBulk(ctx.params.id, ctx.url, form, auth);
  }
  if (action === 'edit-item') {
    return handleEdit(ctx.params.id, ctx.url, form, auth);
  }
  if (action === 'align-item') {
    return handleAlignment(ctx.params.id, ctx.url, form, auth);
  }
  if (action === 'retry') {
    return handleRetry(ctx.params.id, ctx.url, auth, ctx.runtime);
  }
  if (
    action === 'submit-approval' || action === 'approve' ||
    action === 'request-changes'
  ) {
    return handleApproval(ctx.params.id, ctx.url, action, form, auth);
  }
  if (action !== 'commit') {
    return new Response(ctx.state.i18n.t('imports.feedback.invalidAction'), { status: 400 });
  }
  return handleCommit(ctx.params.id, ctx.url, form, auth, resolveStorage(ctx.runtime), ctx.runtime);
}
