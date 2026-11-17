import { mountIsland } from '../../../rendering/mount_island.ts';
import { renderOrganizationPage } from '../../question_organization_page.tsx';
import { enrichmentSourceScope } from '../../../services/bank_enrichment_scope_contract.ts';
import { ENRICHMENT_DIMENSIONS } from '../../../services/bank_enrichment_contract.ts';
import { parseEnrichmentDimensions } from '../../../services/bank_enrichment_run_contract.ts';
import { enrichmentTaskTitle } from '../../../bank_enrichment_feedback.ts';
import { enrichmentResultHref } from '../../../services/bank_enrichment_query.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { hasCapability } from '../../../roles.ts';
import {
  enrichmentPageServices,
  enrichmentScopeName,
  handleEnrichmentAction,
} from '../../bank_enrichment.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { BankEnrichmentLayout } from '../../../../components/item_bank/BankEnrichmentLayout.tsx';
import { BankEnrichmentProgress } from '../../../../components/item_bank/BankEnrichmentProgress.tsx';
import BankEnrichmentSetupView from '../../../../islands/BankEnrichmentSetup.tsx';
import { loadEnrichmentAIConfig } from '../../../ai/bank_enrichment_config.ts';
import { getEnv } from '../../../config.ts';
import { uuidV5 } from '../../../uuid_v5.ts';

const methods = {
  async GET(ctx) {
    if (ctx.url.searchParams.get('kind') === 'organization') {
      return await renderOrganizationPage(ctx, ctx.params.id);
    }
    const auth = requireAuthContext(ctx.state),
      i18n = ctx.state.i18n,
      services = enrichmentPageServices(ctx);
    if (!hasCapability(auth.role, 'manage_content')) {
      return requestErrorResponse(i18n, 'forbidden', 403);
    }
    if (
      [...ctx.url.searchParams.keys()].some((key) => key !== 'fields') ||
      ctx.url.searchParams.getAll('fields').length > 1
    ) return requestErrorResponse(i18n, 'invalid_authoring_data', 400);
    const fields = ctx.url.searchParams.get('fields');
    const dimensions = fields === null
      ? ENRICHMENT_DIMENSIONS
      : parseEnrichmentDimensions(fields.split(','));
    if (!dimensions) return requestErrorResponse(i18n, 'invalid_authoring_data', 400);
    const found = await services.read.get(auth, ctx.params.id);
    if (!found.ok) {
      return requestErrorResponse(
        i18n,
        found.code === 'forbidden'
          ? 'forbidden'
          : found.code === 'storage_failed'
          ? 'internal_server_error'
          : 'not_found',
        found.code === 'forbidden' ? 403 : found.code === 'storage_failed' ? 500 : 404,
      );
    }
    const job = found.value;
    const scope = await services.scopes.get(auth, job.snapshotId);
    if (!scope.ok) return requestErrorResponse(i18n, 'not_found', 404);
    const sourceScope = enrichmentSourceScope(scope.value.scope);
    const sourceQuery = sourceScope._tag === 'Filtered' ? sourceScope.queryString : '';
    const backHref = job.kind !== 'preview'
      ? enrichmentResultHref(sourceQuery, job.schemeId)
      : `/items?${sourceQuery}`;
    const payload = createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['items']);
    const scopeName = await enrichmentScopeName(ctx, scope.value.scope);
    if (!scopeName.ok) {
      return requestErrorResponse(i18n, scopeName.code, scopeName.code === 'forbidden' ? 403 : 404);
    }
    if (job.kind === 'preview' && job.state === 'completed' && job.result && job.sample) {
      const started = await services.read.get(auth, await uuidV5(job.id, 'run'));
      if (started.ok) {
        return new Response(null, {
          status: 303,
          headers: { location: `/items/organize/${started.value.id}` },
        });
      }
      if (started.code !== 'not_found') {
        return requestErrorResponse(i18n, 'internal_server_error', 500);
      }
      const base = job.baseVersionId === null
        ? null
        : await services.schemes.getVersion(auth, job.baseVersionId);
      if (base && !base.ok) return requestErrorResponse(i18n, 'not_found', 404);
      const config = loadEnrichmentAIConfig((key) => getEnv(key, ctx));
      if (!config) {
        return new Response(i18n.t('items.organize.errorConfiguration'), { status: 503 });
      }
      const examples = await services.setup.examples(auth, job.result.definition);
      if (!examples.ok) return requestErrorResponse(i18n, 'internal_server_error', 500);
      const questions = [
        ...job.sample.questions,
        ...examples.value.filter((example) =>
          !job.sample?.questions.some((q) => q.revisionId === example.revisionId)
        ),
      ];
      return ctx.render(
        <BankEnrichmentLayout
          title={i18n.t('items.organize.customize')}
          backHref={backHref}
          i18n={i18n}
        >
          <p class='font-medium'>{scopeName.value}</p>
          <p class='text-sm text-base-content/80'>
            {i18n.t('items.organize.sampled', {
              sample: job.sample.questions.length,
              total: job.scopeCount,
            })}
          </p>
          <BankEnrichmentSetup
            id={job.id}
            initialDimensions={dimensions}
            affectedSelection={scope.value.scope._tag === 'Affected'}
            previewOperationId={crypto.randomUUID()}
            result={job.result}
            questions={questions}
            base={base?.ok ? base.value.definition : null}
            count={job.scopeCount}
            capturedAt={job.capturedAt}
            budgetMicros={config.runBudgetMicros}
            payload={payload}
          />
        </BankEnrichmentLayout>,
      );
    }
    return ctx.render(
      <BankEnrichmentLayout
        title={i18n.t(enrichmentTaskTitle(job.kind))}
        backHref={backHref}
        i18n={i18n}
      >
        <p class='font-medium'>{scopeName.value}</p>
        <BankEnrichmentProgress
          job={job}
          operationId={crypto.randomUUID()}
          i18n={i18n}
          payload={payload}
        />
      </BankEnrichmentLayout>,
    );
  },
  POST: (ctx) => handleEnrichmentAction(ctx, ctx.params.id),
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankOrganizationPageRoute = defineHttpRoute('/items/organize/:id', {
  ...methods,
  HEAD: methods.GET,
});

const BankEnrichmentSetup = mountIsland({
  component: 'BankEnrichmentSetup',
  View: BankEnrichmentSetupView,
});
