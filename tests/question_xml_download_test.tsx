import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { parseQtiXml } from '@longsightgroup/qti3-core';
import { prepareQuestionXmlDownload } from '../lib/export/question_xml_download.ts';
import { buildItemXmlFromPreparedDraft, prepareDriverDraft } from '../lib/qti_build.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import QuestionExportFeedback from '../islands/assessment_builder/QuestionExportFeedback.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { createI18n } from '../lib/i18n/messages.ts';

function question(): Draft {
  return {
    type: 'single_select',
    title: 'Pick one',
    itemLanguage: newAuthoringItemLanguage(),
    bodyHtml: '<p>Which number is four?</p>',
    choices: [{ id: 'A', text: 'Four' }, { id: 'B', text: 'Five' }],
    correctId: 'A',
    stylesheets: [{ href: '', type: 'text/css' }, {
      href: '/uploads/valid-style',
      type: 'text/css',
    }],
  };
}

testCase(
  'individual XML export omits empty optional styles, retains valid styles and scoring, and leaves the draft intact',
  () => {
    const draft = question();
    const before = structuredClone(draft);
    const result = prepareQuestionXmlDownload(draft, 'download-question');
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    expect(result.omittedStylesheetCount).toStrictEqual(1);
    expect(result.xml).toContain('href="/uploads/valid-style"');
    if (result.xml.includes('href=""')) {
      expect.unreachable('Expected !result.xml.includes(\'href=""\')');
    }
    const parsed = parseQtiXml(result.xml);
    if (!(parsed.ok && parsed.document)) {
      expect.unreachable('Expected parsed.ok && parsed.document');
    }
    expect(parsed.document.item.responseDeclarations[0].correctResponse).toStrictEqual('A');
    expect(draft).toStrictEqual(before);
    const prepared = prepareDriverDraft(draft);
    if (prepared.ok) {
      expect(
        buildItemXmlFromPreparedDraft(prepared.prepared, { identifier: 'canonical-question' }).ok,
      ).toStrictEqual(false);
    }
  },
);

testCase(
  'individual XML export returns specific errors when essential metadata needs repair',
  () => {
    const result = prepareQuestionXmlDownload(
      { ...question(), catalogs: [{ id: '', cards: [] }] },
      'repair-question',
    );
    if (result.ok) expect.unreachable('Expected !result.ok');
    if (!(result.issues.length > 0)) expect.unreachable('Expected result.issues.length > 0');
    if (!(result.issues.some((issue) => /catalog/i.test(issue.message)))) {
      expect.unreachable('Expected result.issues.some((issue) => /catalog/i.test(issue.message))');
    }
  },
);

testCase(
  'individual export feedback explains omissions and concrete repairs in every locale',
  () => {
    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
      const payload = createI18nPayload(locale, catalogForLocale(locale), ['assessments']);
      const i18n = createI18n(locale, payload.namespaces);
      const omitted = render(
        <QuestionExportFeedback
          notice={{ _tag: 'OmittedStylesheets', placementId: 'p', count: 1 }}
          i18n={i18n}
          onOpenSettings={() => {}}
        />,
      );
      expect(omitted).toContain(
        i18n.t('assessments.builder.exportStylesheetsOmitted', { count: 1 }),
      );
      const repair = render(
        <QuestionExportFeedback
          notice={{
            _tag: 'NeedsRepair',
            placementId: 'p',
            issues: [{ field: 'general', message: 'Catalog entry needs a language.' }],
          }}
          i18n={i18n}
          onOpenSettings={() => {}}
        />,
      );
      expect(repair).toContain('Catalog entry needs a language.');
      expect(repair).toContain(i18n.t('assessments.builder.exportReviewSettings'));
      if (repair.includes('Please try again')) {
        expect.unreachable("Expected !repair.includes('Please try again')");
      }
    }
  },
);
