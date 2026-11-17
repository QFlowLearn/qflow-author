import { expect, test as testCase } from 'vitest';
import { makeHttpRequest } from './helpers/http_route.ts';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import QtiSampleReport, {
  qtiSampleReportPageRoute as handlerEndpoint,
} from '../lib/http/routes/public_pages/qti_sample_report.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';

const handler = handlerEndpoint.handle;

const SAMPLE_LOCALES = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
function sampleReportProps(locale: typeof SAMPLE_LOCALES[number]) {
  const catalog = catalogForLocale(locale);
  return {
    payload: createI18nPayload(locale, catalog, ['authoring', 'imports']),
    playerCatalog: playerMessageCatalogForLocale(locale),
    i18n: createI18n(locale, catalog),
  };
}

testCase('public sample QTI report renders read-only migration evidence', () => {
  for (const locale of SAMPLE_LOCALES) {
    const props = sampleReportProps(locale);
    const html = renderToString(<QtiSampleReport {...props} />);

    expect(html).toContain(props.i18n.t('help.sampleReport.title'));
    expect(html).toContain(props.i18n.t('help.sampleReport.download'));
    expect(html).toContain(props.i18n.t('help.sampleReport.details'));
    expect(html).toContain(props.i18n.t('imports.report.sourceEvidence'));
    expect(html).toContain(props.i18n.t('imports.report.minorReview'));
    expect(html).toContain(props.i18n.t('imports.report.blocked'));
    expect(html).toContain('district-algebra-qti12-export.zip');
    expect(html).toContain('href="/help/qti-sample-report?download=qa-report"');
    expect(html.match(/<h1/g)?.length).toStrictEqual(1);
    if (html.includes(props.i18n.t('imports.report.commitHeading'))) {
      expect.unreachable("Expected !html.includes(props.i18n.t('imports.report.commitHeading'))");
    }
    if (html.includes(props.i18n.t('imports.report.acceptSelected'))) {
      expect.unreachable("Expected !html.includes(props.i18n.t('imports.report.acceptSelected'))");
    }
    if (html.includes(props.i18n.t('imports.report.save'))) {
      expect.unreachable("Expected !html.includes(props.i18n.t('imports.report.save'))");
    }
    if (html.includes('name="reviewState"')) {
      expect.unreachable('Expected !html.includes(\'name="reviewState"\')');
    }
  }
});

testCase('public sample QTI report downloads the sample QA markdown', async () => {
  const req = new Request('https://example.test/help/qti-sample-report?download=qa-report');
  const res = await handler(makeHttpRequest(req, { omitAuth: true }));

  expect(res.status).toStrictEqual(200);
  expect(res.headers.get('content-type')).toStrictEqual('text/markdown; charset=utf-8');
  expect(res.headers.get('content-disposition') ?? '').toContain(
    'district-algebra-qti12-export-qa-report.md',
  );
  const body = await res.text();
  expect(body).toContain('# QFlowLearn Migration QA Report');
  expect(body).toContain('## Warning Guidance');
  expect(body).toContain('Unsupported item preserved as source');
});
