import { expect, it } from 'vitest';
import { createElement } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { bankOverviewFixture } from '../helpers/bank_overview_fixture.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../../lib/i18n/payload.ts';
import {
  encodeRootPayload,
  parseRootPayload,
  type RootPayload,
} from '../../lib/client/root_payload.ts';
import { HydrationRoot } from '../../lib/server/HydrationRoot.tsx';

it('transports one overview tree with versioned counts, links and initially hidden topic rows', () => {
  const { view, query } = bankOverviewFixture();
  const payload: RootPayload = {
    id: 'qf-bank-overview',
    component: 'BankOverview',
    props: {
      view,
      query,
      payload: createI18nPayload('en-US', catalogForLocale('en-US'), ['items']),
    },
  };
  const decoded: unknown = JSON.parse(encodeRootPayload(payload));
  expect(decoded).toEqual(payload);
  const parsed = parseRootPayload(decoded);
  expect(parsed).toEqual({ _tag: 'Parsed', value: payload });
  const html = renderToString(createElement(HydrationRoot, { payload }));
  expect(html).toContain('id="overview-topics-0" hidden');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('Open 7,787 questions: Life science / Easy');
  expect(html).toContain('Cells');
  expect(html.match(/data-qflow-root=/g)).toHaveLength(1);
  expect(html).not.toMatch(/<table[^>]*>\s*<div/);
});
