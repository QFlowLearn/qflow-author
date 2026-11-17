import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { collectAssessmentContentFindings } from '../lib/assessment_content.ts';
import { collectQuestionReviewSuggestions } from '../lib/question_review.ts';
import type { QuestionReviewSuggestion } from '../lib/question_review_types.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { I18nProvider } from '../lib/i18n/context.tsx';
import AssessmentContentFindings from '../components/assessment_builder/AssessmentContentFindings.tsx';

const parts = [{ placements: [{ id: 'p1' }] }];
function meta(reviewSuggestions: readonly QuestionReviewSuggestion[], latestRev = 1) {
  return { title: 'Authored <title>', latestRev, reviewSuggestions };
}

testCase('targeted findings omit weak advice, AI guesses, and unknown codes', () => {
  const reviewSuggestions = collectQuestionReviewSuggestions({
    type: 'single_select',
    itemLanguage: newAuthoringItemLanguage(),
    bodyHtml: '<p>Why? How?</p>',
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctId: 'A',
  });
  expect(reviewSuggestions.length > 0).toStrictEqual(true);
  expect(collectAssessmentContentFindings(parts, {
    p1: meta([
      ...reviewSuggestions,
      {
        source: 'ai',
        category: 'answer_key',
        code: 'answer_key.single_select_reference',
        message: 'Guess',
      },
      {
        source: 'deterministic',
        category: 'accessibility',
        code: 'toString',
        message: 'Unknown',
      },
    ]),
  })).toStrictEqual([]);
});

testCase('real checks produce ranked, deduplicated findings without changing the content', () => {
  const draft = {
    type: 'single_select' as const,
    itemLanguage: newAuthoringItemLanguage(),
    bodyHtml: '<p>Which option describes this image?</p><img src="/image.png">',
    choices: [{ id: 'A', text: 'Same' }, { id: 'B', text: ' Same ' }],
    correctId: 'removed',
  };
  const before = JSON.stringify(draft);
  const suggestions = collectQuestionReviewSuggestions(draft);
  const findings = collectAssessmentContentFindings(parts, {
    p1: meta([...suggestions, ...suggestions]),
  });
  expect(findings.map((f) => f.kind)).toStrictEqual([
    'choice_key',
    'duplicate_options',
    'image_description',
  ]);
  expect(JSON.stringify(draft)).toStrictEqual(before);
  expect(findings[0].number).toStrictEqual('1.1');
});

testCase(
  'all current placements are checked, including the hundredth, and deleted ones disappear',
  () => {
    const suggestions = collectQuestionReviewSuggestions({
      type: 'text_entry',
      itemLanguage: newAuthoringItemLanguage(),
      textEntries: [{ id: 'gap', label: 'Answer', answers: [] }],
    });
    const placements = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}` }));
    const metadata = Object.fromEntries(
      placements.map((p, i) => [p.id, meta(i === 99 ? suggestions : [])]),
    );
    expect(collectAssessmentContentFindings([{ placements }], metadata).map((f) => f.number))
      .toStrictEqual([
        '1.100',
      ]);
    expect(collectAssessmentContentFindings([{ placements: placements.slice(0, 99) }], metadata))
      .toStrictEqual([]);
    expect(() => collectAssessmentContentFindings(parts, {})).toThrowError(Error);
  },
);

testCase('saved revision changes refresh only the affected finding identity', () => {
  const suggestion: QuestionReviewSuggestion = {
    source: 'deterministic',
    category: 'answer_key',
    code: 'answer_key.text_entry_empty',
    message: 'Empty',
  };
  const selection = [{ placements: [{ id: 'p1' }, { id: 'p2' }] }];
  const before = collectAssessmentContentFindings(selection, {
    p1: meta([suggestion]),
    p2: meta([suggestion]),
  });
  const after = collectAssessmentContentFindings(selection, {
    p1: meta([suggestion], 2),
    p2: meta([suggestion]),
  });
  expect(before[0].key === after[0].key).toStrictEqual(false);
  expect(before[1].key).toStrictEqual(after[1].key);
  expect(collectAssessmentContentFindings(parts, { p1: meta([], 2) })).toStrictEqual([]);
});

testCase('findings are quiet when clean and closed, concise and localized when present', () => {
  const findings = Array.from(
    { length: 7 },
    (_, i) => ({
      key: `k${i}`,
      placementId: `p${i}`,
      number: `1.${i + 1}`,
      title: 'Authored <title>',
      kind: 'duplicate_options' as const,
    }),
  );
  for (const locale of INTERFACE_LOCALES) {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['assessments']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = render(
      <I18nProvider payload={payload}>
        <AssessmentContentFindings findings={findings} />
      </I18nProvider>,
    );
    expect(html).toContain(i18n.t('assessments.findings.count', { count: 7 }));
    expect(html).toContain(i18n.t('assessments.findings.showAll', { count: 7 }));
    expect(html).toContain('Authored &lt;title>');
    expect((html.match(/<li /g) ?? []).length).toStrictEqual(5);
    expect(html.includes(' open')).toStrictEqual(false);
    expect(html.includes('assessments.findings.')).toStrictEqual(false);
    expect(render(
      <I18nProvider payload={payload}>
        <AssessmentContentFindings findings={[]} />
      </I18nProvider>,
    )).toStrictEqual('');
  }
});
