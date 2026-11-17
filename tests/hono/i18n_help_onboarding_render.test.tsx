import { expect, it } from 'vitest';

import { renderPage as render } from '../helpers/render_page.tsx';
import { h } from 'preact';
import { createI18n } from '../../lib/i18n/messages.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import OnboardingPage from '../../lib/http/routes/public_pages/onboarding.tsx';
import Qti3ImportRequirements from '../../lib/http/routes/public_pages/qti3_import.tsx';
import QtiFidelity from '../../lib/http/routes/public_pages/qti_fidelity.tsx';
import PortabilityPledge from '../../lib/http/routes/public_pages/portability.tsx';
import QtiSampleReport from '../../lib/http/routes/public_pages/qti_sample_report.tsx';
import { createI18nPayload } from '../../lib/i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../../lib/i18n/player_messages/catalogs.ts';
import NotFound from '../../components/NotFound.tsx';
import ErrorPage from '../../components/ErrorPage.tsx';
import { qtiSampleReportPageRoute as sampleHandler } from '../../lib/http/routes/public_pages/qti_sample_report.tsx';
import { apiRequest } from '../helpers/http_request_fixture.ts';
import type { HttpRequest } from '../../lib/http/route.ts';
import type { InterfaceLocale } from '../../lib/i18n/locale.ts';
import { buildMigrationQaReport } from '../../lib/import/migration_qa_report.ts';
import { SAMPLE_QTI_MIGRATION_RUN } from '../../lib/sample_migration_report.ts';
import { attachmentContentDisposition } from '../../lib/http/attachment_content_disposition.ts';
import { qaReportFilename } from '../../components/imports/migration_report_page.tsx';
import { onboardingPageRoute as onboardingHandler } from '../../lib/http/routes/public_pages/onboarding.tsx';
import { authorNotFoundResponse } from '../../lib/http/routes/public_pages/author.tsx';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;

function checkLocaleCase1(locale: InterfaceLocale) {
  const i18n = createI18n(locale, catalogForLocale(locale));
  const errorProps = { state: { i18n } };
  const pages = [
    render(<OnboardingPage i18n={i18n} />),
    render(<Qti3ImportRequirements i18n={i18n} />),
    render(<QtiFidelity i18n={i18n} />),
    render(<PortabilityPledge i18n={i18n} />),
    render(
      <QtiSampleReport
        i18n={i18n}
        payload={createI18nPayload(locale, catalogForLocale(locale), ['authoring', 'imports'])}
        playerCatalog={playerMessageCatalogForLocale(locale)}
      />,
    ),
    render(<NotFound {...errorProps} />),
    render(<ErrorPage {...errorProps} />),
  ];
  assertStringIncludes(pages[0], i18n.t('help.onboarding.title'));
  assertStringIncludes(pages[0], i18n.t('help.onboarding.demo.action'));
  assertStringIncludes(pages[0], 'name="action" value="demo"');
  assertStringIncludes(pages[0], 'name="action" value="blank"');
  assertStringIncludes(pages[1], i18n.t('help.qti3.title'));
  assertStringIncludes(pages[1], 'imsmanifest.xml');
  assertStringIncludes(pages[2], i18n.t('help.fidelity.title'));
  assertStringIncludes(pages[2], 'QTI 3.0');
  assertStringIncludes(pages[3], i18n.t('help.portability.title'));
  assertStringIncludes(pages[3], 'QTI 3');
  assertStringIncludes(pages[4], i18n.t('help.sampleReport.title'));
  assertStringIncludes(pages[4], i18n.t('help.sampleReport.download'));
  assertStringIncludes(pages[4], i18n.t('help.sampleReport.description'));
  assertStringIncludes(pages[5], i18n.t('help.page.notFound.title'));
  assertStringIncludes(pages[5], i18n.t('help.page.notFound.description'));
  assertStringIncludes(pages[5], i18n.t('help.page.back'));
  assertStringIncludes(pages[5], '/assessments');
  assertStringIncludes(pages[6], i18n.t('help.page.error.title'));
  assertStringIncludes(pages[6], i18n.t('help.page.error.description'));
  assertStringIncludes(pages[6], i18n.t('help.page.back'));
  assertStringIncludes(pages[6], '/assessments');
  for (const html of pages.slice(5)) {
    if (!(!html.includes('Error:') && !html.includes('stack-secret'))) {
      expect.unreachable("Expected !html.includes('Error:') && !html.includes('stack-secret')");
    }
  }
  for (const html of pages) {
    if (html.includes('help.')) expect.unreachable("Expected !html.includes('help.')");
  }
}
it('help and onboarding render in en-US', () => checkLocaleCase1('en-US'));
it('help and onboarding render in en-GB', () => checkLocaleCase1('en-GB'));
it('help and onboarding render in es-ES', () => checkLocaleCase1('es-ES'));
it('help and onboarding render in es-419', () => checkLocaleCase1('es-419'));
it('help and onboarding render in sv-SE', () => checkLocaleCase1('sv-SE'));

