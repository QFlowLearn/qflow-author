import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import BringFilesIntake from '../islands/BringFilesIntake.tsx';
import {
  GENERATION_SOURCE_ACCEPT,
  RECOVERY_SOURCE_ACCEPT,
  RESPONDUS_SOURCE_ACCEPT,
} from '../lib/source_intake/source_catalog.ts';
import NewAssessmentPage from '../lib/http/routes/assessment_pages/new.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

function page(
  locale: InterfaceLocale,
  purpose: 'recover_existing' | 'generate_new',
  entrySource?: 'respondus',
) {
  const catalog = catalogForLocale(locale);
  return (
    <NewAssessmentPage
      destination={{ _tag: 'Assessment' }}
      initialPurpose={purpose}
      entrySource={entrySource}
      i18n={createI18n(locale, catalog)}
      payload={createI18nPayload(locale, catalog, ['imports', 'assessments'])}
    />
  );
}

testCase('assessment creation presents one bring-files workflow with two intents', () => {
  const html = renderToString(page('en-US', 'recover_existing'));

  expect(html).toContain('Bring your files');
  expect(html).toContain('Recover questions');
  expect(html).toContain('Generate from source');
  expect(html).toContain('Bring your files');
  expect(html).toContain(`accept="${RECOVERY_SOURCE_ACCEPT}"`);
  expect(html).toContain('Paste text');
  expect(html).toContain('Check source');
  expect(html).toContain('QTI 3.0 stays canonical');
  expect(html).toContain('Start a blank assessment');
  expect(countOccurrences(html, 'name="source-purpose"')).toStrictEqual(2);
  if (html.includes('migration queue')) {
    expect.unreachable("Expected !html.includes('migration queue')");
  }
  if (html.includes('AI panel')) expect.unreachable("Expected !html.includes('AI panel')");
});

testCase('generate intent limits the initial file picker to one source', () => {
  const catalog = catalogForLocale('en-US');
  const html = renderToString(
    <BringFilesIntake
      destination={{ _tag: 'Assessment' }}
      initialPurpose='generate_new'
      payload={createI18nPayload('en-US', catalog, ['imports', 'assessments'])}
    />,
  );

  expect(html).toContain('PDF, Word, Markdown, or plain text. One file up to 10 MB.');
  if (html.includes('multiple')) expect.unreachable("Expected !html.includes('multiple')");
});

testCase('Respondus entry stays focused on one deterministic source and review path', () => {
  const html = renderToString(
    page('en-US', 'recover_existing', 'respondus'),
  );

  expect(html).toContain('Convert Respondus questions');
  expect(html).toContain('Add a Respondus source');
  expect(html).toContain(`accept="${RESPONDUS_SOURCE_ACCEPT}"`);
  expect(html).toContain('Respondus recovery without AI');
  expect(html).toContain('QTI 3.0 stays canonical');
  expect(countOccurrences(html, 'name="source-purpose"')).toStrictEqual(0);
  if (html.includes('Generate from source')) {
    expect.unreachable("Expected !html.includes('Generate from source')");
  }
  if (html.includes('multiple')) expect.unreachable("Expected !html.includes('multiple')");
  if (html.includes('New blank assessment')) {
    expect.unreachable("Expected !html.includes('New blank assessment')");
  }
});

