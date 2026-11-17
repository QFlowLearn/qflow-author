import Button from '../../../../components/ui/Button.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { listBankDraftSessions } from '../../../services/drafts.ts';
import { requireAuthContext } from '../../../tenants.ts';

const methods = {
  async GET(ctx) {
    const drafts = await listBankDraftSessions(requireAuthContext(ctx.state));
    const i18n = ctx.state.i18n;
    return ctx.render(
      <section class='space-y-5'>
        <a class='link' href='/items'>{i18n.t('nav.library')}</a>
        <h1 class='text-3xl font-medium'>{i18n.t('items.drafts.title')}</h1>
        <p>{i18n.t('items.drafts.help')}</p>
        <Button href='/items/new' variant='primary'>{i18n.t('items.drafts.create')}</Button>
        {drafts.length === 0 && <p>{i18n.t('items.drafts.empty')}</p>}
        <ul class='divide-y divide-base-300'>
          {drafts.map((draft) => (
            <li key={draft.id} class='py-3'>
              <Button href={`/items/drafts/${draft.id}`} variant='ghost'>
                {draft.draft.title}
              </Button>
            </li>
          ))}
        </ul>
      </section>,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankDraftsPageRoute = defineHttpRoute('/items/drafts', {
  ...methods,
  HEAD: methods.GET,
});
