import { resumeOrganizationRun } from '../services/question_organization_resume.ts';
import {
  parsePreviewTeachingCommand,
  teachOrganizationPreview,
} from '../services/question_organization_preview_teaching.ts';
import type { OrganizationSetup } from '../services/question_organization_contract.ts';
import { uuidV5 } from '../uuid_v5.ts';
import type { HttpRequest } from './route.ts';
type EnrichmentHttpRequest = Pick<HttpRequest, 'req' | 'url' | 'state'>;
import { getDb } from '../db.ts';
import { getEnv } from '../config.ts';
import { getRuntimeBinding } from '../runtime.ts';
import { requireAuthContext } from '../tenants.ts';
import { isEnrichmentRecord } from '../ai/bank_enrichment_config.ts';
import { loadClefOrganizationConfig } from '../ai/clef_organization_provider.ts';
import { QuestionOrganizationWorkspace } from '../services/question_organization_workspace.ts';
import { setOrganizationActivation } from '../services/question_organization_activation.ts';
import { cancelOrganizationRun } from '../services/question_organization_cancel.ts';
import { queueOrganizationUndo } from '../services/question_organization_undo.ts';
import {
  dispatchPendingWorkflowJobs,
  requireWorkflowBindings,
} from '../workflows/workflow_dispatch.ts';
import { enrichmentFailureKey } from '../bank_enrichment_feedback.ts';
import { safeErrorSummary } from '../error_summary.ts';

export const organizationPageService = (ctx: EnrichmentHttpRequest) =>
  new QuestionOrganizationWorkspace(getDb(ctx), () => new Date());

export const organizationRunHref = (id: string) => `/items/organize/${id}?kind=organization`;

/** Organization commands have an explicit discriminator; historical tasks keep their own commands. */
export async function handleOrganizationCommand(
  ctx: EnrichmentHttpRequest,
  jobId: string | null,
  raw: unknown,
): Promise<Response | null> {
  if (
    !isEnrichmentRecord(raw) || typeof raw.action !== 'string' ||
    !raw.action.startsWith('organization-')
  ) return null;
  const database = getDb(ctx), auth = requireAuthContext(ctx.state), now = () => new Date();
  const service = new QuestionOrganizationWorkspace(database, now);
  const fail = (code: string, status = 400) =>
    Response.json({
      error: ctx.state.i18n.t(
        code === 'scope_too_large'
          ? 'items.organization.limit'
          : code === 'preview_changed'
          ? 'items.organization.previewChanged'
          : enrichmentFailureKey(code),
      ),
    }, { status });
  const keys = Object.keys(raw).sort().join(',');
  let result;
  let dispatch = false;
  if (
    raw.action === 'organization-preview' && jobId === null &&
    keys ===
      'action,classifier,collectionId,definition,expectedVersion,filing,operationId,sourceMappings' &&
    (raw.classifier === 'source_only' || raw.classifier === 'clef') &&
    typeof raw.collectionId === 'string' && typeof raw.operationId === 'string' &&
    typeof raw.expectedVersion === 'number'
  ) {
    let classifier: OrganizationSetup['classifier'];
    if (raw.classifier === 'source_only') classifier = { kind: 'source_only' };
    else {
      const config = loadClefOrganizationConfig((key) => getEnv(key, ctx));
      const ai = getRuntimeBinding(ctx, 'AI');
      if (!config || !isEnrichmentRecord(ai) || typeof ai.run !== 'function') {
        return fail('configuration', 503);
      }
      classifier = { kind: 'clef', config };
    }
    try {
      requireWorkflowBindings(ctx);
    } catch {
      return fail('configuration', 503);
    }
    result = await service.preview(auth, {
      operationId: raw.operationId,
      collectionId: raw.collectionId,
      expectedVersion: raw.expectedVersion,
      definition: raw.definition,
      filing: raw.filing,
      sourceMappings: raw.sourceMappings,
    }, classifier);
    dispatch = true;
  } else if (
    raw.action === 'organization-teach-preview' && jobId !== null &&
    keys === 'action,corrections,operationId'
  ) {
    const command = parsePreviewTeachingCommand({
      operationId: raw.operationId,
      corrections: raw.corrections,
    });
    if (!command) return fail('invalid_input');
    try {
      requireWorkflowBindings(ctx);
    } catch {
      return fail('configuration', 503);
    }
    result = await teachOrganizationPreview(database, auth, jobId, command, now());
    dispatch = true;
  } else if (
    raw.action === 'organization-apply' && jobId !== null && keys === 'action'
  ) {
    const preview = await service.run(auth, jobId);
    if (!preview.ok) return fail(preview.code);
    if (preview.value.mode !== 'preview' || preview.value.state !== 'completed') {
      return fail('conflict', 409);
    }
    try {
      requireWorkflowBindings(ctx);
    } catch {
      return fail('configuration', 503);
    }
    result = await service.queue(auth, {
      id: await uuidV5(jobId, 'apply'),
      setupId: preview.value.setupId,
      mode: 'apply',
    });
    dispatch = true;
  } else if (
    (raw.action === 'organization-resume' || raw.action === 'organization-undo') &&
    jobId !== null &&
    keys === 'action,expectedExecutionId' && typeof raw.expectedExecutionId === 'string'
  ) {
    try {
      requireWorkflowBindings(ctx);
    } catch {
      return fail('configuration', 503);
    }
    result = raw.action === 'organization-resume'
      ? await resumeOrganizationRun(database, auth, jobId, raw.expectedExecutionId, now())
      : await queueOrganizationUndo(database, auth, {
        runId: jobId,
        expectedExecutionId: raw.expectedExecutionId,
      }, now());
    dispatch = true;
  } else if (
    raw.action === 'organization-activation' &&
    keys === 'action,collectionId,expectedRevision,operationId,setupId' &&
    typeof raw.collectionId === 'string' && typeof raw.expectedRevision === 'number' &&
    typeof raw.operationId === 'string' && (raw.setupId === null || typeof raw.setupId === 'string')
  ) {
    const changed = await setOrganizationActivation(database, auth, {
      collectionId: raw.collectionId,
      setupId: raw.setupId,
      expectedRevision: raw.expectedRevision,
      operationId: raw.operationId,
    }, now());
    return changed.ok
      ? Response.json({ url: jobId ? organizationRunHref(jobId) : '/items/organize' })
      : fail(changed.code, changed.code === 'forbidden' ? 403 : 409);
  } else if (
    jobId !== null && keys === 'action' &&
    raw.action === 'organization-cancel'
  ) {
    result = await cancelOrganizationRun(database, auth, jobId);
  } else return fail('invalid_input');
  if (!result.ok) {
    return fail(
      result.code === 'conflict' &&
        (raw.action === 'organization-teach-preview' || raw.action === 'organization-apply')
        ? 'preview_changed'
        : result.code,
      result.code === 'forbidden' ? 403 : 409,
    );
  }
  if (dispatch) {
    try {
      await dispatchPendingWorkflowJobs(ctx, { jobIds: [result.value] });
    } catch (cause) {
      console.error('Organization dispatch deferred to outbox recovery', safeErrorSummary(cause));
    }
  }
  return Response.json({ url: organizationRunHref(result.value) });
}
