import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import {
  defaultsGraphicAssociate,
  validateGraphicAssociate,
} from '../lib/types/graphic_associate.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';

testCase('graphic_associate export emits graphic-associate-interaction and hotspots', async () => {
  const draft = defaultsGraphicAssociate();
  draft.graphicAssociateBackgroundSrc = 'background.png';
  const xml = exportQti3TestItemXml('graphic_associate', draft, {
    identifier: 'item-graphic-associate-1',
  });

  if (!(xml.includes('<qti-graphic-associate-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-graphic-associate-interaction')");
  }
  if (!(xml.includes('<qti-associable-hotspot identifier="A"'))) {
    expect.unreachable('Expected xml.includes(\'<qti-associable-hotspot identifier="A"\')');
  }
  if (!(xml.includes('<qti-response-declaration identifier="RESPONSE"'))) {
    expect.unreachable(
      'Expected xml.includes(\'<qti-response-declaration identifier="RESPONSE"\')',
    );
  }

  await assertQtiXmlWellFormed(xml);
});

testCase('graphic_associate central qti3 export accepts driver defaults', async () => {
  const draft = TYPE_DRIVERS.graphic_associate.defaults();
  const xml = exportQti3TestItemXml('graphic_associate', draft, {
    identifier: 'item-graphic-associate-driver',
  });
  if (!(xml.includes('<qti-graphic-associate-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-graphic-associate-interaction')");
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('graphic_associate requires MIME metadata for extensionless images', () => {
  const draft = defaultsGraphicAssociate();
  draft.graphicAssociateBackgroundSrc = '/uploads/background';
  draft.graphicAssociateBackgroundType = '';

  if (
    !(validateGraphicAssociate(draft).includes(
      'Background MIME type is required when it cannot be inferred from the image source.',
    ))
  ) {
    expect.unreachable(
      "Expected validateGraphicAssociate(draft).includes( 'Background MIME type is required when it cannot",
    );
  }
});