testCase(
  'source-intake SSR matrix localizes every entry mode and preserves protocol values',
  () => {
    const locales: InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
    const englishUi = [
      'Bring your files',
      'Recover existing questions',
      'Generate from source',
      'What do you want QFlowLearn to do?',
      'Add your source',
      'Files',
      'Paste text',
      'Check source',
      'Continue to review',
      'Continue to generation',
      'Start a blank assessment',
      'Respondus conversion',
      'Convert Respondus questions',
      'Add a Respondus source',
      'QTI 3.0 stays canonical',
    ];
    for (const locale of locales) {
      const catalog = catalogForLocale(locale);
      const i18n = createI18n(locale, catalog);
      const payload = createI18nPayload(locale, catalog, ['imports', 'assessments']);
      const normal = renderToString(
        <NewAssessmentPage
          destination={{ _tag: 'Assessment' }}
          initialPurpose='recover_existing'
          i18n={i18n}
          payload={payload}
        />,
      );
      const respondus = renderToString(
        <NewAssessmentPage
          destination={{ _tag: 'Assessment' }}
          initialPurpose='recover_existing'
          entrySource='respondus'
          i18n={i18n}
          payload={payload}
        />,
      );
      const generate = renderToString(page(locale, 'generate_new'));
      const expected = [
        i18n.t('imports.intake.normalEyebrow'),
        i18n.t('imports.intake.normalTitle'),
        i18n.t('imports.intake.normalDescription'),
        i18n.t('imports.intake.intentLegend'),
        i18n.t('imports.intake.recoverTitle'),
        i18n.t('imports.intake.recoverDescription'),
        i18n.t('imports.intake.generateTitle'),
        i18n.t('imports.intake.generateDescription'),
        i18n.t('imports.intake.sourceLegend'),
        i18n.t('imports.intake.filesMethod'),
        i18n.t('imports.intake.pasteMethod'),
        i18n.t('imports.intake.dropFiles'),
        i18n.t('imports.intake.recoverFileHelp', { files: 10, batchMiB: 16 }),
        i18n.t('imports.intake.checkSource'),
        i18n.t('imports.intake.cancel'),
        i18n.t('imports.intake.canonicalTitle'),
        i18n.t('imports.intake.canonicalDetail'),
        i18n.t('imports.intake.approveResult'),
        i18n.t('imports.intake.approvalDetail'),
        i18n.t('imports.intake.blankPrompt'),
        i18n.t('imports.intake.blankAction'),
      ];
      for (const message of expected) expect(normal).toContain(message);
      for (
        const message of [
          i18n.t('imports.intake.respondusEyebrow'),
          i18n.t('imports.intake.respondusTitle'),
          i18n.t('imports.intake.respondusDescription'),
          i18n.t('imports.intake.respondusSourceLegend'),
          i18n.t('imports.intake.dropRespondus'),
          i18n.t('imports.intake.respondusFileHelp', { files: 10, batchMiB: 16 }),
          i18n.t('imports.intake.respondusRecovery'),
          i18n.t('imports.intake.respondusCanonicalDetail'),
        ]
      ) expect(respondus).toContain(message);
      for (
        const message of [
          i18n.t('imports.intake.normalEyebrow'),
          i18n.t('imports.intake.generateTitle'),
          i18n.t('imports.intake.generateDescription'),
          i18n.t('imports.intake.intentLegend'),
          i18n.t('imports.intake.recoverTitle'),
          i18n.t('imports.intake.recoverDescription'),
          i18n.t('imports.intake.sourceLegend'),
          i18n.t('imports.intake.filesMethod'),
          i18n.t('imports.intake.pasteMethod'),
          i18n.t('imports.intake.dropFiles'),
          i18n.t('imports.intake.generateFileHelp', { fileMiB: 10 }),
          i18n.t('imports.intake.checkSource'),
          i18n.t('imports.intake.cancel'),
          i18n.t('imports.intake.canonicalTitle'),
          i18n.t('imports.intake.canonicalDetail'),
          i18n.t('imports.intake.approveResult'),
          i18n.t('imports.intake.approvalDetail'),
        ]
      ) expect(generate).toContain(message);

      expect(normal).toContain(`accept="${RECOVERY_SOURCE_ACCEPT}"`);
      expect(respondus).toContain(`accept="${RESPONDUS_SOURCE_ACCEPT}"`);
      expect(generate).toContain(`accept="${GENERATION_SOURCE_ACCEPT}"`);
      expect(normal).toContain('name="source-purpose" value="recover_existing" checked');
      expect(normal).toContain('name="source-purpose" value="generate_new"');
      expect(generate).toContain('name="source-purpose" value="recover_existing"');
      expect(generate).toContain('name="source-purpose" value="generate_new" checked');
      for (const html of [normal, respondus, generate]) {
        expect(html).toContain('name="source-method" value="files"');
        expect(html).toContain('name="source-method" value="paste"');
        expect(html).toContain('id="bring-source-files"');
        expect(html).toContain('for="bring-source-files"');
        expect(html).toContain('aria-describedby="bring-source-files-help"');
      }
      expect(normal).toContain(' multiple');
      if (generate.includes(' multiple')) {
        expect.unreachable("Expected !generate.includes(' multiple')");
      }
      if (respondus.includes('name="source-purpose"')) {
        expect.unreachable('Expected !respondus.includes(\'name="source-purpose"\')');
      }
      if (respondus.includes(' multiple')) {
        expect.unreachable("Expected !respondus.includes(' multiple')");
      }
      for (const html of [normal, respondus, generate]) {
        if (html.includes('imports.intake.')) {
          expect.unreachable("Expected !html.includes('imports.intake.')");
        }
        if (/[{][a-zA-Z]+[,}]/.test(html)) {
          expect.unreachable('Expected !/[{][a-zA-Z]+[,}]/.test(html)');
        }
        if (html.includes('HOSTILE-UPSTREAM-DETAIL')) {
          expect.unreachable("Expected !html.includes('HOSTILE-UPSTREAM-DETAIL')");
        }
      }
      if (locale.startsWith('es-')) {
        const combined = normal + respondus + generate;
        for (const phrase of englishUi) {
          if (combined.includes(phrase)) expect.unreachable(phrase);
        }
      }

      // Count branches are not reachable until browser-selected source state; verify the
      // production catalog/runtime contract here rather than inventing SSR props.
      const counts = [0, 1, 2, 1234].map((count) =>
        [count, i18n.t('imports.intake.characterCount', { count, limit: 12000 })] as const
      );
      expect(counts.length).toStrictEqual(4);
      for (const [count, rendered] of counts) {
        expect(rendered).toContain(i18n.formatNumber(count));
        expect(rendered).toContain(i18n.formatNumber(12000));
      }
      expect(i18n.t('imports.intake.recoverFileHelp', { files: 1, batchMiB: 16 })).toContain('16');
      expect(i18n.t('imports.intake.recoverFileHelp', { files: 2, batchMiB: 16 })).toContain('2');
    }
    expect(
      createI18n('en-US', catalogForLocale('en-US')).t('imports.intake.generateFileHelp', {
        fileMiB: 10,
      }),
    ).toContain('10 MB');
    expect(
      createI18n('es-ES', catalogForLocale('es-ES')).t('imports.intake.generateFileHelp', {
        fileMiB: 10,
      }),
    ).toContain('10 MB');
  },
);

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

testCase('bank intake keeps cancel in the bank and exposes no blank assessment action', () => {
  const collectionId = crypto.randomUUID();
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    for (
      const destination of [
        { _tag: 'WorkspaceBank', collectionId },
        { _tag: 'WorkspaceBank', collectionId: null },
      ] as const
    ) {
      const html = renderToString(
        <BringFilesIntake
          destination={destination}
          payload={createI18nPayload(locale, catalogForLocale(locale), ['imports', 'assessments'])}
        />,
      );
      expect(html).toContain(
        destination.collectionId === null
          ? 'href="/items"'
          : `href="/items?collection=${collectionId}"`,
      );
      if (html.includes('/assessments')) {
        expect.unreachable("Expected !html.includes('/assessments')");
      }
      if (html.includes('value="generate_new"')) {
        expect.unreachable('Expected !html.includes(\'value="generate_new"\')');
      }
    }
  }
});
