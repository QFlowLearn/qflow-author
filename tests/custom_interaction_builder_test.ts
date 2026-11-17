import { test as testCase } from 'vitest';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsCustomInteraction } from '../lib/types/custom_interaction.ts';

testCase('custom_interaction export emits custom interaction XML', async () => {
  const draft = defaultsCustomInteraction();
  draft.title = 'Custom Interaction Item';
  draft.responseIdentifier = 'RESPONSE';
  draft.customBaseType = 'string';
  draft.customCardinality = 'single';
  draft.customClassName = 'customWidget';
  draft.customAttributes = [{ name: 'data-mode', value: 'alpha' }];
  draft.customInteractionMarkup = '<div class="custom">Hello</div>';

  const xml = exportQti3TestItemXml('custom_interaction', draft, { identifier: 'item-custom-1' });
  if (!xml.includes('<qti-custom-interaction')) {
    throw new Error('missing custom interaction');
  }
  if (!xml.includes('data-mode="alpha"')) {
    throw new Error('missing custom attribute');
  }
  if (!xml.includes('base-type="string"')) {
    throw new Error('missing base-type');
  }
  await assertQtiXmlWellFormed(xml);
});
