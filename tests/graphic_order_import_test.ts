import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { type GraphicOrderDraft } from '../lib/types/graphic_order.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'graphic_order.xml';

testCase('graphic_order import: fixture → draft contains hotspots + background', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<GraphicOrderDraft>(parsed, 'graphic_order');
  expect(draft.graphicOrderBackgroundSrc).toStrictEqual('images/ukair.png');
  const hotspots = draft.graphicOrderHotspots ?? [];
  const order = draft.graphicOrderCorrectOrder ?? [];
  if (!(hotspots.length >= 1)) expect.unreachable('Expected hotspots.length >= 1');
  if (!(order.length >= 1)) expect.unreachable('Expected order.length >= 1');
  if (!(hotspots.every((spot) => typeof spot.id === 'string' && spot.id.length > 0))) {
    expect.unreachable(
      "Expected hotspots.every((spot) => typeof spot.id === 'string' && spot.id.length > 0)",
    );
  }
});

testCase('graphic_order import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<GraphicOrderDraft>(parsed, 'graphic_order');
  const rebuilt = exportQti3TestItemXml('graphic_order', {
    title: draft.title,
    promptHtml: draft.promptHtml,
    bodyHtml: draft.bodyHtml,
    responseIdentifier: draft.responseIdentifier,
    graphicOrderBackgroundSrc: draft.graphicOrderBackgroundSrc,
    graphicOrderBackgroundAlt: draft.graphicOrderBackgroundAlt,
    graphicOrderBackgroundType: draft.graphicOrderBackgroundType,
    graphicOrderBackgroundWidth: draft.graphicOrderBackgroundWidth,
    graphicOrderBackgroundHeight: draft.graphicOrderBackgroundHeight,
    graphicOrderHotspots: draft.graphicOrderHotspots ?? [],
    graphicOrderCorrectOrder: draft.graphicOrderCorrectOrder ?? [],
    minChoices: draft.minChoices,
    maxChoices: draft.maxChoices,
  }, { identifier: 'item-graphic-order-roundtrip' });
  if (!(rebuilt.includes('data="images/ukair.png"'))) {
    expect.unreachable('Expected rebuilt.includes(\'data="images/ukair.png"\')');
  }
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  expect(draftOfType<GraphicOrderDraft>(reparsed, 'graphic_order').graphicOrderBackgroundSrc)
    .toStrictEqual('images/ukair.png');
});
