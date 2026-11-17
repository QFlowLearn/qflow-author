import { expect, test as testCase } from 'vitest';

import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { QUESTION_TYPE_IDS, TYPE_DRIVERS } from '../lib/types/registry.ts';
import { parseItemLanguage } from '../lib/types/item_language.ts';

const IMPORTED_LANGUAGE = parseItemLanguage('fr-CA');

testCase('persisted migration drafts are parsed without authoring defaults', () => {
  const parsed = parsePersistedDraft({
    type: 'single_select',
    itemLanguage: IMPORTED_LANGUAGE,
    title: 'Incomplete imported question',
    choices: [],
    correctId: '',
  }, 'single_select');

  expect(parsed).toStrictEqual({
    type: 'single_select',
    itemLanguage: IMPORTED_LANGUAGE,
    title: 'Incomplete imported question',
    choices: [],
    correctId: '',
  });
  expect('bodyHtml' in parsed).toStrictEqual(false);
});

testCase('persisted drafts preserve stored author HTML without rewriting it', () => {
  const parsed = parsePersistedDraft({
    type: 'single_select',
    itemLanguage: IMPORTED_LANGUAGE,
    title: 'Unsafe content',
    bodyHtml: '<p onclick="alert(1)">Question</p>',
    promptHtml: '<a href="javascript:alert(2)">Choose one</a>',
    choices: [{ id: 'A', html: '<img src="/answer.png" onerror="alert(3)">' }],
    correctId: 'A',
    catalogs: [{
      id: 'glossary',
      cards: [{
        support: { kind: 'predefined', value: 'glossary-on-screen' },
        contentHtml: '<p onmouseover="alert(4)">Definition</p>',
      }],
    }],
  }, 'single_select');

  expect(parsed.bodyHtml).toStrictEqual('<p onclick="alert(1)">Question</p>');
  expect(parsed.promptHtml).toStrictEqual('<a href="javascript:alert(2)">Choose one</a>');
  expect(parsed.choices?.[0]?.html).toStrictEqual('<img src="/answer.png" onerror="alert(3)">');
  expect(parsed.catalogs?.[0]?.cards[0].contentHtml).toStrictEqual(
    '<p onmouseover="alert(4)">Definition</p>',
  );
});

testCase('persisted draft HTML remains stable across repeated boundary parsing', () => {
  const input = {
    type: 'single_select' as const,
    itemLanguage: IMPORTED_LANGUAGE,
    title: 'Encoded content',
    bodyHtml: '<p>A &amp; B</p>',
    choices: [{ id: 'A', html: '<a href="/search?a=1&amp;b=2">Answer</a>' }],
    correctId: 'A',
  };

  const once = parsePersistedDraft(input, 'single_select');
  const twice = parsePersistedDraft(once, 'single_select');

  expect(once.bodyHtml).toStrictEqual('<p>A &amp; B</p>');
  expect(twice).toStrictEqual(once);
});

testCase('persisted migration drafts reject missing type-specific structure', () => {
  expect(() =>
    parsePersistedDraft(
      { type: 'single_select', itemLanguage: IMPORTED_LANGUAGE },
      'single_select',
    )
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('missing required field "title"')
    ),
  );
  expect(() =>
    parsePersistedDraft({
      type: 'single_select',
      itemLanguage: IMPORTED_LANGUAGE,
      title: 'Broken choices',
      choices: 'not-an-array',
      correctId: 'A',
    }, 'single_select')
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('must be object array')
    ),
  );
  expect(() =>
    parsePersistedDraft({
      type: 'single_select',
      itemLanguage: IMPORTED_LANGUAGE,
      title: 'Broken catalog',
      choices: [],
      correctId: '',
      catalogs: [null],
    }, 'single_select')
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('must contain only objects')
    ),
  );
});

testCase('persisted migration drafts reject mismatched types and unknown fields', () => {
  expect(() =>
    parsePersistedDraft({
      type: 'multi_select',
      itemLanguage: IMPORTED_LANGUAGE,
      title: 'Wrong type',
      choices: [],
      correctIds: [],
    }, 'single_select')
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('does not match')
    ),
  );
  expect(() =>
    parsePersistedDraft({
      type: 'extended_text',
      itemLanguage: IMPORTED_LANGUAGE,
      title: 'Unknown field',
      removedPrompt: 'Do not preserve obsolete persistence paths.',
    }, 'extended_text')
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('unknown fields: removedPrompt')
    ),
  );
});

testCase('persisted migration draft parser accepts every current driver shape', () => {
  for (const typeId of QUESTION_TYPE_IDS) {
    const defaults = TYPE_DRIVERS[typeId].defaults();
    const persisted: unknown = JSON.parse(
      JSON.stringify({ ...defaults, type: typeId, itemLanguage: IMPORTED_LANGUAGE }),
    );
    parsePersistedDraft(persisted, typeId);
  }
});

testCase('persisted migration drafts accept canonical interaction fields', () => {
  const hotspot = parsePersistedDraft({
    type: 'hotspot',
    itemLanguage: IMPORTED_LANGUAGE,
    title: 'Locate the answer',
    choices: [{ id: 'A', shape: 'circle', coords: '50,50,10' }],
  }, 'hotspot');
  const graphicGapMatch = parsePersistedDraft({
    type: 'graphic_gap_match',
    itemLanguage: IMPORTED_LANGUAGE,
    title: 'Place the answer',
    choices: [{ id: 'A', kind: 'text', text: 'Answer' }],
    targets: [{ id: 'T1', shape: 'circle', coords: '50,50,10' }],
    correctPairs: [{ choiceId: 'A', targetId: 'T1' }],
  }, 'graphic_gap_match');

  expect(hotspot.choices?.[0]?.id).toStrictEqual('A');
  expect(graphicGapMatch.choices?.[0]?.id).toStrictEqual('A');
});

testCase('persisted migration drafts require canonical interaction fields', () => {
  expect(() => parsePersistedDraft({ type: 'hotspot', title: 'Missing choices' }, 'hotspot'))
    .toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('missing required field "choices"')
      ),
    );
  expect(() =>
    parsePersistedDraft({
      type: 'graphic_gap_match',
      title: 'Missing targets',
      choices: [{ id: 'A', kind: 'text', text: 'Answer' }],
      correctPairs: [{ choiceId: 'A', targetId: 'T1' }],
    }, 'graphic_gap_match')
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('missing required field "targets"')
    ),
  );
});

testCase('persisted migration drafts reject removed interaction fields', () => {
  expect(() =>
    parsePersistedDraft({
      type: 'hotspot',
      title: 'Locate the answer',
      hotspotChoices: [{ id: 'A', shape: 'circle', coords: '50,50,10' }],
    }, 'hotspot')
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('unknown fields: hotspotChoices')
    ),
  );
});

testCase('persisted migration drafts reject review metadata owned by the migration item', () => {
  expect(() =>
    parsePersistedDraft({
      type: 'single_select',
      title: 'Invalid review suggestion',
      choices: [],
      correctId: '',
      reviewSuggestions: [{ source: 'ai', category: 'ambiguity', message: 'Review this.' }],
    }, 'single_select')
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('unknown fields: reviewSuggestions')
    ),
  );
});
