import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { type AssociateDraft } from '../lib/types/associate.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'associate.xml';

testCase('associate import: fixture → draft contains choices + pairs', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  expect(parsed.draft.type).toStrictEqual('associate');
  const choices = parsed.draft.choices ?? [];
  const pairs = parsed.draft.correctPairs ?? [];

  if (!(choices.length >= 2)) expect.unreachable('Expected choices.length >= 2');
  if (!(pairs.length >= 1)) expect.unreachable('Expected pairs.length >= 1');
  if (!(choices.every((choice) => typeof choice.id === 'string' && choice.id.length > 0))) {
    expect.unreachable(
      "Expected choices.every((choice) => typeof choice.id === 'string' && choice.id.length > 0)",
    );
  }
  if (!(pairs.every((pair) => Boolean(pair.sourceId) && Boolean(pair.targetId)))) {
    expect.unreachable(
      'Expected pairs.every((pair) => Boolean(pair.sourceId) && Boolean(pair.targetId))',
    );
  }
});

testCase('associate import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<AssociateDraft>(parsed, 'associate');
  const rebuilt = exportQti3TestItemXml('associate', draft, {
    identifier: 'item-associate-roundtrip',
  });
  await assertQtiXmlWellFormed(rebuilt);

  draftOfType<AssociateDraft>(parseItemXml(rebuilt), 'associate');
});
