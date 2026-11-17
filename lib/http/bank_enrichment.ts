import { handleOrganizationCommand } from './question_organization.ts';
import { BankQuestionProposals } from '../services/bank_question_proposals.ts';
import { randomQuestionIndex } from '../bank_question_sampling.ts';
import { parseEnrichmentDimensions } from '../services/bank_enrichment_run_contract.ts';
import { BankEnrichmentGroupChanges } from '../services/bank_enrichment_group_changes.ts';
import { BankEnrichmentBrowse } from '../services/bank_enrichment_browse.ts';
import { enrichmentFailureKey } from '../bank_enrichment_feedback.ts';
import { getDb } from '../db.ts';
import { getEnv } from '../config.ts';
import { loadEnrichmentAIConfig } from '../ai/bank_enrichment_config.ts';
import { getRuntimeBinding } from '../runtime.ts';
import type { HttpRequest } from './route.ts';
type EnrichmentHttpRequest = Pick<HttpRequest, 'req' | 'url' | 'state'>;
import { parseBoundedMultipartFormData } from './bounded_multipart.ts';
import { BankEnrichmentSetup } from '../services/bank_enrichment_setup.ts';
import { BankEnrichmentJobRead } from '../services/bank_enrichment_job_read.ts';
import { BankEnrichmentJobs } from '../services/bank_enrichment_jobs.ts';
import { BankEnrichmentScopes } from '../services/bank_enrichment_scope.ts';
import { BankEnrichmentStore } from '../services/bank_enrichment_store.ts';
import {
  dispatchPendingWorkflowJobs,
  requireWorkflowBindings,
} from '../workflows/workflow_dispatch.ts';
import { requireAuthContext } from '../tenants.ts';
import { isCanonicalUuid } from '../uuid.ts';
import {
  type EnrichmentResult,
  parseEnrichmentDefinition,
} from '../services/bank_enrichment_contract.ts';
import { safeErrorSummary } from '../error_summary.ts';
import { listBankCollections } from '../services/bank_collections.ts';
import {
  type EnrichmentSnapshotScope,
  enrichmentSourceScope,
} from '../services/bank_enrichment_scope_contract.ts';

/** Name the server-validated scope without putting raw collection identifiers in the setup page. */
export async function enrichmentScopeName(
  ctx: EnrichmentHttpRequest,
  snapshotScope: EnrichmentSnapshotScope,
): Promise<EnrichmentResult<string, 'forbidden' | 'not_found'>> {
  const i18n = ctx.state.i18n;
  if (snapshotScope._tag === 'Affected') {
    return { ok: true, value: i18n.t('items.organize.affectedSelection') };
  }
  const scope = enrichmentSourceScope(snapshotScope);
  if (scope._tag === 'Selected') return { ok: true, value: i18n.t('items.organize.selected') };
  const collection = scope.query.collection;
  if (!collection) return { ok: true, value: i18n.t('items.collections.all') };
  if (collection._tag === 'Unfiled') {
    return { ok: true, value: i18n.t('items.collections.unfiled') };
  }
  const result = await listBankCollections(requireAuthContext(ctx.state), true, getDb(ctx));
  if (!result.ok) return result;
  const selected = result.collections.find((c) => c.id === collection.collectionId);
  return selected ? { ok: true, value: selected.name } : { ok: false, code: 'not_found' };
}

/** Request composition owns database, clock and platform configuration. */
export function enrichmentPageServices(ctx: EnrichmentHttpRequest) {
  const database = getDb(ctx), now = () => new Date();
  return {
    questionProposals: new BankQuestionProposals(database, randomQuestionIndex),
    changes: new BankEnrichmentGroupChanges(database, now),
    browse: new BankEnrichmentBrowse(database),
    setup: new BankEnrichmentSetup(database, now),
    read: new BankEnrichmentJobRead(database, now),
    jobs: new BankEnrichmentJobs(database, now),
    scopes: new BankEnrichmentScopes(database, now),
    schemes: new BankEnrichmentStore(database, now),
  };
}

