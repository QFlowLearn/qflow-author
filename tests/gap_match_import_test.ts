import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { GAP_MARKER_ATTR, type GapMatchDraft } from '../lib/types/gap_match.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'gap-match-qti3.xml';

testCase('gap_match import: fixture → draft contains markers + choices + gaps', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  expect(parsed.draft.type).toStrictEqual('gap_match');
  if (!((parsed.draft.bodyHtml ?? '').includes(GAP_MARKER_ATTR))) {
    expect.unreachable("Expected (parsed.draft.bodyHtml ?? '').includes(GAP_MARKER_ATTR)");
  }

  const gaps = parsed.draft.gaps ?? [];
  const choices = parsed.draft.gapChoices ?? [];
  const pairs = parsed.draft.correctGapPairs ?? [];

  if (!(gaps.length >= 1)) expect.unreachable('Expected gaps.length >= 1');
  if (!(choices.length >= 1)) expect.unreachable('Expected choices.length >= 1');
  if (!(pairs.length >= 1)) expect.unreachable('Expected pairs.length >= 1');
  if (!(gaps.every((gap) => typeof gap.id === 'string' && gap.id.length > 0))) {
    expect.unreachable(
      "Expected gaps.every((gap) => typeof gap.id === 'string' && gap.id.length > 0)",
    );
  }
  if (!(choices.every((choice) => typeof choice.id === 'string' && choice.id.length > 0))) {
    expect.unreachable(
      "Expected choices.every((choice) => typeof choice.id === 'string' && choice.id.length > 0)",
    );
  }
  if (!(pairs.every((pair) => Boolean(pair.choiceId) && Boolean(pair.gapId)))) {
    expect.unreachable(
      'Expected pairs.every((pair) => Boolean(pair.choiceId) && Boolean(pair.gapId))',
    );
  }
});

testCase('gap_match import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<GapMatchDraft>(parsed, 'gap_match');
  const rebuilt = exportQti3TestItemXml('gap_match', draft, {
    identifier: 'item-gap-match-roundtrip',
  });
  await assertQtiXmlWellFormed(rebuilt);

  draftOfType<GapMatchDraft>(parseItemXml(rebuilt), 'gap_match');
});
