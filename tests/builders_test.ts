import { test as testCase } from 'vitest';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';

import { createTextEntrySlot } from '../lib/types/text_entry.ts';

import { defaultsExtendedText } from '../lib/types/extended_text.ts';
import { writeZip } from '../lib/zip.ts';
import { createPlaceholderHtml } from '../lib/text_entry_placeholders.ts';

const BODY = '<p>Context</p>';

testCase('single select export emits well-formed XML', async () => {
  const xml = exportQti3TestItemXml(
    'single_select',
    {
      title: 'Test',
      bodyHtml: BODY,
      promptHtml: 'What is 2+2?',
      choices: [{ id: 'A', text: '3' }, { id: 'B', text: '4' }],
      correctId: 'B',
      shuffle: true,
    },
    { identifier: 't1' },
  );
  if (!xml.includes('<qti-choice-interaction')) throw new Error('missing choice-interaction');
  await assertQtiXmlWellFormed(xml);
});

testCase('multi select export emits multiple correct values', async () => {
  const xml = exportQti3TestItemXml(
    'multi_select',
    {
      title: 'Test',
      bodyHtml: BODY,
      promptHtml: 'Pick all',
      choices: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }, { id: 'C', text: '3' }],
      correctIds: ['A', 'C'],
      minChoices: 1,
      maxChoices: 0,
    },
    { identifier: 't2' },
  );
  if (!xml.includes('<qti-value>A</qti-value>') || !xml.includes('<qti-value>C</qti-value>')) {
    throw new Error('missing correct values');
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('single select partial scoring emits map_response mapping', () => {
  const xml = exportQti3TestItemXml(
    'single_select',
    {
      title: 'Test',
      bodyHtml: BODY,
      promptHtml: 'Pick one',
      choices: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }],
      correctId: 'B',
      shuffle: false,
    },
    { identifier: 't2b', scoring: 'map_response' },
  );
  if (!xml.includes('<qti-mapping')) throw new Error('missing mapping');
  if (!xml.includes('rptemplates/map_response')) throw new Error('wrong template');
});

testCase('single select required + masking emit spec attributes', () => {
  const xml = exportQti3TestItemXml('single_select', {
    title: 'Req',
    bodyHtml: BODY,
    promptHtml: 'Pick',
    choices: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }],
    correctId: 'A',
    shuffle: true,
  }, {
    identifier: 'req1',
    required: true,
    minChoices: 1,
    answerMasking: true,
    sharedVocabulary: { labelStyle: 'decimal', choicesStacking: 2, selectionTone: 'dark' },
  });
  if (!xml.includes('min-choices="1"')) throw new Error('missing min-choices attr');
  if (!xml.includes('show-hide="hide"')) throw new Error('missing show-hide attr');
  if (!xml.includes('class="') || !xml.includes('qti-labels-decimal')) {
    throw new Error('missing shared vocabulary classes');
  }
});

testCase('multi select partial scoring emits map_response mapping entries', () => {
  const xml = exportQti3TestItemXml(
    'multi_select',
    {
      title: 'Test',
      bodyHtml: BODY,
      promptHtml: 'Pick many',
      choices: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }, { id: 'C', text: '3' }],
      correctIds: ['A', 'C'],
      minChoices: 1,
      maxChoices: 0,
      shuffle: false,
    },
    { identifier: 't2c', scoring: 'map_response' },
  );
  if (!xml.includes('<qti-mapping')) throw new Error('missing mapping');
  if (!xml.includes('<qti-map-entry map-key="A" mapped-value="1"')) {
    throw new Error('missing A map');
  }
  if (!xml.includes('<qti-map-entry map-key="B" mapped-value="0"')) {
    throw new Error('missing B map');
  }
});

testCase('match export emits the same number of qti-value entries as pairs', () => {
  const pairs = [{ sourceId: 'A', targetId: 'T1' }, { sourceId: 'B', targetId: 'T2' }];
  const xml = exportQti3TestItemXml(
    'match',
    {
      title: 'Match',
      bodyHtml: BODY,
      promptHtml: '',
      sources: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
      targets: [{ id: 'T1', text: '1' }, { id: 'T2', text: '2' }],
      correctPairs: pairs,
      maxAssociations: 0,
    },
    { identifier: 't6' },
  );
  const count = (xml.match(/<qti-value>/g) || []).length;
  if (count !== pairs.length) throw new Error(`expected ${pairs.length} values, saw ${count}`);
});

testCase('zip writer can package assessment + items', async () => {
  const files = [
    {
      name: 'imsmanifest.xml',
      data: new TextEncoder().encode(
        '<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"></manifest>',
      ),
    },
    {
      name: 'assessment.xml',
      data: new TextEncoder().encode(
        '<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="t" title="T"/>',
      ),
    },
    {
      name: 'items/x.xml',
      data: new TextEncoder().encode(
        '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="x" title="X"/>',
      ),
    },
  ];
  const zip = await writeZip(files);
  if (!(zip[0] === 0x50 && zip[1] === 0x4b)) throw new Error('not a zip (PK)');
});

