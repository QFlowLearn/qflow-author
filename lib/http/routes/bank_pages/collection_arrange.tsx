import { mountIsland } from '../../../rendering/mount_island.ts';
import BankCollectionOrderView from '../../../../islands/BankCollectionOrder.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { getBankCollectionOrder } from '../../../services/bank_collection_order.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Arrange the entire collection, independently of catalog filters and pagination. */
const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const order = await getBankCollectionOrder(auth, ctx.params.id);
    if (!order.ok) {
      if (order.code === 'unavailable') {
        return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
      }
      return new Response(ctx.state.i18n.t('items.collections.orderTooLarge'), { status: 422 });
    }
    const payload = createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['items']);
    return ctx.render(
      <section class='space-y-5'>
        <h1 class='text-3xl font-medium'>{ctx.state.i18n.t('items.collections.arrange')}</h1>
        <BankCollectionOrder
          items={order.items}
          collectionId={ctx.params.id}
          operationId={crypto.randomUUID()}
          payload={payload}
        />
      </section>,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankCollectionArrangePageRoute = defineHttpRoute('/items/collections/:id/arrange', {
  ...methods,
  HEAD: methods.GET,
});

const BankCollectionOrder = mountIsland({
  component: 'BankCollectionOrder',
  View: BankCollectionOrderView,
});
