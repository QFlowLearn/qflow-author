import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsInlineChoice } from '../lib/types/inline_choice.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';

testCase(
  'inline_choice export emits inline-choice-interaction and response declarations',
  async () => {
    const draft = defaultsInlineChoice();
    const xml = exportQti3TestItemXml('inline_choice', draft, {
      identifier: 'item-inline-choice-1',
    });

    if (!(xml.includes('<qti-inline-choice-interaction'))) {
      expect.unreachable("Expected xml.includes('<qti-inline-choice-interaction')");
    }
    if (!(xml.includes('<qti-inline-choice identifier="A">'))) {
      expect.unreachable('Expected xml.includes(\'<qti-inline-choice identifier="A">\')');
    }
    if (!(xml.includes('<qti-response-declaration identifier="RESPONSE_1"'))) {
      expect.unreachable(
        'Expected xml.includes(\'<qti-response-declaration identifier="RESPONSE_1"\')',
      );
    }
    if (!(xml.includes('<qti-response-processing>'))) {
      expect.unreachable("Expected xml.includes('<qti-response-processing>')");
    }

    await assertQtiXmlWellFormed(xml);
  },
);

testCase('inline_choice central qti3 export accepts driver defaults', async () => {
  const draft = TYPE_DRIVERS.inline_choice.defaults();
  const xml = exportQti3TestItemXml('inline_choice', draft, {
    identifier: 'item-inline-choice-driver',
  });
  if (!(xml.includes('<qti-inline-choice-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-inline-choice-interaction')");
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('inline_choice export supports partial scoring via mapping + map-response', async () => {
  const draft = defaultsInlineChoice();
  draft.responseMode = 'partial';
  draft.inlineChoices[0].options = [
    { id: 'A', text: 'A', score: 0 },
    { id: 'B', text: 'B', score: 2 },
    { id: 'C', text: 'C', score: 0 },
  ];
  draft.inlineChoices[0].correctId = 'B';

  const xml = exportQti3TestItemXml('inline_choice', draft, { identifier: 'item-inline-choice-2' });
  if (!(xml.includes('<qti-mapping'))) expect.unreachable("Expected xml.includes('<qti-mapping')");
  if (!(xml.includes('<qti-map-entry map-key="B" mapped-value="2"/>'))) {
    expect.unreachable('Expected xml.includes(\'<qti-map-entry map-key="B" mapped-value="2"/>\')');
  }
  if (!(xml.includes('<qti-map-response identifier="RESPONSE_1"/>'))) {
    expect.unreachable('Expected xml.includes(\'<qti-map-response identifier="RESPONSE_1"/>\')');
  }

  await assertQtiXmlWellFormed(xml);
});