/** Parse one bounded command and dispatch accepted jobs through the existing transactional outbox. */
export async function handleEnrichmentAction(
  ctx: EnrichmentHttpRequest,
  jobId: string | null,
): Promise<Response> {
  const auth = requireAuthContext(ctx.state);
  const fail = (code: string, status = 400) =>
    Response.json({ error: ctx.state.i18n.t(enrichmentFailureKey(code)) }, { status });
  let raw: unknown;
  try {
    const form = await parseBoundedMultipartFormData(ctx.req, { maxBytes: 524_288 });
    const values = [...form.entries()];
    if (values.length !== 1 || values[0][0] !== 'payload' || typeof values[0][1] !== 'string') {
      return fail('invalid_input');
    }
    raw = JSON.parse(values[0][1]);
  } catch {
    return fail('invalid_input');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !('action' in raw)) {
    return fail('invalid_input');
  }
  const organization = await handleOrganizationCommand(ctx, jobId, raw);
  if (organization) return organization;
  const services = enrichmentPageServices(ctx);
  if (jobId !== null && raw.action === 'cancel' && Object.keys(raw).join(',') === 'action') {
    const cancelled = await services.jobs.cancel(auth, jobId);
    return cancelled.ok ? Response.json({ url: `/items/organize/${jobId}` }) : fail(cancelled.code);
  }
  let manual = raw.action === 'correct' || raw.action === 'undo';
  if (jobId !== null && raw.action === 'resume') {
    const found = await services.read.get(auth, jobId);
    if (!found.ok) return fail(found.code, found.code === 'forbidden' ? 403 : 404);
    manual = found.value.kind === 'correct' || found.value.kind === 'undo';
  }
  let config = null;
  try {
    requireWorkflowBindings(ctx);
    if (!manual) {
      config = loadEnrichmentAIConfig((key) => getEnv(key, ctx));
      const ai = getRuntimeBinding(ctx, 'AI');
      if (
        !config || typeof ai !== 'object' || ai === null || !('run' in ai) ||
        typeof ai.run !== 'function'
      ) return fail('configuration', 503);
    }
  } catch {
    return fail('configuration', 503);
  }
  let result;
  let previewFields: readonly string[] | null = null;
  if (
    config !== null && jobId === null && raw.action === 'begin' &&
    Object.keys(raw).sort().join(',') === 'action,audience,baseVersionId,operationId,scope' &&
    'operationId' in raw && typeof raw.operationId === 'string' && 'audience' in raw &&
    typeof raw.audience === 'string' && 'scope' in raw && 'baseVersionId' in raw &&
    (raw.baseVersionId === null || typeof raw.baseVersionId === 'string')
  ) {
    result = await services.setup.begin(
      auth,
      raw.operationId,
      raw.scope,
      raw.audience,
      raw.baseVersionId,
      config,
    );
  } else if (
    config !== null && jobId !== null && raw.action === 'preview' &&
    Object.keys(raw).sort().join(',') === 'action,definition,dimensions,operationId,selection' &&
    'dimensions' in raw && 'operationId' in raw &&
    typeof raw.operationId === 'string' && 'definition' in raw && 'selection' in raw
  ) {
    const definition = parseEnrichmentDefinition(raw.definition);
    if (!definition) return fail('invalid_input');
    previewFields = parseEnrichmentDimensions(raw.dimensions);
    if (!previewFields) return fail('invalid_input');
    result = await services.setup.preview(auth, jobId, raw.operationId, definition, {
      selection: raw.selection,
      dimensions: previewFields,
    }, config);
  } else if (
    config !== null && jobId !== null && raw.action === 'start' &&
    Object.keys(raw).sort().join(',') === 'action,definition,dimensions,replacement' &&
    'definition' in raw && 'dimensions' in raw &&
    'replacement' in raw &&
    (raw.replacement === 'preserve_manual' || raw.replacement === 'replace_captured')
  ) {
    const definition = parseEnrichmentDefinition(raw.definition);
    if (!definition) return fail('invalid_input');
    result = await services.setup.start(
      auth,
      jobId,
      definition,
      raw.replacement,
      raw.dimensions,
      config,
    );
  } else if (
    jobId !== null && raw.action === 'resume' &&
    Object.keys(raw).sort().join(',') === 'action,operationId' && 'operationId' in raw &&
    typeof raw.operationId === 'string' && isCanonicalUuid(raw.operationId)
  ) {
    result = await services.jobs.resume(auth, jobId, raw.operationId);
  } else if (
    jobId === null && raw.action === 'correct' &&
    Object.keys(raw).sort().join(',') ===
      'action,expectedCount,operationId,scope,values,versionId' &&
    'operationId' in raw && typeof raw.operationId === 'string' && 'scope' in raw &&
    'values' in raw &&
    'versionId' in raw && typeof raw.versionId === 'string' && 'expectedCount' in raw &&
    typeof raw.expectedCount === 'number'
  ) {
    result = await services.changes.correct(
      auth,
      raw.operationId,
      raw.scope,
      raw.versionId,
      raw.values,
      raw.expectedCount,
    );
  } else if (
    jobId !== null && raw.action === 'undo' &&
    Object.keys(raw).sort().join(',') === 'action,operationId' &&
    'operationId' in raw && typeof raw.operationId === 'string'
  ) {
    result = await services.changes.undo(auth, raw.operationId, jobId);
  } else return fail('invalid_input');
  if (!result.ok) return fail(result.code, result.code === 'forbidden' ? 403 : 409);
  try {
    const dispatch = await dispatchPendingWorkflowJobs(ctx, {
      jobIds: [result.value],
      tenantId: auth.tenantId,
    });
    if (!dispatch.ok) console.error('Enrichment dispatch deferred', dispatch.error);
  } catch (cause: unknown) {
    console.error('Enrichment dispatch deferred', safeErrorSummary(cause));
  }
  const fields = previewFields
    ? `?${new URLSearchParams({ fields: previewFields.join(',') })}`
    : '';
  return Response.json({ url: `/items/organize/${result.value}${fields}` }, { status: 202 });
}
