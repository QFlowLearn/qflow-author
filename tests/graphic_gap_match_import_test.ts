import { expect, test as testCase } from 'vitest';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import type { DriverDraft } from '../lib/types/registry.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'graphic-gap-match-qti3.xml';
testCase('graphic gap match import: fixture maps background + choices', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<DriverDraft<'graphic_gap_match'>>(parsed, 'graphic_gap_match');
  expect(draft.graphicBackgroundSrc).toStrictEqual('images/timeline-558.png');
  const choices = draft.choices;
  const targets = draft.targets;
  const pairs = draft.correctPairs;
  expect(choices.length).toStrictEqual(4);
  expect(targets.length).toStrictEqual(4);
  expect(pairs.length).toStrictEqual(4);
  if (!(choices.every((choice) => typeof choice.id === 'string' && choice.id.length > 0))) {
    expect.unreachable(
      "Expected choices.every((choice) => typeof choice.id === 'string' && choice.id.length > 0)",
    );
  }
  if (!(targets.every((target) => typeof target.id === 'string' && target.id.length > 0))) {
    expect.unreachable(
      "Expected targets.every((target) => typeof target.id === 'string' && target.id.length > 0)",
    );
  }
  if (!(pairs.every((pair) => Boolean(pair.choiceId) && Boolean(pair.targetId)))) {
    expect.unreachable(
      'Expected pairs.every((pair) => Boolean(pair.choiceId) && Boolean(pair.targetId))',
    );
  }
  for (const choice of choices) {
    expect(choice.kind).toStrictEqual('image');
    if (!(choice.imgSrc && choice.imgSrc.startsWith('images/'))) {
      expect.unreachable("Expected choice.imgSrc && choice.imgSrc.startsWith('images/')");
    }
  }
});
