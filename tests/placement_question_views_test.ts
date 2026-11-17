import { expect, test as testCase } from 'vitest';

import {
  normalizePlacementRevisionSelectors,
  projectPlacementQuestionViews,
} from '../lib/placement_question_views.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

const revisions = [
  {
    itemId: 'question-1',
    latestRevisionId: 'revision-2',
    revisionId: 'revision-1',
    revision: 1,
    body: questionBody('Original title', '<p>Original</p>'),
    reviewSuggestions: [{
      source: 'ai',
      code: 'ai.ambiguity',
      category: 'ambiguity',
      message: 'Review the original wording.',
    }],
  },
  {
    itemId: 'question-1',
    latestRevisionId: 'revision-2',
    revisionId: 'revision-2',
    revision: 2,
    body: questionBody('Revised title', '<p>Revised</p>'),
    reviewSuggestions: [],
  },
] as const;

testCase('placement views keep pinned and latest revisions independent', () => {
  const views = projectPlacementQuestionViews([
    { placementId: 'pinned', itemId: 'question-1', revision: 1 },
    { placementId: 'latest', itemId: 'question-1', revision: null },
  ], revisions);

  expect(views.pinned.revision).toStrictEqual(1);
  expect(views.pinned.title).toStrictEqual('Original title');
  expect(views.pinned.preview.bodyHtml).toStrictEqual('<p>Original</p>');
  expect(views.pinned.reviewSuggestions.map((suggestion) => suggestion.code)).toStrictEqual([
    'ai.ambiguity',
  ]);
  expect(views.latest.revision).toStrictEqual(2);
  expect(views.latest.title).toStrictEqual('Revised title');
  expect(views.latest.preview.bodyHtml).toStrictEqual('<p>Revised</p>');
  expect(views.latest.reviewSuggestions).toStrictEqual([]);
});

testCase('placement views keep repeated placements with one pinned selector independent', () => {
  const views = projectPlacementQuestionViews([
    { placementId: 'first', itemId: 'question-1', revision: 1 },
    { placementId: 'second', itemId: 'question-1', revision: 1 },
  ], revisions);

  expect(Object.keys(views)).toStrictEqual(['first', 'second']);
  expect(views.first.placementId).toStrictEqual('first');
  expect(views.second.placementId).toStrictEqual('second');
  expect(views.first.revision).toStrictEqual(1);
  expect(views.second.revision).toStrictEqual(1);
});

testCase('placement revision selectors deduplicate latest questions and pinned pairs', () => {
  const selection = normalizePlacementRevisionSelectors([
    { placementId: 'latest-1', itemId: 'question-1', revision: null },
    { placementId: 'latest-2', itemId: 'question-1', revision: null },
    { placementId: 'pinned-1', itemId: 'question-2', revision: 3 },
    { placementId: 'pinned-2', itemId: 'question-2', revision: 3 },
    { placementId: 'pinned-3', itemId: 'question-2', revision: 4 },
  ]);

  expect(selection.latestItemIds).toStrictEqual(['question-1']);
  expect(selection.pinnedRevisions).toStrictEqual([
    { itemId: 'question-2', revision: 3 },
    { itemId: 'question-2', revision: 4 },
  ]);
});

testCase('placement revision selectors keep pinned and latest needs for one question', () => {
  const selection = normalizePlacementRevisionSelectors([
    { placementId: 'pinned', itemId: 'question-1', revision: 1 },
    { placementId: 'latest', itemId: 'question-1', revision: null },
  ]);

  expect(selection.latestItemIds).toStrictEqual(['question-1']);
  expect(selection.pinnedRevisions).toStrictEqual([{ itemId: 'question-1', revision: 1 }]);
});

testCase('placement views fail when their exact pinned revision is missing', () => {
  expect(() =>
    projectPlacementQuestionViews([
      { placementId: 'missing', itemId: 'question-1', revision: 99 },
    ], revisions)
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes('Question revision not found for placement missing')
    ),
  );
});

testCase('placement views reject persisted questions with missing answer structure', () => {
  expect(() =>
    projectPlacementQuestionViews(
      [{ placementId: 'invalid', itemId: 'question-1', revision: 1 }],
      [{
        ...revisions[0],
        body: {
          type: 'single_select',
          title: 'Missing answer',
          bodyHtml: '<p>Pick one.</p>',
          choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
        },
      }],
    )
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes('Question revision is invalid for placement invalid.')
    ),
  );
});

testCase('placement views normalize supported interaction-specific persistence fields', () => {
  const views = projectPlacementQuestionViews([
    { placementId: 'hotspot-placement', itemId: 'hotspot-question', revision: 1 },
    { placementId: 'graphic-placement', itemId: 'graphic-question', revision: 1 },
  ], [
    {
      itemId: 'hotspot-question',
      latestRevisionId: 'hotspot-revision',
      revisionId: 'hotspot-revision',
      revision: 1,
      body: {
        type: 'hotspot',
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Locate the answer',
        hotspotImageSrc: 'timeline.png',
        hotspotImageAlt: 'A timeline',
        choices: [{ id: 'A', shape: 'circle', coords: '50,50,10' }],
        correctIds: ['A'],
      },
      reviewSuggestions: [],
    },
    {
      itemId: 'graphic-question',
      latestRevisionId: 'graphic-revision',
      revisionId: 'graphic-revision',
      revision: 1,
      body: {
        type: 'graphic_gap_match',
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Place the answer',
        graphicBackgroundSrc: 'timeline.png',
        graphicBackgroundAlt: 'A timeline',
        choices: [{ id: 'A', kind: 'text', text: 'Answer' }],
        targets: [{ id: 'T1', shape: 'circle', coords: '50,50,10' }],
        correctPairs: [{ choiceId: 'A', targetId: 'T1' }],
      },
      reviewSuggestions: [],
    },
  ]);

  expect(views['hotspot-placement'].draft.choices?.[0]?.id).toStrictEqual('A');
  expect(views['graphic-placement'].preview.choices?.[0]?.id).toStrictEqual('A');
  expect(views['graphic-placement'].draft.targets?.[0]?.id).toStrictEqual('T1');
});

function questionBody(title: string, bodyHtml: string) {
  return {
    title,
    type: 'single_select' as const,
    itemLanguage: newAuthoringItemLanguage(),
    bodyHtml,
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctId: 'A',
  };
}
