import ItemBankDetailView from '../../../../components/item_bank/ItemDetailView.tsx';
import { loadItemBankDetailPageData } from '../../../services/item_bank_detail_page.ts';
import {
  dispatchQuestionBankItemAction,
  type QuestionBankItemActionResult,
} from '../../../services/question_bank_actions.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { hasCapability } from '../../../roles.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import {
  itemDetailHref,
  ItemDetailQueryError,
  parseItemDetailQuery,
} from '../../../item_detail_query.ts';
import { parseQuestionBankItemId } from '../../../services/question_bank_actions.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../../../i18n/player_messages/catalogs.ts';
import { createI18n } from '../../../i18n/messages.ts';
import type { DetailFeedbackToken } from '../../../services/item_bank_detail_page.ts';

/** Present a closed detail feedback token through the request locale. */
export function presentDetailFeedback(
  token: DetailFeedbackToken,
  i18n: ReturnType<typeof createI18n>,
): string {
  switch (token) {
    case 'restore:invalid_reference':
    case 'restore:forbidden':
    case 'restore:source_unavailable':
    case 'restore:stale_revision':
    case 'restore:archived':
    case 'restore:invalid_source':
      return i18n.t(`items.detail.${token.replace(':', '.')}`);
    case 'detail:updated':
      return i18n.t('items.detail.updated');
    case 'detail:invalid_input':
      return i18n.t('items.detail.invalidInput');
    case 'detail:action_failed':
    case 'detail:unexpected':
      return i18n.t('items.detail.actionFailed');
  }
}

/** Build the safe redirect token for one typed item-detail action result. */
export function detailActionFeedbackToken(
  result:
    | QuestionBankItemActionResult
    | { readonly ok: false; readonly code: 'invalid_input' | 'command_rejected' | 'unexpected' },
): DetailFeedbackToken {
  if (result.ok) return 'detail:updated';
  switch (result.code) {
    case 'restore:invalid_reference':
    case 'restore:forbidden':
    case 'restore:source_unavailable':
    case 'restore:stale_revision':
    case 'restore:archived':
    case 'restore:invalid_source':
      return result.code;
  }
  if (result.code === 'unexpected') return 'detail:unexpected';
  return result.code === 'invalid_input' ? 'detail:invalid_input' : 'detail:action_failed';
}

const methods = {
  async GET(ctx) {
    const i18n = ctx.state.i18n;
    if (!parseQuestionBankItemId(ctx.params.id)) {
      return new Response(i18n.t('items.detail.notFound'), { status: 404 });
    }
    const auth = requireAuthContext(ctx.state);
    let data;
    try {
      data = await loadItemBankDetailPageData(auth, ctx.params.id, ctx.url);
    } catch (cause: unknown) {
      if (cause instanceof ItemDetailQueryError) {
        return new Response(i18n.t(`items.detail.queryError.${cause.code}`), { status: 400 });
      }
      throw cause;
    }
    if (!data) return new Response(i18n.t('items.detail.notFound'), { status: 404 });
    return ctx.render(
      <ItemBankDetailView
        {...data}
        notice={data.notice ? presentDetailFeedback(data.notice, i18n) : null}
        error={data.error ? presentDetailFeedback(data.error, i18n) : null}
        previewPayload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, [
          'authoring',
        ])}
        memberPickerPayload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, [
          'items',
        ])}
        playerCatalog={playerMessageCatalogForLocale(ctx.state.interfaceLocale)}
        canManageContent={hasCapability(auth.role, 'manage_content')}
      />,
    );
  },
  async POST(ctx) {
    if (!parseQuestionBankItemId(ctx.params.id)) {
      return new Response(ctx.state.i18n.t('items.detail.notFound'), { status: 404 });
    }
    const auth = requireAuthContext(ctx.state);
    let query;
    try {
      query = parseItemDetailQuery(ctx.url.searchParams);
    } catch (cause: unknown) {
      if (cause instanceof ItemDetailQueryError) {
        return new Response(ctx.state.i18n.t(`items.detail.queryError.${cause.code}`), {
          status: 400,
        });
      }
      throw cause;
    }
    let result;
    try {
      result = await dispatchQuestionBankItemAction(auth, ctx.params.id, await ctx.req.formData());
    } catch (_cause: unknown) {
      result = { ok: false as const, code: 'unexpected' as const };
    }
    const url = new URL(itemDetailHref(ctx.params.id, query, 'item-history-heading'), ctx.url);
    url.searchParams.set(
      result.ok ? 'notice' : 'error',
      detailActionFeedbackToken(result),
    );
    return new Response(null, { status: 303, headers: { location: url.toString() } });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankDetailPageRoute = defineHttpRoute('/items/:id', { ...methods, HEAD: methods.GET });
