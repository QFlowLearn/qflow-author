import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsHottext } from '../lib/types/hottext.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';

testCase('hottext export emits hottext-interaction and response declarations', async () => {
  const draft = defaultsHottext();
  draft.minChoices = 1;
  draft.minChoicesMessage = 'Pick one';
  draft.maxChoicesMessage = 'Only one';
  const xml = exportQti3TestItemXml('hottext', draft, { identifier: 'item-hottext-1' });

  if (!(xml.includes('<qti-hottext-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-hottext-interaction')");
  }
  if (!(xml.includes('<qti-hottext identifier="A">'))) {
    expect.unreachable('Expected xml.includes(\'<qti-hottext identifier="A">\')');
  }
  if (!(xml.includes('<qti-response-declaration identifier="RESPONSE"'))) {
    expect.unreachable(
      'Expected xml.includes(\'<qti-response-declaration identifier="RESPONSE"\')',
    );
  }
  if (!(xml.includes('min-choices="1"'))) {
    expect.unreachable('Expected xml.includes(\'min-choices="1"\')');
  }
  if (!(xml.includes('data-min-selections-message="Pick one"'))) {
    expect.unreachable('Expected xml.includes(\'data-min-selections-message="Pick one"\')');
  }
  if (!(xml.includes('data-max-selections-message="Only one"'))) {
    expect.unreachable('Expected xml.includes(\'data-max-selections-message="Only one"\')');
  }
  if (xml.includes('data-qti-hottext')) {
    expect.unreachable("Expected !xml.includes('data-qti-hottext')");
  }

  await assertQtiXmlWellFormed(xml);
});

testCase('hottext central qti3 export accepts driver defaults', async () => {
  const draft = TYPE_DRIVERS.hottext.defaults();
  const xml = exportQti3TestItemXml('hottext', draft, { identifier: 'item-hottext-driver' });
  if (!(xml.includes('<qti-hottext-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-hottext-interaction')");
  }
  await assertQtiXmlWellFormed(xml);
});
