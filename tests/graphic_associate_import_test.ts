import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { type GraphicAssociateDraft } from '../lib/types/graphic_associate.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'graphic_associate.xml';

testCase('graphic associate import: fixture → draft contains hotspots + pairs', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<GraphicAssociateDraft>(parsed, 'graphic_associate');
  const hotspots = draft.graphicAssociateHotspots ?? [];
  const pairs = draft.graphicAssociateCorrectPairs ?? [];

  if (!(hotspots.length >= 2)) expect.unreachable('Expected hotspots.length >= 2');
  if (!(pairs.length >= 1)) expect.unreachable('Expected pairs.length >= 1');
  if (!(hotspots.every((spot) => typeof spot.id === 'string' && spot.id.length > 0))) {
    expect.unreachable(
      "Expected hotspots.every((spot) => typeof spot.id === 'string' && spot.id.length > 0)",
    );
  }
  if (!(pairs.every((pair) => Boolean(pair.sourceId) && Boolean(pair.targetId)))) {
    expect.unreachable(
      'Expected pairs.every((pair) => Boolean(pair.sourceId) && Boolean(pair.targetId))',
    );
  }
});

testCase(
  'graphic associate import round-trip: fixture → draft → qti3 export → re-import',
  async () => {
    const xml = await readQtiFixture(FIXTURE);

    const parsed = parseItemXml(xml);
    const draft = draftOfType<GraphicAssociateDraft>(parsed, 'graphic_associate');
    const rebuilt = exportQti3TestItemXml('graphic_associate', draft, {
      identifier: 'item-graphic-associate-roundtrip',
    });
    await assertQtiXmlWellFormed(rebuilt);

    draftOfType<GraphicAssociateDraft>(parseItemXml(rebuilt), 'graphic_associate');
  },
);
