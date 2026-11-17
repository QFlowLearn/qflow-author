import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsHotspot, validateHotspot } from '../lib/types/hotspot.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';

testCase('hotspot export emits hotspot-interaction and choices', async () => {
  const draft = defaultsHotspot();
  draft.hotspotImageSrc = 'ukair.png';
  draft.hotspotImageAlt = 'UK air map';
  const xml = exportQti3TestItemXml('hotspot', draft, { identifier: 'item-hotspot-1' });
  if (!(xml.includes('<qti-hotspot-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-hotspot-interaction')");
  }
  if (!(xml.includes('<qti-hotspot-choice identifier="A"'))) {
    expect.unreachable('Expected xml.includes(\'<qti-hotspot-choice identifier="A"\')');
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('hotspot central qti3 export accepts driver defaults', async () => {
  const draft = TYPE_DRIVERS.hotspot.defaults();
  draft.hotspotImageSrc = 'ukair.png';
  draft.hotspotImageAlt = 'UK air map';
  const xml = exportQti3TestItemXml('hotspot', draft, { identifier: 'item-hotspot-driver' });
  if (!(xml.includes('<qti-hotspot-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-hotspot-interaction')");
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('hotspot defaults start without a persisted placeholder image', () => {
  const draft = defaultsHotspot();
  expect(draft.hotspotImageSrc).toStrictEqual('');
  expect(draft.hotspotImageAlt).toStrictEqual('');
});

testCase('hotspot validation only requires alt text once an image exists', () => {
  const draft = defaultsHotspot();
  if (!(validateHotspot(draft).includes('Image src is required.'))) {
    expect.unreachable("Expected validateHotspot(draft).includes('Image src is required.')");
  }
  expect(validateHotspot(draft).includes('Image alt text is required.')).toStrictEqual(false);

  draft.hotspotImageSrc = 'diagram.png';
  if (!(validateHotspot(draft).includes('Image alt text is required.'))) {
    expect.unreachable("Expected validateHotspot(draft).includes('Image alt text is required.')");
  }
});
