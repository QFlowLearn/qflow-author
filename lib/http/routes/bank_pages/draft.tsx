import { mountIsland } from '../../../rendering/mount_island.ts';
import ItemEditorView from '../../../../islands/ItemEditor.tsx';
import Button from '../../../../components/ui/Button.tsx';
import { parseDraftSessionId } from '../../../draft_session_id.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../../../i18n/player_messages/catalogs.ts';
import { getDraftSession } from '../../../services/drafts.ts';
import { getUserSettings } from '../../../services/user_settings.ts';
import { requireAuthContext } from '../../../tenants.ts';

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const id = parseDraftSessionId(ctx.params.id);
    const session = id ? await getDraftSession(auth, id) : null;
    if (!session || session.binding._tag !== 'Bank') {
      return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
    }
    if (session.binding.publishedQuestionId !== null) {
      return new Response(null, {
        status: 303,
        headers: { location: `/items/${session.binding.publishedQuestionId}` },
      });
    }
    const settings = await getUserSettings(auth.userId);
    const payload = createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['authoring']);
    return ctx.render(
      <section class='space-y-5'>
        <h1 class='text-3xl font-medium'>{ctx.state.i18n.t('items.drafts.create')}</h1>
        <Button href='/items/drafts' variant='ghost'>
          {ctx.state.i18n.t('items.drafts.title')}
        </Button>
        <ItemEditor
          pointEditingAuthority={{ _tag: 'Generated' }}
          initialDraft={session.draft}
          persistence={{ _tag: 'Bank', draftSessionId: session.id }}
          choiceRichText={settings.choiceRichText}
          payload={payload}
          playerCatalog={playerMessageCatalogForLocale(ctx.state.interfaceLocale)}
        />
      </section>,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankDraftPageRoute = defineHttpRoute('/items/drafts/:id', {
  ...methods,
  HEAD: methods.GET,
});

const ItemEditor = mountIsland({ component: 'ItemEditor', View: ItemEditorView });
