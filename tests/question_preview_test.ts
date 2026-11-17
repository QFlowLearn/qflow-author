import { expect, test as testCase } from 'vitest';

import { projectQuestionPreviewFromDraft } from '../lib/question_preview.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

function authoredPreviewDraft(seed: Omit<Draft, 'itemLanguage'>): Draft {
  return { ...seed, itemLanguage: newAuthoringItemLanguage() };
}

testCase('question preview projects compact content from a typed draft', () => {
  const draft = authoredPreviewDraft({
    type: 'single_select',
    title: 'Capital',
    bodyHtml: '<p>What is the capital?</p>',
    promptHtml: '<p>Choose one.</p>',
    choices: [
      { id: 'A', text: 'Paris' },
      { id: 'B', html: '<p>Lyon</p>' },
    ],
  });

  const preview = projectQuestionPreviewFromDraft(draft);
  expect(String(preview.bodyHtml)).toStrictEqual('<p>What is the capital?</p>');
  expect(String(preview.promptHtml)).toStrictEqual('<p>Choose one.</p>');
  expect(preview.choices).toStrictEqual([
    { id: 'A', text: 'Paris' },
    { id: 'B', text: 'Lyon' },
  ]);
});

testCase('question preview sanitizes persisted HTML before rendering', () => {
  const preview = projectQuestionPreviewFromDraft(authoredPreviewDraft({
    type: 'single_select',
    title: 'Unsafe content',
    bodyHtml: '<p onclick="alert(1)">Question</p><script>alert(2)</script>',
    promptHtml: '<a href="javascript:alert(3)">Choose one</a>',
    choices: [{ id: 'A', html: '<img src=x onerror="alert(4)">Answer' }],
  }));

  expect(String(preview.bodyHtml)).toStrictEqual(
    '<p>Question</p>&lt;script&gt;alert(2)&lt;/script&gt;',
  );
  expect(String(preview.promptHtml)).toStrictEqual('<a>Choose one</a>');
  expect(preview.choices).toStrictEqual([{ id: 'A', text: 'Answer' }]);
});