it('sample QA download is locale-independent', async () => {
  const expected = buildMigrationQaReport(SAMPLE_QTI_MIGRATION_RUN, new Date(0));
  const results: Array<{ body: string; type: string | null; disposition: string | null }> = [];
  for (const locale of locales) {
    const context = pageRequest(
      new Request('http://local/help/qti-sample-report?download=qa-report'),
      { state: { interfaceLocale: locale } },
    );
    const response = await sampleHandler.handle(context);
    results.push({
      body: await response.text(),
      type: response.headers.get('content-type'),
      disposition: response.headers.get('content-disposition'),
    });
  }
  for (const result of results) {
    const stableBody = result.body.replace(
      /^Generated: .*$/m,
      'Generated: 1970-01-01T00:00:00.000Z',
    );
    if (stableBody !== expected) throw new Error('download artifact changed by locale');
    if (result.type !== 'text/markdown; charset=utf-8') throw new Error('unexpected content type');
    if (
      result.disposition !==
      attachmentContentDisposition(qaReportFilename(SAMPLE_QTI_MIGRATION_RUN))
    ) {
      throw new Error('unexpected content disposition');
    }
  }
  for (const result of results.slice(1)) {
    const stable = (body: string) =>
      body.replace(/^Generated: .*$/m, 'Generated: 1970-01-01T00:00:00.000Z');
    if (
      stable(result.body) !== stable(results[0].body) ||
      result.disposition !== results[0].disposition
    ) {
      throw new Error(`download headers differ: ${JSON.stringify(results)}`);
    }
  }
});

it('help copy differs between English and Spanish', () => {
  const us = createI18n('en-US', catalogForLocale('en-US'));
  const es = createI18n('es-ES', catalogForLocale('es-ES'));
  const usHtml = render(<Qti3ImportRequirements i18n={us} />);
  const esHtml = render(<Qti3ImportRequirements i18n={es} />);
  if (!(usHtml !== esHtml)) expect.unreachable('Expected usHtml !== esHtml');
  const usFidelity = render(<QtiFidelity i18n={us} />);
  const gb = createI18n('en-GB', catalogForLocale('en-GB'));
  const gbFidelity = render(<QtiFidelity i18n={gb} />);
  assertStringIncludes(usFidelity, 'behavior');
  if (usFidelity.includes('behaviour')) {
    expect.unreachable("Expected !usFidelity.includes('behaviour')");
  }
  assertStringIncludes(gbFidelity, 'behaviour');
  if (gbFidelity.includes('behavior')) {
    expect.unreachable("Expected !gbFidelity.includes('behavior')");
  }
  assertStringIncludes(
    render(
      <QtiSampleReport
        i18n={gb}
        payload={createI18nPayload('en-GB', catalogForLocale('en-GB'), ['authoring', 'imports'])}
        playerCatalog={playerMessageCatalogForLocale('en-GB')}
      />,
    ),
    'analysing',
  );
});

