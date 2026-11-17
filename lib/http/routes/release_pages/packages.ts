import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { resolveStorage } from '../../../storage.ts';
import { requestReleaseBuild } from '../../../services/release_artifacts.ts';
import {
  acknowledgeReleaseCandidate,
  downloadReleaseArtifact,
} from '../../../services/release_artifact_delivery.ts';
import { releaseFailureStatus } from '../../../services/bank_release_preview.ts';
import {
  dispatchPendingWorkflowJobs,
  requireWorkflowBindings,
} from '../../../workflows/workflow_dispatch.ts';

const methods = {
  async POST(ctx) {
    const form = await ctx.req.formData(),
      auth = requireAuthContext(ctx.state),
      action = form.get('action');
    const valid = (keys: string[]) =>
      [...form.keys()].length === keys.length &&
      keys.every((key) => form.getAll(key).length === 1 && typeof form.get(key) === 'string');
    const fail = (code: Parameters<typeof releaseFailureStatus>[0]) =>
      new Response(ctx.state.i18n.t(`releases.error.${code}`), {
        status: releaseFailureStatus(code),
      });
    if (action === 'build' && valid(['action', 'attemptId', 'previousAttemptId'])) {
      requireWorkflowBindings(ctx);
      const attemptId = String(form.get('attemptId'));
      const result = await requestReleaseBuild(auth, {
        releaseId: ctx.params.id,
        attemptId,
        previousAttemptId: form.get('previousAttemptId') || null,
      });
      if (!result.ok) return fail(result.code);
      const dispatched = await dispatchPendingWorkflowJobs(ctx, {
        tenantId: auth.tenantId,
        jobIds: [attemptId],
      });
      if (!dispatched.ok) {
        return new Response(ctx.state.i18n.t('releases.package.dispatchPending'), { status: 503 });
      }
    } else if (
      action === 'acknowledge' &&
      valid(['action', 'attemptId', 'candidateDigest', 'policy', 'confirm']) &&
      form.get('confirm') === 'yes'
    ) {
      const result = await acknowledgeReleaseCandidate(auth, ctx.params.id, {
        attemptId: form.get('attemptId'),
        candidateDigest: form.get('candidateDigest'),
        policy: form.get('policy'),
      });
      if (!result.ok) {
        return fail(result.code);
      }
    } else if (action === 'download' && valid(['action', 'artifactId', 'operationId'])) {
      const result = await downloadReleaseArtifact(
        auth,
        ctx.params.id,
        String(form.get('artifactId')),
        String(form.get('operationId')),
        { storage: resolveStorage(ctx) },
      );
      if (!result.ok) return fail(result.code);
      return new Response(new Uint8Array(result.value.bytes), {
        headers: {
          'content-type': 'application/xml',
          'content-disposition': `attachment; filename="edition-${ctx.params.id}-sakai.xml"`,
          'cache-control': 'private, no-store',
          'etag': `"${result.value.receipt.sha256}"`,
        },
      });
    } else return fail('invalid_input');
    return new Response(null, { status: 303, headers: { location: `/releases/${ctx.params.id}` } });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const releasePackagesPageRoute = defineHttpRoute('/releases/:id/packages', { ...methods });
