import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsGraphicOrder } from '../lib/types/graphic_order.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';

testCase('graphic_order export emits graphic-order-interaction and hotspots', async () => {
  const draft = defaultsGraphicOrder();
  draft.graphicOrderBackgroundSrc = 'background.png';
  const xml = exportQti3TestItemXml('graphic_order', draft, { identifier: 'item-graphic-order-1' });

  if (!(xml.includes('<qti-graphic-order-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-graphic-order-interaction')");
  }
  if (!(xml.includes('<qti-hotspot-choice identifier="A"'))) {
    expect.unreachable('Expected xml.includes(\'<qti-hotspot-choice identifier="A"\')');
  }
  if (!(xml.includes('cardinality="ordered"'))) {
    expect.unreachable('Expected xml.includes(\'cardinality="ordered"\')');
  }

  await assertQtiXmlWellFormed(xml);
});

testCase('graphic_order central qti3 export accepts driver defaults', async () => {
  const draft = TYPE_DRIVERS.graphic_order.defaults();
  const xml = exportQti3TestItemXml('graphic_order', draft, {
    identifier: 'item-graphic-order-driver',
  });
  if (!(xml.includes('<qti-graphic-order-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-graphic-order-interaction')");
  }
  await assertQtiXmlWellFormed(xml);
});
