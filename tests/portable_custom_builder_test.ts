import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsPortableCustom } from '../lib/types/portable_custom.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';

testCase('portable_custom export emits pci interaction and modules', async () => {
  const draft = defaultsPortableCustom();
  draft.portableInteractionModules = [
    { id: 'mod1', primaryPath: 'modules/mod1.js', fallbackPath: 'modules/mod1-fallback.js' },
  ];
  const xml = exportQti3TestItemXml('portable_custom', draft, { identifier: 'item-pci-1' });

  if (!(xml.includes('<qti-portable-custom-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-portable-custom-interaction')");
  }
  if (!(xml.includes('custom-interaction-type-identifier='))) {
    expect.unreachable("Expected xml.includes('custom-interaction-type-identifier=')");
  }
  if (!(xml.includes('<qti-interaction-modules'))) {
    expect.unreachable("Expected xml.includes('<qti-interaction-modules')");
  }
  if (!(xml.includes('modules/mod1.js'))) {
    expect.unreachable("Expected xml.includes('modules/mod1.js')");
  }

  await assertQtiXmlWellFormed(xml);
});

testCase('portable_custom central qti3 export accepts driver defaults', async () => {
  const draft = TYPE_DRIVERS.portable_custom.defaults();
  const xml = exportQti3TestItemXml('portable_custom', draft, { identifier: 'item-pci-driver' });
  if (!(xml.includes('<qti-portable-custom-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-portable-custom-interaction')");
  }
  await assertQtiXmlWellFormed(xml);
});
