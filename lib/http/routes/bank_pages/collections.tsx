import BankSectionNavigation from '../../../../components/item_bank/BankSectionNavigation.tsx';
import {
  type BankCollectionNavigation,
  BankCollections,
} from '../../../../components/item_bank/BankCollections.tsx';
import { BankAlert } from '../../../../components/item_bank/ui.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import type { I18n } from '../../../i18n/messages.ts';
import { hasCapability } from '../../../roles.ts';
import { parseBankCollectionForm } from '../../../services/bank_collection_forms.ts';
import {
  applyBankCollectionCommand,
  listBankCollections,
} from '../../../services/bank_collections.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { isCanonicalUuid } from '../../../uuid.ts';

type Data = {
  readonly workspace: BankCollectionNavigation;
  readonly selectedId: string | null;
  readonly canManage: boolean;
  readonly notice: boolean;
  readonly error: boolean;
  readonly i18n: I18n;
};

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const result = await listBankCollections(auth, true);
    if (!result.ok) return requestErrorResponse(ctx.state.i18n, 'forbidden', 403);
    const selectedId = ctx.url.searchParams.get('collection');
    if (
      selectedId !== null &&
      (!isCanonicalUuid(selectedId) || !result.collections.some((row) => row.id === selectedId))
    ) return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
    return ctx.render(
      <CollectionsPage
        workspace={{
          collections: result.collections,
          operationId: crypto.randomUUID(),
          createId: crypto.randomUUID(),
        }}
        selectedId={selectedId}
        canManage={hasCapability(auth.role, 'manage_content')}
        notice={ctx.url.searchParams.get('notice') === 'updated'}
        error={ctx.url.searchParams.get('error') === 'rejected'}
        i18n={ctx.state.i18n}
      />,
    );
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    const parsed = parseBankCollectionForm(await ctx.req.formData());
    const result = parsed
      ? await applyBankCollectionCommand(auth, parsed.operationId, parsed.command)
      : null;
    const url = new URL('/items/collections', ctx.url);
    if (result?.ok) {
      url.searchParams.set('collection', result.collectionId);
      url.searchParams.set('notice', 'updated');
    } else {
      if (parsed?.command._tag !== 'Create') {
        const selectedId = parsed?.command.collectionId ?? ctx.url.searchParams.get('collection');
        if (selectedId && isCanonicalUuid(selectedId)) {
          url.searchParams.set('collection', selectedId);
        }
      }
      url.searchParams.set('error', 'rejected');
    }
    return new Response(null, { status: 303, headers: { location: url.toString() } });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankCollectionsPageRoute = defineHttpRoute('/items/collections', {
  ...methods,
  HEAD: methods.GET,
});

function CollectionsPage({ workspace, selectedId, canManage, notice, error, i18n }: Data) {
  return (
    <section class='space-y-5'>
      <h1 class='text-3xl font-medium tracking-tight'>{i18n.t('items.collections.title')}</h1>
      <BankSectionNavigation
        current='collections'
        questionsHref='/items'
        overviewHref='/items?view=overview'
        i18n={i18n}
      />
      {notice && <BankAlert tone='success'>{i18n.t('items.collections.updated')}</BankAlert>}
      {error && <BankAlert tone='error'>{i18n.t('items.collections.rejected')}</BankAlert>}
      <div class='grid gap-6 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]'>
        <nav aria-label={i18n.t('items.collections.title')} class='min-w-0'>
          <ul class='divide-y divide-base-300 rounded-lg border border-base-300 bg-base-100'>
            {workspace.collections.length === 0 && (
              <li class='px-4 py-3 text-sm text-base-content/70'>
                {i18n.t('items.collections.empty')}
              </li>
            )}
            {workspace.collections.map((row) => (
              <li key={row.id}>
                <a
                  href={`/items/collections?collection=${row.id}`}
                  aria-current={selectedId === row.id ? 'page' : undefined}
                  class={`block break-words px-4 py-3 text-sm hover:bg-base-200 ${
                    selectedId === row.id ? 'bg-base-200 font-semibold' : ''
                  }`}
                >
                  {row.name}
                  {row.archivedAt && (
                    <span class='ml-2 text-xs text-base-content/70'>
                      {i18n.t('items.collections.archived')}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div class='min-w-0 rounded-lg border border-base-300 bg-base-100 p-4'>
          <BankCollections
            workspace={workspace}
            selectedId={selectedId}
            canManage={canManage}
            i18n={i18n}
            action='/items/collections'
          />
        </div>
      </div>
    </section>
  );
}
