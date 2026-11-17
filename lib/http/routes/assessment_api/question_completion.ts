import { parseQuestionComposition } from '../../../authoring/question_composition.ts';
import { completeQuestion } from '../../../ai/question_completion_provider.ts';
import { defineHttpRoute } from '../../route.ts';
import { handleQuestionAuthoring } from '../../question_assistance.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { requireContentWrite } from '../../../services/roles.ts';
import { getAssessment } from '../../../services/assessment_records.ts';
import { getEnv } from '../../../config.ts';
import { getRuntimeBinding } from '../../../runtime.ts';
import { isCanonicalUuid } from '../../../uuid.ts';
import type { CloudflareWorkersAiBinding } from '../../../ai/cloudflare_workers.ts';
import { isEnrichmentRecord } from '../../../ai/bank_enrichment_config.ts';
import { safeErrorSummary } from '../../../error_summary.ts';

export const questionCompletionApiRoute = defineHttpRoute(
  '/api/assessments/:id/question-completion',
  {
    '*': async (ctx) => {
      const auth = requireAuthContext(ctx.state);
      const denied = requireContentWrite(auth.role, ctx.req, ctx.state.i18n);
      if (denied) return denied;
      try {
        return await handleQuestionAuthoring(ctx.req, {
          authorize: async () =>
            isCanonicalUuid(ctx.params.id) && Boolean(await getAssessment(auth, ctx.params.id)),
          parse: (raw) => {
            const parsed = parseQuestionComposition(raw);
            return parsed?.complete ? parsed : null;
          },
          timeoutMs: 45000,
          execute: async (input, signal) => {
            const model = getEnv('QFLOW_CLOUDFLARE_AI_MODEL', ctx);
            const provider = getEnv('QFLOW_AI_PROVIDER', ctx);
            const ai = getRuntimeBinding(ctx, 'AI');
            const limiter = getRuntimeBinding(ctx, 'QFLOW_AUTHORING_RATE_LIMIT');
            if (
              !model || provider !== 'cloudflare' || !isEnrichmentRecord(ai) ||
              typeof ai.run !== 'function' ||
              !isEnrichmentRecord(limiter) || typeof limiter.limit !== 'function'
            ) return { ok: false, code: 'unavailable' };
            // SAFETY: platform capabilities are refined at this adapter seam, never accepted from HTTP input.
            const binding = ai as CloudflareWorkersAiBinding;
            const limits = limiter as {
              limit(input: { key: string }): Promise<{ success: boolean }>;
            };
            const allowance = await limits.limit({
              key: `authoring:${auth.tenantId}:${auth.userId}`,
            });
            if (!allowance.success) return { ok: false, code: 'limited' };
            return await completeQuestion(binding, model, input, { signal });
          },
        });
      } catch (cause: unknown) {
        console.error('Question completion failed', safeErrorSummary(cause));
        return Response.json(
          { error: 'unavailable' },
          { status: 503, headers: { 'Cache-Control': 'no-store' } },
        );
      }
    },
  },
);
