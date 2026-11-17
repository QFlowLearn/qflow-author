import { expect, test as testCase } from 'vitest';

import { collectA11yIssues } from '../lib/a11y_checks.ts';
import {
  collectQuestionReviewSuggestions,
  collectQuestionReviewSuggestionsFromAnalysis,
} from '../lib/question_review.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';

function authoredReviewDraft(seed: Omit<Draft, 'itemLanguage'>): Draft {
  return { ...seed, itemLanguage: newAuthoringItemLanguage() };
}

testCase(
  'question review reports ambiguity, clueing, duplicates, and conflicting keys without edits',
  () => {
    const draft = authoredReviewDraft({
      type: 'single_select',
      title: 'Review sample',
      bodyHtml: '<p>Which answer is correct? Why?</p>',
      choices: [
        { id: 'A', text: 'A much longer correct answer that repeats useful language' },
        { id: 'B', text: 'Short' },
        { id: 'C', text: ' Short ' },
      ],
      correctId: 'A',
      correctIds: ['A'],
    });
    expect(draft.itemLanguage).toStrictEqual('en-US');
    const before = JSON.stringify(draft);

    const suggestions = collectQuestionReviewSuggestions(draft);

    expect(JSON.stringify(draft)).toStrictEqual(before);
    expect(suggestions.some((entry) => entry.code === 'ambiguous_stem.multiple_questions'))
      .toStrictEqual(true);
    expect(suggestions.some((entry) => entry.code === 'duplicate_options.normalized_text'))
      .toStrictEqual(true);
    expect(suggestions.some((entry) => entry.code === 'clueing.correct_option_length'))
      .toStrictEqual(true);
    expect(suggestions.some((entry) => entry.code === 'answer_key.conflicting_choice_keys'))
      .toStrictEqual(true);
  },
);

testCase(
  'question review keeps AI suggestions visible and checks explicit blueprint alignment',
  () => {
    const blueprint = testAssessmentBlueprint([
      { id: 'entry-target', questionType: 'text_entry', count: 1 },
    ]);
    const draft = authoredReviewDraft({
      type: 'single_select',
      title: 'Alignment sample',
      bodyHtml: '<p>Which answer best explains the evidence?</p>',
      choices: [{ id: 'A', text: 'First' }, { id: 'B', text: 'Second' }],
      correctId: 'A',
    });
    const suggestions = collectQuestionReviewSuggestions(draft, {
      blueprint,
      blueprintTargetId: 'entry-target',
      aiSuggestions: [{
        source: 'ai',
        code: 'ai.ambiguity',
        category: 'ambiguity',
        message: 'Check whether “best” has one defensible interpretation.',
      }],
    });

    expect(suggestions.some((entry) => entry.code === 'alignment.question_type_mismatch'))
      .toStrictEqual(true);
    expect(suggestions.some((entry) => entry.source === 'ai')).toStrictEqual(true);
  },
);

testCase(
  'question review reuses supplied accessibility analysis without changing suggestions',
  () => {
    const draft = authoredReviewDraft({
      type: 'extended_text',
      title: 'Accessibility review',
      bodyHtml: '<p>Describe what the diagram shows.<img src="diagram.png"></p>',
    });
    const context = {
      aiSuggestions: [{
        source: 'ai' as const,
        code: 'ai.precision',
        category: 'ambiguity' as const,
        message: 'Check whether the requested level of detail is clear.',
      }],
    };
    const a11yIssues = collectA11yIssues(draft);

    const wrapped = collectQuestionReviewSuggestions(draft, context);
    const analyzed = collectQuestionReviewSuggestionsFromAnalysis(draft, a11yIssues, context);

    expect(analyzed).toStrictEqual(wrapped);
    expect(analyzed.filter((entry) => entry.code === 'accessibility.missing_alt_text').length)
      .toStrictEqual(1);
  },
);

testCase('question review maps one supplied accessibility issue exactly once', () => {
  const suggestions = collectQuestionReviewSuggestionsFromAnalysis(
    authoredReviewDraft({
      type: 'extended_text',
      title: 'Supplied analysis',
      bodyHtml: '<p>Explain your answer.</p>',
    }),
    [{
      severity: 'warning',
      code: 'SUPPLIED_CHECK',
      message: 'Review the supplied accessibility concern.',
    }],
  );

  expect(suggestions.filter((entry) => entry.code === 'accessibility.supplied_check').length)
    .toStrictEqual(1);
});

testCase('duplicate checks preserve mathematical symbols, case, and meaningful markup', () => {
  for (
    const [first, second] of [
      ['−2', '2'],
      ['-2', '+2'],
      ['1.5', '15'],
      ['m', 'M'],
      ['<p>x<sup>2</sup></p>', '<p>x2</p>'],
      ['<img src="a.png" alt="Graph">', '<img src="b.png" alt="Graph">'],
    ]
  ) {
    const suggestions = collectQuestionReviewSuggestions(authoredReviewDraft({
      type: 'single_select',
      bodyHtml: '<p>Select the correct answer.</p>',
      choices: [{ id: 'A', html: first }, { id: 'B', html: second }],
      correctId: 'A',
    }));
    expect(
      suggestions.some((entry) => entry.code === 'duplicate_options.normalized_text'),
      `${first} differs from ${second}`,
    ).toStrictEqual(false);
  }
});