testCase('text entry export emits text-entry interaction', async () => {
  const slot = createTextEntrySlot('RESPONSE', 'Blank 1');
  slot.expectedLength = 10;
  slot.answers[0].value = 'deno';
  const placeholder = createPlaceholderHtml({
    id: slot.id,
    label: slot.label,
    widthClass: slot.widthClass,
  });
  const xml = exportQti3TestItemXml(
    'text_entry',
    { title: 'SA', promptHtml: 'Type it', bodyHtml: `<p>${placeholder}</p>`, textEntries: [slot] },
    { identifier: 't3' },
  );
  if (!xml.includes('<qti-text-entry-interaction')) throw new Error('missing text-entry');
  await assertQtiXmlWellFormed(xml);
});

testCase('order export emits ordered cardinality and order-interaction', async () => {
  const xml = exportQti3TestItemXml(
    'order',
    {
      title: 'Order',
      bodyHtml: BODY,
      promptHtml: 'Put in order',
      choices: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }, { id: 'C', text: '3' }],
      correctOrder: ['C', 'B', 'A'],
    },
    { identifier: 't4' },
  );
  if (!xml.includes('cardinality="ordered"')) throw new Error('missing ordered cardinality');
  if (!xml.includes('<qti-order-interaction')) throw new Error('missing order-interaction');
  await assertQtiXmlWellFormed(xml);
});

testCase('match export emits directedPair and match-interaction', async () => {
  const xml = exportQti3TestItemXml(
    'match',
    {
      title: 'Match',
      bodyHtml: BODY,
      promptHtml: 'Match',
      sources: [{ id: 'A', text: 'Dog', matchMax: 1 }],
      targets: [{ id: 'T1', text: 'Barks' }],
      correctPairs: [{ sourceId: 'A', targetId: 'T1' }],
      maxAssociations: 0,
    },
    { identifier: 't5' },
  );
  if (!xml.includes('base-type="directedPair"')) throw new Error('missing directedPair');
  if (!xml.includes('<qti-match-interaction')) throw new Error('missing match-interaction');
  if (!xml.includes('max-associations="0"')) throw new Error('missing max-associations');
  if (!xml.includes('match-max="1"')) throw new Error('missing per-choice match-max');
  await assertQtiXmlWellFormed(xml);
});

testCase('associate export emits pair base-type and associate-interaction', async () => {
  const xml = exportQti3TestItemXml(
    'associate',
    {
      title: 'Associate',
      bodyHtml: BODY,
      promptHtml: 'Pair the items',
      choices: [{ id: 'A', text: 'Dog', matchMax: 1 }, { id: 'B', text: 'Cat', matchMax: 1 }],
      correctPairs: [{ sourceId: 'A', targetId: 'B' }],
      minAssociations: 1,
      maxAssociations: 2,
      shuffle: true,
    },
    { identifier: 'assoc-1' },
  );
  if (!xml.includes('base-type="pair"')) throw new Error('missing pair base-type');
  if (!xml.includes('<qti-associate-interaction')) throw new Error('missing associate-interaction');
  if (!xml.includes('min-associations="1"')) throw new Error('missing min-associations');
  if (!xml.includes('max-associations="2"')) throw new Error('missing max-associations');
  if (!xml.includes('match-max="1"')) throw new Error('missing per-choice match-max');
  await assertQtiXmlWellFormed(xml);
});

testCase('extended text export emits extended-text interaction and rubric', async () => {
  const draft = defaultsExtendedText();
  draft.title = 'Essay';
  draft.bodyHtml = '<p>Read the passage.</p>';
  draft.promptHtml = '<p>Write at least three sentences.</p>';
  draft.expectedLength = 150;
  draft.expectedLines = 5;
  draft.patternMask = '^[A-Za-z\s]+$';
  draft.patternMessage = 'Letters and spaces only';
  draft.heightClass = 'qti-height-lines-15';
  draft.counterType = 'down';
  draft.rubricHtml = '<p>Score 0-3 using holistic rubric.</p>';
  const xml = exportQti3TestItemXml('extended_text', draft, { identifier: 't7' });
  if (!xml.includes('<qti-extended-text-interaction')) {
    throw new Error('missing extended text interaction');
  }
  if (!xml.includes('expected-length="150"')) throw new Error('missing expected-length attr');
  if (!xml.includes('class="qti-height-lines-15 qti-counter-down"')) {
    throw new Error('missing shared vocabulary classes');
  }
  if (!xml.includes('<qti-rubric-block')) throw new Error('missing rubric block');
  await assertQtiXmlWellFormed(xml);
});
