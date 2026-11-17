import SnapshotView, {
  type SnapshotData,
} from '../../../../components/item_bank/QuestionSnapshotPage.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { getQuestionRevision } from '../../../services/questions.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../../../i18n/player_messages/catalogs.ts';
import { createI18n } from '../../../i18n/messages.ts';
import { isCanonicalUuid } from '../../../uuid.ts';

export const questionSnapshotRoute = defineHttpRoute('/items/:itemId/r/:rev', {
  GET: get,
  HEAD: get,
});

async function get(ctx: HttpRequest) {
  const itemId = ctx.params.itemId;
  const rev = Number(ctx.params.rev);
  const i18n = ctx.state.i18n;
  if (!isCanonicalUuid(itemId)) {
    return new Response(i18n.t('items.detail.notFound'), { status: 404 });
  }
  if (!Number.isSafeInteger(rev) || rev < 1) {
    return new Response(i18n.t('items.detail.invalidRequest'), { status: 400 });
  }
  const auth = requireAuthContext(ctx.state);
  const revision = await getQuestionRevision(auth, itemId, rev);
  const data: SnapshotData = {
    itemId,
    rev,
    xml: revision?.qtiXml ?? null,
    title: typeof revision?.body?.title === 'string' ? revision.body.title : null,
    payload: createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['authoring']),
    playerCatalog: playerMessageCatalogForLocale(ctx.state.interfaceLocale),
    i18n: createI18n(ctx.state.interfaceLocale, ctx.state.catalog),
  };
  return ctx.render(<SnapshotView {...data} />, revision ? 200 : 404);
}