function checkLocaleCase2(locale: InterfaceLocale) {
  const i18n = createI18n(locale, catalogForLocale(locale));
  const qti = render(<Qti3ImportRequirements i18n={i18n} />);
  assertStringIncludes(qti, '<code class="rounded-sm bg-base-200 px-1">.zip</code>');
  assertStringIncludes(qti, '<code class="rounded-sm bg-base-200 px-1">imsmanifest.xml</code>');
  assertStringIncludes(qti, '<code class="rounded-sm bg-base-200 px-1">&lt;file></code>');
  assertStringIncludes(qti, '<code class="rounded-sm bg-base-200 px-1">assets/diagram.svg</code>');
  assertStringIncludes(qti, i18n.t('help.qti3.pathsSuffix'));
  const fidelity = render(<QtiFidelity i18n={i18n} />);
  for (
    const id of [
      'help.fidelity.stepImport',
      'help.fidelity.stepSummary',
      'help.fidelity.stepReview',
      'help.fidelity.stepCreate',
      'help.fidelity.imported',
      'help.fidelity.converted',
      'help.fidelity.needsReview',
      'help.fidelity.sourcePreserved',
      'help.fidelity.warningTask',
      'help.fidelity.sourceAvailable',
      'help.fidelity.reportConversions',
    ]
  ) assertStringIncludes(fidelity, i18n.t(id));
  const portability = render(<PortabilityPledge i18n={i18n} />);
  for (
    const id of [
      'help.portability.commitmentOwnershipDetail',
      'help.portability.commitmentFeeDetail',
      'help.portability.commitmentAiDetail',
      'help.portability.commitmentLossDetail',
      'help.portability.commitmentQtiDetail',
      'help.portability.paidAi',
      'help.portability.paidBulk',
      'help.portability.paidReview',
      'help.portability.paidIntegrations',
    ]
  ) {
    assertStringIncludes(portability, i18n.t(id));
  }
}
it('help technical tokens and distinct guidance in en-US', () => checkLocaleCase2('en-US'));
it('help technical tokens and distinct guidance in en-GB', () => checkLocaleCase2('en-GB'));
it('help technical tokens and distinct guidance in es-ES', () => checkLocaleCase2('es-ES'));
it('help technical tokens and distinct guidance in es-419', () => checkLocaleCase2('es-419'));
it('help technical tokens and distinct guidance in sv-SE', () => checkLocaleCase2('sv-SE'));

async function checkLocaleCase3(locale: InterfaceLocale) {
  const i18n = createI18n(locale, catalogForLocale(locale));
  const renderResponse: HttpRequest['render'] = (
    vnode,
    init,
  ) => Promise.resolve(new Response(render(vnode ?? h('span', null)), { status: init }));
  const invalid = await onboardingHandler.handle(pageRequest(
    new Request('http://local/onboarding', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: new URLSearchParams({ action: 'unknown' }),
    }),
    {
      state: { interfaceLocale: locale },
      render: renderResponse,
    },
  ));
  if (!(invalid.status === 400)) expect.unreachable('Expected invalid.status === 400');
  assertStringIncludes(await invalid.text(), i18n.t('help.onboarding.unknownAction'));
  const blank = await onboardingHandler.handle(pageRequest(
    new Request('http://local/onboarding', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: new URLSearchParams({ action: 'blank' }),
    }),
    {
      state: { interfaceLocale: locale },
      render: renderResponse,
    },
  ));
  if (!(blank.status === 307 && blank.headers.get('location') === '/assessments/new')) {
    expect.unreachable(
      "Expected blank.status === 307 && blank.headers.get('location') === '/assessments/new'",
    );
  }
  const missing = authorNotFoundResponse(i18n);
  if (!(missing.status === 404)) expect.unreachable('Expected missing.status === 404');
  assertStringIncludes(await missing.text(), i18n.t('help.page.notFound.description'));
}
it('onboarding and author boundaries in en-US', () => checkLocaleCase3('en-US'));
it('onboarding and author boundaries in en-GB', () => checkLocaleCase3('en-GB'));
it('onboarding and author boundaries in es-ES', () => checkLocaleCase3('es-ES'));
it('onboarding and author boundaries in es-419', () => checkLocaleCase3('es-419'));
it('onboarding and author boundaries in sv-SE', () => checkLocaleCase3('sv-SE'));

function assertStringIncludes(actual: string, expected: string) {
  if (!(actual.includes(expected))) expect.unreachable('Expected actual.includes(expected)');
}

function pageRequest(req: Request, options: {
  readonly state: {
    readonly interfaceLocale: InterfaceLocale;
  };
  readonly render?: HttpRequest['render'];
}): HttpRequest {
  const locale = options.state.interfaceLocale, catalog = catalogForLocale(locale);
  const base = apiRequest(req);
  return {
    ...base,
    state: { ...base.state, interfaceLocale: locale, catalog, i18n: createI18n(locale, catalog) },

    render: options.render ??
      ((node, status) => new Response(render(node ?? h('span', null)), { status })),
  };
}
