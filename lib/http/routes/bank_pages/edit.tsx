import { mountIsland } from '../../../rendering/mount_island.ts';
import type { QuestionPointEditingAuthority } from '../../../question_point_authority.ts';
import { questionPointEditingAuthority } from '../../../services/question_points_editing.ts';
import { getQuestionRevisionPublicationSource } from '../../../services/questions.ts';
import Button from '../../../../components/ui/Button.tsx';
import ItemEditorView from '../../../../islands/ItemEditor.tsx';
import { openLatestRevisionDraftSession } from '../../../services/drafts.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { Draft } from '../../../types/draft.ts';
import { parseQuestionBankItemId } from '../../../services/question_bank_actions.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import type { DraftSessionId } from '../../../draft_session_id.ts';
import { getUserSettings } from '../../../services/user_settings.ts';
import { createI18nPayload, type I18nPayload } from '../../../i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../../../i18n/player_messages/catalogs.ts';
import { createI18n } from '../../../i18n/messages.ts';
import type { QflowPlayerMessageCatalog } from '../../../i18n/player_messages/types.ts';
import { requestErrorResponse } from '../../request_error_response.ts';

type Data = {
  readonly pointEditingAuthority: QuestionPointEditingAuthority;
  readonly itemId: string;
  readonly sourceRevisionId: string;
  readonly sessionId: DraftSessionId;
  readonly draft: Draft;
  readonly tagsCsv: string;
  readonly choiceRichText: boolean;
  readonly payload: I18nPayload;
  readonly playerCatalog: QflowPlayerMessageCatalog;
};

const methods = {
  async GET(ctx) {
    const itemId = parseQuestionBankItemId(ctx.params.id);
    if (!itemId) return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
    const auth = requireAuthContext(ctx.state);
    const opened = await openLatestRevisionDraftSession(auth, itemId);
    if (!opened.ok) {
      if (opened.code === 'forbidden') {
        return requestErrorResponse(ctx.state.i18n, 'forbidden', 403);
      }
      if (opened.code === 'not_found') {
        return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
      }
      if (opened.code === 'archived') {
        return requestErrorResponse(
          ctx.state.i18n,
          'restore_before_editing',
          409,
        );
      }
      return requestErrorResponse(
        ctx.state.i18n,
        'invalid_authoring_data',
        422,
      );
    }
    const source = await getQuestionRevisionPublicationSource(auth, opened.sourceRevisionId);
    if (!source) return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
    const authority = questionPointEditingAuthority({
      contentBasis: source.baseline.revision.event.contentBasis,
      sourceXml: source.baseline.revision.qtiXml,
    });
    const userSettings = await getUserSettings(auth.userId);
    return ctx.render(
      <EditBankItem
        pointEditingAuthority={authority}
        itemId={opened.itemId}
        sourceRevisionId={opened.sourceRevisionId}
        sessionId={opened.session.id}
        draft={opened.session.draft}
        tagsCsv={opened.tags.join(', ')}
        choiceRichText={userSettings.choiceRichText}
        payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['authoring'])}
        playerCatalog={playerMessageCatalogForLocale(ctx.state.interfaceLocale)}
      />,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankEditPageRoute = defineHttpRoute('/items/:id/edit', {
  ...methods,
  HEAD: methods.GET,
});

export default function EditBankItem(data: Data) {
  const i18n = createI18n(data.payload.locale, data.payload.namespaces);
  return (
    <section class='space-y-4'>
      <div class='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p class='text-sm text-base-content/65'>{i18n.t('editor.workingDraft')}</p>
          <h1 class='text-2xl font-medium'>{i18n.t('editor.createRevision')}</h1>
          <p class='mt-1 max-w-2xl text-sm text-base-content/70'>
            {i18n.t('editor.revisionHelp')}
          </p>
        </div>
        <Button href={`/items/${data.itemId}`} variant='ghost'>
          {i18n.t('editor.backToItem')}
        </Button>
      </div>
      <ItemEditor
        pointEditingAuthority={data.pointEditingAuthority}
        itemId={data.itemId}
        choiceRichText={data.choiceRichText}
        payload={data.payload}
        playerCatalog={data.playerCatalog}
        initialDraft={data.draft}
        persistence={{
          _tag: 'Revision',
          draftSessionId: data.sessionId,
          sourceRevisionId: data.sourceRevisionId,
          returnHref: `/items/${data.itemId}`,
        }}
        tagsCsv={data.tagsCsv}
      />
    </section>
  );
}

const ItemEditor = mountIsland({ component: 'ItemEditor', View: ItemEditorView });
