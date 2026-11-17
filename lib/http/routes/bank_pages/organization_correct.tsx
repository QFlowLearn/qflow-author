import { mountIsland } from '../../../rendering/mount_island.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { enrichmentPageServices } from '../../bank_enrichment.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { parseEnrichmentScope } from '../../../services/bank_enrichment_scope.ts';
import { isCanonicalUuid } from '../../../uuid.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { BankEnrichmentLayout } from '../../../../components/item_bank/BankEnrichmentLayout.tsx';
import BankEnrichmentCorrectionView from '../../../../islands/BankEnrichmentCorrection.tsx';

const methods = {
  async GET(ctx) {
    const i18n = ctx.state.i18n, params = ctx.url.searchParams;
    const invalid = () => requestErrorResponse(i18n, 'invalid_authoring_data', 400);
    if ([...params.keys()].sort().join(',') !== 'scope,version') return invalid();
    const versionId = params.get('version'), raw = params.get('scope');
    if (!versionId || !isCanonicalUuid(versionId) || !raw || raw.length > 9000) return invalid();
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return invalid();
    }
    const scope = parseEnrichmentScope(input);
    if (!scope) return invalid();
    const auth = requireAuthContext(ctx.state), services = enrichmentPageServices(ctx);
    const inspected = await services.scopes.inspect(auth, input);
    if (!inspected.ok) {
      return requestErrorResponse(
        i18n,
        inspected.code === 'forbidden' ? 'forbidden' : 'invalid_authoring_data',
        inspected.code === 'forbidden' ? 403 : 400,
      );
    }
    const version = await services.schemes.getVersion(auth, versionId);
    if (!version.ok) return requestErrorResponse(i18n, 'not_found', 404);
    const backHref = scope._tag === 'Filtered'
      ? `/items?${scope.queryString}`
      : `/items?scheme=${version.value.schemeId}`;
    return ctx.render(
      <BankEnrichmentLayout
        title={i18n.t('items.organize.editClassifications')}
        backHref={backHref}
        i18n={i18n}
      >
        <div class='max-w-prose space-y-2'>
          <p class='font-medium'>
            {version.value.definition.name} · {version.value.definition.audience}
          </p>
          <p>
            {i18n.t(
              scope._tag === 'Selected'
                ? 'items.organize.correctSelected'
                : 'items.organize.correctMatching',
              { count: inspected.value },
            )}
          </p>
          <p class='text-sm text-base-content/80'>{i18n.t('items.organize.correctionHint')}</p>
          <p class='text-sm text-base-content/80'>{i18n.t('items.organize.teachingHint')}</p>
        </div>
        {inspected.value > 0 && (
          <BankEnrichmentCorrection
            operationId={crypto.randomUUID()}
            versionId={versionId}
            definition={version.value.definition}
            scope={scope}
            count={inspected.value}
            backHref={backHref}
            payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['items'])}
          />
        )}
      </BankEnrichmentLayout>,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankOrganizationCorrectPageRoute = defineHttpRoute('/items/organize/correct', {
  ...methods,
  HEAD: methods.GET,
});

const BankEnrichmentCorrection = mountIsland({
  component: 'BankEnrichmentCorrection',
  View: BankEnrichmentCorrectionView,
});
