import { parseQuestionAssistanceInput } from '../../../authoring/question_assistance.ts';
import { defineHttpRoute } from '../../route.ts';
import { handleQuestionAuthoring } from '../../question_assistance.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { requireContentWrite } from '../../../services/roles.ts';
import { getAssessment } from '../../../services/assessment_records.ts';
import { getEnv } from '../../../config.ts';
import { getRuntimeBinding } from '../../../runtime.ts';
import { isCanonicalUuid } from '../../../uuid.ts';
import {
  classifyQuestionStructure,
  loadClefAuthoringConfig,
} from '../../../ai/clef_authoring_provider.ts';
import type { ClefBinding } from '../../../ai/clef_organization_provider.ts';
import { isEnrichmentRecord } from '../../../ai/bank_enrichment_config.ts';
import { safeErrorSummary } from '../../../error_summary.ts';

export const questionAssistanceApiRoute = defineHttpRoute(
  '/api/assessments/:id/question-assistance',
  {
    '*': async (ctx) => {
      const auth = requireAuthContext(ctx.state);
      const denied = requireContentWrite(auth.role, ctx.req, ctx.state.i18n);
      if (denied) return denied;
      try {
        return await handleQuestionAuthoring(ctx.req, {
          authorize: async () =>
            isCanonicalUuid(ctx.params.id) && Boolean(await getAssessment(auth, ctx.params.id)),
          parse: parseQuestionAssistanceInput,
          timeoutMs: 10000,
          execute: async (input, signal) => {
            const config = loadClefAuthoringConfig((key) => getEnv(key, ctx));
            const ai = getRuntimeBinding(ctx, 'AI');
            const limiter = getRuntimeBinding(ctx, 'QFLOW_AUTHORING_RATE_LIMIT');
            if (
              !config || !isEnrichmentRecord(ai) || typeof ai.run !== 'function' ||
              !isEnrichmentRecord(limiter) || typeof limiter.limit !== 'function'
            ) return { ok: false, code: 'unavailable' };
            // SAFETY: platform capabilities are refined at this adapter seam, never accepted from HTTP input.
            const binding = ai as ClefBinding;
            const limits = limiter as {
              limit(input: { key: string }): Promise<{ success: boolean }>;
            };
            const allowance = await limits.limit({
              key: `authoring:${auth.tenantId}:${auth.userId}`,
            });
            if (!allowance.success) return { ok: false, code: 'limited' };
            return await classifyQuestionStructure(binding, config, input, signal);
          },
        });
      } catch (cause: unknown) {
        console.error('Question assistance failed', safeErrorSummary(cause));
        return Response.json({ error: 'unavailable' }, {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    },
  },
);
