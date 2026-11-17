import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { dispatchQuestionBankItemAction } from '../lib/services/question_bank_actions.ts';
import { bankSearchApiRoute as itemSearchEndpoint } from '../lib/http/routes/assessment_api/bank_search.ts';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import enUS from '../lib/i18n/messages/en-US/items.json' with { type: 'json' };
import enGB from '../lib/i18n/messages/en-GB/items.json' with { type: 'json' };
import esES from '../lib/i18n/messages/es-ES/items.json' with { type: 'json' };
import es419 from '../lib/i18n/messages/es-419/items.json' with { type: 'json' };
import {
  parseDetailErrorFeedback,
  parseDetailNoticeFeedback,
} from '../lib/services/item_bank_detail_page.ts';
import {
  detailActionFeedbackToken,
  presentDetailFeedback,
} from '../lib/http/routes/bank_pages/detail.tsx';

const ITEM_CATALOGS = { 'en-US': enUS, 'en-GB': enGB, 'es-ES': esES, 'es-419': es419 } as const;
import { ItemDetailFeedbackAlerts } from '../components/item_bank/ItemDetailView.tsx';
import { renderPage as renderToString } from './helpers/render_page.tsx';
import { h } from 'preact';

const itemSearch = itemSearchEndpoint.handle;

testCase('detail feedback accepts only source-qualified tokens', () => {
  const accepted = ['detail:action_failed', 'detail:unexpected', 'detail:invalid_input'] as const;
  for (const value of accepted) expect(parseDetailErrorFeedback(value)).toStrictEqual(value);
  for (const value of [null, '', 'updated', 'detail:updated:extra', 'error', 'The item changed']) {
    expect(parseDetailNoticeFeedback(value)).toStrictEqual(null);
  }
  expect(parseDetailErrorFeedback(null)).toStrictEqual(null);
  expect(parseDetailErrorFeedback('')).toStrictEqual(null);
  expect(parseDetailErrorFeedback('detail:updated:extra')).toStrictEqual('detail:unexpected');
  expect(parseDetailErrorFeedback('hostile prose')).toStrictEqual('detail:unexpected');
  expect(parseDetailErrorFeedback('detail:invalid_input')).toStrictEqual('detail:invalid_input');
  expect(parseDetailNoticeFeedback('detail:updated')).toStrictEqual('detail:updated');
  expect(parseDetailNoticeFeedback('detail:action_failed')).toStrictEqual(null);
  expect(parseDetailNoticeFeedback('detail:unexpected')).toStrictEqual(null);
});

testCase('detail action results map to closed redirect tokens', () => {
  expect(detailActionFeedbackToken({ ok: true })).toStrictEqual('detail:updated');
  expect(detailActionFeedbackToken({ ok: false, code: 'invalid_input' })).toStrictEqual(
    'detail:invalid_input',
  );
  expect(detailActionFeedbackToken({ ok: false, code: 'command_rejected' })).toStrictEqual(
    'detail:action_failed',
  );
});

testCase(
  'invalid item actions retain the legacy message with an internal classification',
  async () => {
    const result = await dispatchQuestionBankItemAction(
      { tenantId: 'tenant', userId: 'user', role: 'instructor' },
      'not-an-item-id',
      new FormData(),
    );
    expect(result).toStrictEqual({ ok: false, message: 'Item not found.', code: 'invalid_input' });
  },
);

testCase('item search preserves the legacy invalid-query envelope', async () => {
  const response = await invokeHttpMethod(
    itemSearch,
    'GET',
    makeHttpRequest(new Request('http://local/api/items/search?foo=bar')),
  );
  expect(response.status).toStrictEqual(400);
  expect(await response.json()).toStrictEqual({
    error: 'invalid_query',
    message: 'Unsupported item search filter.',
  });
});

testCase('detail boundary does not expose service prose or raw feedback values', async () => {
  const source = await _fs.readFile('lib/http/routes/bank_pages/detail.tsx', 'utf8');
  expect(source.includes('cause.message')).toStrictEqual(false);
  expect(source.includes('result.message')).toStrictEqual(false);
  expect(source.includes("url.searchParams.get('error')")).toStrictEqual(false);
  expect(source.includes('presentDetailFeedback')).toStrictEqual(true);
  expect(source.includes('detailActionFeedbackToken')).toStrictEqual(true);
  const viewSource = await _fs.readFile('components/item_bank/ItemDetailView.tsx', 'utf8');
  expect(viewSource.includes('data.notice && <BankAlert')).toStrictEqual(false);
  expect(viewSource.includes('data.error && <BankAlert')).toStrictEqual(false);
  expect(viewSource.includes('<ItemDetailFeedbackAlerts notice={data.notice}')).toStrictEqual(true);
});

testCase('detail alerts render localized route output without raw tokens', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, { items: ITEM_CATALOGS[locale] });
    const html = renderToString(h(ItemDetailFeedbackAlerts, {
      notice: i18n.t('items.detail.updated'),
      error: i18n.t('items.detail.actionFailed'),
    }));
    expect(html.includes(i18n.t('items.detail.updated'))).toStrictEqual(true);
    expect(html.includes(i18n.t('items.detail.actionFailed'))).toStrictEqual(true);
    expect(html.includes('role="status"')).toStrictEqual(true);
    expect(html.includes('role="alert"')).toStrictEqual(true);
    expect(html.includes('detail:')).toStrictEqual(false);
    if (locale.startsWith('es')) {
      expect(html.includes(ITEM_CATALOGS[locale]['items.detail.actionFailed'])).toStrictEqual(true);
    }
  }
});

testCase('detail feedback presentation is localized for every interface locale', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, { items: ITEM_CATALOGS[locale] });
    expect(presentDetailFeedback('detail:updated', i18n)).toStrictEqual(
      i18n.t('items.detail.updated'),
    );
    expect(presentDetailFeedback('detail:action_failed', i18n)).toStrictEqual(
      i18n.t('items.detail.actionFailed'),
    );
    expect(presentDetailFeedback('detail:unexpected', i18n)).toStrictEqual(
      i18n.t('items.detail.actionFailed'),
    );
    expect(presentDetailFeedback('detail:invalid_input', i18n)).toStrictEqual(
      i18n.t('items.detail.invalidInput'),
    );
  }
});
