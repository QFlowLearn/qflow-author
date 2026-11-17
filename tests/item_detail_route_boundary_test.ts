import { expect, test as testCase } from 'vitest';
import { renderPage } from './helpers/render_page.tsx';

import { Hono } from 'hono';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { shutdownDb } from '../lib/db.ts';
import { requireQaDatabaseUrl } from './helpers/qa_database.ts';

import { createI18n } from '../lib/i18n/messages.ts';
import enUSItems from '../lib/i18n/messages/en-US/items.json' with { type: 'json' };
import enGBItems from '../lib/i18n/messages/en-GB/items.json' with { type: 'json' };
import esESItems from '../lib/i18n/messages/es-ES/items.json' with { type: 'json' };
import es419Items from '../lib/i18n/messages/es-419/items.json' with { type: 'json' };
import { bankDetailPageRoute as handlerEndpoint } from '../lib/http/routes/bank_pages/detail.tsx';
import { metaBankRoute as itemMetaHandlerEndpoint } from '../lib/http/routes/bank_api/meta.ts';
import { questionSnapshotRoute as snapshotHandlerEndpoint } from '../lib/http/routes/bank_pages/question_snapshot.tsx';
import { invokeHttpMethod, invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const handler = handlerEndpoint.handle;
const itemMetaHandler = itemMetaHandlerEndpoint.handle;
const snapshotHandler = snapshotHandlerEndpoint.handle;

testCase('item history rejects a cursor that cannot identify an older page', async () => {
  const itemId = '11111111-1111-4111-8111-111111111111';
  const request = new Request(`http://local/items/${itemId}?historyBefore=1`);
  const response = await invokeHttpMethod(
    handler,
    'GET',
    makeHttpRequest(request, {
      params: { id: itemId },
      state: {
        interfaceLocale: 'en-US' as const,
        catalog: { items: enUSItems },
        i18n: createI18n('en-US', { items: enUSItems }),
      },
    }),
  );

  expect(response.status).toStrictEqual(400);
  expect(await response.text()).toStrictEqual(
    'The history, review, or comment page selection is invalid.',
  );
});

testCase('invalid item IDs use localized 404 responses for every locale', async () => {
  const catalogs = {
    'en-US': enUSItems,
    'en-GB': enGBItems,
    'es-ES': esESItems,
    'es-419': es419Items,
  } as const;
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, { items: catalogs[locale] });
    const state = { interfaceLocale: locale, catalog: { items: catalogs[locale] }, i18n };
    for (const method of ['GET', 'POST'] as const) {
      const request = new Request('http://local/items/not-an-id', { method });
      const response = await invokeHttpMethod(
        handler,
        method,
        makeHttpRequest(request, { params: { id: 'not-an-id' }, state }),
      );
      expect(response.status).toStrictEqual(404);
      expect(await response.text()).toStrictEqual(i18n.t('items.detail.notFound'));
    }
  }
});

testCase('item metadata route rejects the removed direct mutation path', async () => {
  const itemId = '11111111-1111-4111-8111-111111111111';
  const request = new Request(`http://local/api/items/${itemId}/meta`, {
    ...{ duplex: 'half' },
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Unaudited title', tags: ['unaudited'] }),
  });
  const response = await invokeHttpRoute(
    itemMetaHandler,
    makeHttpRequest(request, { params: { id: itemId } }),
  );

  expect(response.status).toStrictEqual(405);
});

testCase('snapshot rejects malformed ids and revisions with localized status', async () => {
  const catalogs = {
    'en-US': enUSItems,
    'en-GB': enGBItems,
    'es-ES': esESItems,
    'es-419': es419Items,
  } as const;
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, { items: catalogs[locale] });
    const state = { interfaceLocale: locale, catalog: { items: catalogs[locale] }, i18n };
    const getSnapshot = (ctx: ReturnType<typeof makeHttpRequest>) =>
      invokeHttpRoute(snapshotHandler, ctx);
    const badIdResponse = await getSnapshot(
      makeHttpRequest(new Request('http://local/items/nope/r/1'), {
        params: { itemId: 'nope', rev: '1' },
        state,
      }),
    );
    expect(badIdResponse.status).toStrictEqual(404);
    expect(await badIdResponse.text()).toStrictEqual(i18n.t('items.detail.notFound'));
    for (const rev of ['0', '-1', 'abc', '1.5']) {
      const response = await getSnapshot(
        makeHttpRequest(
          new Request(`http://local/items/11111111-1111-4111-8111-111111111111/r/${rev}`),
          { params: { itemId: '11111111-1111-4111-8111-111111111111', rev }, state },
        ),
      );
      expect(response.status).toStrictEqual(400);
      expect(await response.text()).toStrictEqual(i18n.t('items.detail.invalidRequest'));
    }
  }
});

testCase('snapshot missing revisions return HTTP 404 through the Hono HTTP boundary', async () => {
  requireQaDatabaseUrl(process.env['DATABASE_URL']);
  const catalog = catalogForLocale('en-US');
  const i18n = createI18n('en-US', catalog);
  const getSnapshot = snapshotHandler;
  const app = new Hono().get(
    '/items/:itemId/r/:rev',
    (ctx) =>
      getSnapshot(makeHttpRequest(ctx.req.raw, {
        auth: { tenantId: crypto.randomUUID(), userId: crypto.randomUUID(), role: 'owner' },
        params: ctx.req.param(),
        state: { interfaceLocale: 'en-US', catalog, i18n },
        render: (node, status) => new Response(renderPage(node), { status }),
      })),
  );

  try {
    const response = await app.fetch(
      new Request(`http://local/items/${crypto.randomUUID()}/r/1`),
    );
    expect(response.status).toStrictEqual(404);
    expect((await response.text()).includes(i18n.t('items.snapshot.revisionUnavailable')))
      .toStrictEqual(true);
  } finally {
    await shutdownDb();
  }
});
