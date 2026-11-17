import { expect, test as testCase } from 'vitest';

import {
  compatibleVariantTypes,
  copyQuestionSourceXml,
  createQuestionVariantDraft,
  isExactQuestionVariantTransformation,
  parseQuestionVariantDraft,
} from '../lib/question_variants.ts';
import type { Draft } from '../lib/types/draft.ts';
import { normalizeDraftForDriver } from '../lib/types/draft_utils.ts';
import { parseItemLanguage } from '../lib/types/item_language.ts';
import { projectCanonicalQtiSemantics } from '../lib/question_qti_semantics.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';

const SOURCE: Draft = {
  itemId: 'source-question',
  type: 'single_select',
  itemLanguage: parseItemLanguage('fr-CA'),
  title: 'Source question',
  bodyHtml: '<p>Pick one.</p>',
  choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
  correctId: 'A',
  preserveSourceXml: true,
};

testCase('single-select creates a construct-preserving multiple-select variant', () => {
  const variant = createQuestionVariantDraft(SOURCE, 'multi_select');

  expect(compatibleVariantTypes(SOURCE)).toStrictEqual(['single_select', 'multi_select']);
  expect(variant.type).toStrictEqual('multi_select');
  expect(variant.correctIds).toStrictEqual(['A']);
  expect(variant.correctId).toStrictEqual(undefined);
  expect(variant.maxChoices).toStrictEqual(1);
  expect(variant.itemId).toStrictEqual(undefined);
  expect(variant.itemLanguage).toStrictEqual(SOURCE.itemLanguage);
  expect(variant.preserveSourceXml).toStrictEqual(false);
  expect(SOURCE.preserveSourceXml).toStrictEqual(true);
  expect('correctId' in normalizeDraftForDriver('multi_select', variant)).toStrictEqual(false);
});

testCase(
  'multiple-select refuses a single-select transform when more than one answer is correct',
  () => {
    const source: Draft = {
      ...SOURCE,
      type: 'multi_select',
      correctId: undefined,
      correctIds: ['A', 'B'],
    };

    expect(compatibleVariantTypes(source)).toStrictEqual(['multi_select']);
    expect(() => createQuestionVariantDraft(source, 'single_select')).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('Cannot preserve the construct')
      ),
    );
  },
);

testCase('variant sources reject persisted drafts with missing answer structure', () => {
  const { correctId: _correctId, ...missingAnswer } = SOURCE;
  expect(() => parseQuestionVariantDraft(missingAnswer, 'source')).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Variant source question body is invalid.')
    ),
  );
});

testCase('variant provenance accepts only the exact server-owned transformation', () => {
  const source = parseQuestionVariantDraft(SOURCE, 'source');
  const expected = parseQuestionVariantDraft(
    JSON.parse(JSON.stringify(createQuestionVariantDraft(source, 'single_select'))),
    'target',
  );
  const unrelated = parseQuestionVariantDraft({
    ...expected,
    bodyHtml: '<p>Unrelated replacement content.</p>',
  }, 'target');

  expect(isExactQuestionVariantTransformation(source, expected, 'single_select')).toStrictEqual(
    true,
  );
  expect(isExactQuestionVariantTransformation(source, unrelated, 'single_select')).toStrictEqual(
    false,
  );
});

testCase(
  'same-type copies retain preservation mode and compare settled masking consistently',
  () => {
    const copy = createQuestionVariantDraft(SOURCE, 'single_select');
    expect(copy.preserveSourceXml).toStrictEqual(true);
    const source = parseQuestionVariantDraft(SOURCE, 'source');
    const target = parseQuestionVariantDraft(
      projectJsonPersistenceObject({ ...copy, answerMasking: false }),
      'target',
    );
    expect(isExactQuestionVariantTransformation(source, target, 'single_select')).toStrictEqual(
      true,
    );
    expect(isExactQuestionVariantTransformation(
      source,
      { ...target, answerMasking: true },
      'single_select',
    )).toStrictEqual(false);
  },
);

testCase(
  'copy XML changes only root identity and rejects repaired or non-item documents',
  async () => {
    const source = await readQtiFixture('choice-points/single.xml');
    const copied = copyQuestionSourceXml(source, 'independent-copy');
    expect(copied.ok).toStrictEqual(true);
    if (!copied.ok) throw new Error('Expected a copied source document.');
    expect(projectCanonicalQtiSemantics(copied.xml)).toStrictEqual(
      projectCanonicalQtiSemantics(source),
    );
    expect(copied.xml.includes('identifier="independent-copy"')).toStrictEqual(true);
    for (const invalid of ['', '<qti-assessment-item>', '<different/>', '<!DOCTYPE html><html/>']) {
      expect(copyQuestionSourceXml(invalid, 'independent-copy')).toStrictEqual({ ok: false });
    }
    expect(copyQuestionSourceXml(source, 'bad identity')).toStrictEqual({ ok: false });
  },
);
