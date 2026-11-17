import { mountIsland } from '../../../rendering/mount_island.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { enrichmentPageServices, handleEnrichmentAction } from '../../bank_enrichment.ts';
import { organizationPageService, organizationRunHref } from '../../question_organization.ts';
import { parseEnrichmentScope } from '../../../services/bank_enrichment_scope.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { BankEnrichmentLayout } from '../../../../components/item_bank/BankEnrichmentLayout.tsx';
import QuestionOrganizationSetupView from '../../../../islands/QuestionOrganizationSetup.tsx';
import { createI18nPayload } from '../../../i18n/payload.ts';
import Button from '../../../../components/ui/Button.tsx';

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state), i18n = ctx.state.i18n;
    if (
      [...ctx.url.searchParams.keys()].some((k) => k !== 'scope') ||
      ctx.url.searchParams.getAll('scope').length > 1
    ) return requestErrorResponse(i18n, 'invalid_authoring_data', 400);
    const scope = parseEnrichmentScope({
      _tag: 'Filtered',
      queryString: ctx.url.searchParams.get('scope') ?? '',
    });
    if (!scope || scope._tag !== 'Filtered') {
      return requestErrorResponse(i18n, 'invalid_authoring_data', 400);
    }
    const home = await organizationPageService(ctx).home(auth);
    if (!home.ok) {
      return requestErrorResponse(
        i18n,
        home.code === 'forbidden' ? 'forbidden' : 'internal_server_error',
        home.code === 'forbidden' ? 403 : 500,
      );
    }
    const history = await enrichmentPageServices(ctx).setup.home(auth);
    if (!history.ok) return requestErrorResponse(i18n, 'internal_server_error', 500);
    const collection = scope.query.collection;
    return ctx.render(
      <BankEnrichmentLayout
        title={i18n.t('items.organize.title')}
        backHref={`/items?${scope.queryString}`}
        i18n={i18n}
      >
        <p class='max-w-prose'>{i18n.t('items.organization.intro')}</p>
        {home.value.collections.length > 0
          ? (
            <QuestionOrganizationSetup
              home={home.value}
              initialCollectionId={collection?._tag === 'Collection' ? collection.collectionId : ''}
              operationId={crypto.randomUUID()}
              payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['items'])}
            />
          )
          : <p>{i18n.t('items.organization.empty')}</p>}
        {(home.value.recent.length > 0 || history.value.recent.length > 0) && (
          <section class='border-t border-base-300 pt-4'>
            <h2 class='font-semibold'>{i18n.t('items.organize.recent')}</h2>
            <ul>
              {home.value.recent.map((run) => (
                <li key={run.id}>
                  <Button href={organizationRunHref(run.id)} variant='ghost'>
                    {run.name} · {i18n.t(
                      run.mode === 'preview'
                        ? 'items.organization.preview'
                        : 'items.organization.apply',
                    )} · {i18n.t(`items.organization.state.${run.state}`)}
                  </Button>
                </li>
              ))}
              {history.value.recent.map((task) => (
                <li key={task.id}>
                  <Button href={`/items/organize/${task.id}`} variant='ghost'>
                    {i18n.t(`items.organize.${
                      task.kind === 'preview'
                        ? 'previewTask'
                        : task.kind === 'classify'
                        ? 'tagTask'
                        : task.kind === 'correct'
                        ? 'correctTask'
                        : 'undoTask'
                    }`)}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </BankEnrichmentLayout>,
    );
  },
  POST: (ctx) => handleEnrichmentAction(ctx, null),
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankOrganizePageRoute = defineHttpRoute('/items/organize', {
  ...methods,
  HEAD: methods.GET,
});

const QuestionOrganizationSetup = mountIsland({
  component: 'QuestionOrganizationSetup',
  View: QuestionOrganizationSetupView,
});
