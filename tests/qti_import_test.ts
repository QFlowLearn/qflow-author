import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';
import { importedQuestionPlacements } from '../lib/import/types.ts';
import { validateSingleSelect } from '../lib/types/single_select.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { type SingleSelectDraft } from '../lib/types/single_select.ts';
import { draftOfType } from './import_draft.ts';

import { buildAssessmentTestXml } from '../lib/test_export.ts';
import { writeZip } from '../lib/zip.ts';
import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { QtiItemLanguageImportError } from '../lib/import/adapters/qti3/qti_import_support.ts';
import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { parseQtiPackageEntries } from '../lib/import/adapters/qti3/parse_package.ts';
import { RICH_CHOICE_ITEM_XML } from './fixtures/qti3/rich_choice.ts';

const enc = new TextEncoder();

testCase('QFlow imports rich choice QTI into draft with MathML prompt and rich choices', () => {
  // This synthetic scored variant explicitly authors its key and program. The original
  // fixture has neither and must remain source requiring review, as verified below.
  const scored = RICH_CHOICE_ITEM_XML.replace(
    '<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>',
    '<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>A</qti-value></qti-correct-response></qti-response-declaration>',
  ).replace(
    '</qti-assessment-item>',
    '<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/></qti-assessment-item>',
  );
  const result = parseItemXml(scored);
  const draft = draftOfType<SingleSelectDraft>(result, 'single_select');
  expect(draft.promptHtml ?? '').toContain('<math');
  expect(draft.promptHtml ?? '').toContain('Choose');

  const choices = draft.choices;
  expect(choices.find((choice) => choice.id === 'A')?.text).toStrictEqual('alpha');
  expect(choices.find((choice) => choice.id === 'A')?.html ?? '').toContain('<math');
  expect(choices.find((choice) => choice.id === 'B')?.text).toStrictEqual('Beta image');
  expect(choices.find((choice) => choice.id === 'B')?.html ?? '').toContain('<img');
});

testCase(
  'unscored rich choice source stays exact and blocked without an invented answer or program',
  async () => {
    expect(() => parseItemXml(RICH_CHOICE_ITEM_XML)).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('points')
      ),
    );
    const result = await parseQtiPackageEntries([
      {
        path: 'imsmanifest.xml',
        data:
          '<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"><resources><resource identifier="rich-choice" type="imsqti_item_xmlv3p0" href="item.xml"><file href="item.xml"/><file href="b.png"/></resource></resources></manifest>',
      },
      { path: 'item.xml', data: RICH_CHOICE_ITEM_XML },
      {
        path: 'b.png',
        data: await _fs.readFile('tests/fixtures/import/qti21/hotspot_package/map.png'),
      },
    ]);
    expect(result.items.length).toStrictEqual(1);
    expect(result.items[0].xml).toStrictEqual(RICH_CHOICE_ITEM_XML);
    expect(result.items[0].draft.preserveSourceXml).toStrictEqual(true);
    expect(result.items[0].draft.importWarnings?.[0].code).toStrictEqual(
      'QTI3_CHOICE_POINTS_NOT_PRESERVED',
    );
    expect(result.items[0].draft.bodyHtml ?? '').toContain('&lt;math');
    expect(result.items[0].draft.bodyHtml ?? '').toContain('b.png');
  },
);

testCase('QTI item import rejects missing or invalid xml:lang structurally', () => {
  for (const language of ['', 'not a language']) {
    const xml = RICH_CHOICE_ITEM_XML.replace(
      'xml:lang="en-US"',
      language ? `xml:lang="${language}"` : '',
    );
    expect(() => parseItemXml(xml)).toThrowError(QtiItemLanguageImportError);
  }
});

testCase('parseQtiPackage imports parts and items', async () => {
  const item1 = exportQti3TestItemXml('single_select', {
    title: 'Capital',
    bodyHtml: '<p>Geo prompt body</p>',
    promptHtml: '<p>What is the capital of France?</p>',
    choices: [
      { id: 'A', text: 'Paris' },
      { id: 'B', text: 'Rome' },
      { id: 'C', text: 'Berlin' },
    ],
    correctId: 'A',
    shuffle: true,
  }, { identifier: 'item-1' });
  const item2 = exportQti3TestItemXml('multi_select', {
    title: 'Planets',
    bodyHtml: '<p>Space question body</p>',
    promptHtml: '<p>Select gas giants.</p>',
    choices: [
      { id: 'A', text: 'Mars' },
      { id: 'B', text: 'Jupiter' },
      { id: 'C', text: 'Saturn' },
    ],
    correctIds: ['B', 'C'],
    shuffle: false,
  }, { identifier: 'item-2' });
  const testXml = buildAssessmentTestXml({ id: 'demo', title: 'Sample' }, [
    {
      id: 'part-1',
      title: 'Section A',
      placements: [
        { id: 'p1', itemId: 'item-1' },
        { id: 'p2', itemId: 'item-2' },
      ],
    },
  ]);
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1">
  <resources>
    <resource identifier="test-1" type="imsqti_test_xmlv3p0" href="assessment.xml">
      <file href="assessment.xml"/>
      <dependency identifierref="item-1"/>
      <dependency identifierref="item-2"/>
    </resource>
    <resource identifier="item-1" type="imsqti_item_xmlv3p0" href="items/item-1.xml">
      <file href="items/item-1.xml"/>
    </resource>
    <resource identifier="item-2" type="imsqti_item_xmlv3p0" href="items/item-2.xml">
      <file href="items/item-2.xml"/>
    </resource>
  </resources>
</manifest>`;
  const zipBytes = await writeZip([
    { name: 'imsmanifest.xml', data: enc.encode(manifestXml) },
    { name: 'assessment.xml', data: enc.encode(testXml) },
    { name: 'items/item-1.xml', data: enc.encode(item1) },
    { name: 'items/item-2.xml', data: enc.encode(item2) },
  ]);

  const result = await parseQtiPackage(zipBytes);
  expect(result.title).toStrictEqual('Sample');
  expect(result.parts.length).toStrictEqual(1);
  expect(result.parts[0].placements.length).toStrictEqual(2);
  expect(result.items.length).toStrictEqual(2);
  if (!(result.items.some((it) => it.draft.type === 'single_select'))) {
    expect.unreachable("Expected result.items.some((it) => it.draft.type === 'single_select')");
  }
  if (!(result.items.some((it) => it.draft.type === 'multi_select'))) {
    expect.unreachable("Expected result.items.some((it) => it.draft.type === 'multi_select')");
  }
  const hasPromptMarkUp = result.items.some((it) => (it.draft.promptHtml ?? '').includes('<p>'));
  expect(hasPromptMarkUp).toStrictEqual(true);
});

testCase('parseQtiPackage surfaces assets referenced in content', async () => {
  let itemXml = exportQti3TestItemXml('single_select', {
    title: 'Diagram',
    bodyHtml: '<p>Body with image</p>',
    promptHtml: '<p>Review the diagram.</p>',
    choices: [
      { id: 'A', text: 'One' },
      { id: 'B', text: 'Two' },
    ],
    correctId: 'A',
    shuffle: false,
  }, { identifier: 'item-asset' });
  itemXml = itemXml.replace(
    /<qti-prompt>[\s\S]*?<\/qti-prompt>/,
    '<qti-prompt>Diagram <qti-img src="assets/diagram.png" alt="Diagram"/></qti-prompt>',
  );
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1">
  <resources>
    <resource identifier="test-1" type="imsqti_test_xmlv3p0" href="assessment.xml">
      <file href="assessment.xml"/>
      <dependency identifierref="item-asset"/>
    </resource>
    <resource identifier="item-asset" type="imsqti_item_xmlv3p0" href="items/item-asset.xml">
      <file href="items/item-asset.xml"/>
      <dependency identifierref="asset-1"/>
    </resource>
    <resource identifier="asset-1" type="webcontent" href="assets/diagram.png">
      <file href="assets/diagram.png"/>
    </resource>
  </resources>
</manifest>`;
  const testXml = buildAssessmentTestXml({ id: 'demo', title: 'Assets' }, [
    { id: 'part-1', title: 'Part', placements: [{ id: 'pl', itemId: 'item-asset' }] },
  ]);
  const zipBytes = await writeZip([
    { name: 'imsmanifest.xml', data: enc.encode(manifestXml) },
    { name: 'assessment.xml', data: enc.encode(testXml) },
    { name: 'items/item-asset.xml', data: enc.encode(itemXml) },
    { name: 'assets/diagram.png', data: new Uint8Array([1, 2, 3]) },
  ]);

  const result = await parseQtiPackage(zipBytes);
  expect(result.items.length).toStrictEqual(1);
  expect(result.assets.length).toStrictEqual(1);
  expect(result.items[0].draft.promptHtml ?? '').toContain('assets/diagram.png');
  expect(result.items[0].draft.bodyHtml ?? '').toContain('Body with image');
});

testCase('parseQtiPackage stubs unsupported interactions instead of failing import', async () => {
  const unsupportedItemXml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item
  xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
  identifier="item-unsupported"
  title="Unsupported Interaction"
  time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
  <qti-item-body>
    <qti-position-slider-interaction response-identifier="RESPONSE"/>
  </qti-item-body>
</qti-assessment-item>`;

  const testXml = buildAssessmentTestXml({ id: 'demo', title: 'Unsupported Import' }, [
    { id: 'part-1', title: 'Part', placements: [{ id: 'pl-1', itemId: 'item-unsupported' }] },
  ]);
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1">
  <resources>
    <resource identifier="test-1" type="imsqti_test_xmlv3p0" href="assessment.xml">
      <file href="assessment.xml"/>
      <dependency identifierref="item-unsupported"/>
    </resource>
    <resource identifier="item-unsupported" type="imsqti_item_xmlv3p0" href="items/item-unsupported.xml">
      <file href="items/item-unsupported.xml"/>
    </resource>
  </resources>
</manifest>`;

  const zipBytes = await writeZip([
    { name: 'imsmanifest.xml', data: enc.encode(manifestXml) },
    { name: 'assessment.xml', data: enc.encode(testXml) },
    { name: 'items/item-unsupported.xml', data: enc.encode(unsupportedItemXml) },
  ]);

  const result = await parseQtiPackage(zipBytes);
  expect(result.items.length).toStrictEqual(1);
  expect(result.items[0].draft.type).toStrictEqual('custom_interaction');
  if (!(result.warnings?.some((warning) => warning.code === 'UNSUPPORTED_ITEM_STUBBED'))) {
    expect.unreachable(
      "Expected result.warnings?.some((warning) => warning.code === 'UNSUPPORTED_ITEM_STUBBED')",
    );
  }
});

testCase('parseQtiPackage imports item-only QTI 3 package without a test resource', async () => {
  const itemXml = exportQti3TestItemXml('single_select', {
    title: 'Standalone Item',
    bodyHtml: '<p>Body only</p>',
    promptHtml: '<p>What is 2 + 2?</p>',
    choices: [
      { id: 'A', text: '3' },
      { id: 'B', text: '4' },
      { id: 'C', text: '5' },
    ],
    correctId: 'B',
    shuffle: false,
  }, { identifier: 'standalone-1' });

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1">
  <resources>
    <resource identifier="item-1" type="imsqti_item_xmlv3p0" href="items/item-1.xml">
      <file href="items/item-1.xml"/>
    </resource>
  </resources>
</manifest>`;

  const zipBytes = await writeZip([
    { name: 'imsmanifest.xml', data: enc.encode(manifestXml) },
    { name: 'items/item-1.xml', data: enc.encode(itemXml) },
  ]);

  const result = await parseQtiPackage(zipBytes);
  expect(result.parts.length).toStrictEqual(1);
  expect(result.parts[0].placements.length).toStrictEqual(1);
  expect(importedQuestionPlacements(result.parts[0].placements)[0].href).toStrictEqual(
    'items/item-1.xml',
  );
  expect(result.items.length).toStrictEqual(1);
  expect(result.items[0].draft.type).toStrictEqual('single_select');
});

testCase('parseQtiPackage preserves typed catalog validation diagnostics', async () => {
  const baseItemXml = exportQti3TestItemXml('single_select', {
    title: 'Catalog policy',
    bodyHtml: '<p>Body</p>',
    promptHtml: '<p>Choose one.</p>',
    choices: [
      { id: 'A', text: 'One' },
      { id: 'B', text: 'Two' },
    ],
    correctId: 'A',
    shuffle: false,
  }, { identifier: 'catalog-policy' });
  const itemXml = baseItemXml.replace(
    /(<qti-response-processing\b)/,
    `<qti-catalog-info>
      <qti-catalog id="1-invalid">
        <qti-card support="glossary-on-screen">
          <qti-html-content><p>Definition</p></qti-html-content>
        </qti-card>
      </qti-catalog>
    </qti-catalog-info>
    $1`,
  );
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1">
  <resources>
    <resource identifier="catalog-policy-resource" type="imsqti_item_xmlv3p0" href="items/catalog-policy.xml">
      <file href="items/catalog-policy.xml"/>
    </resource>
  </resources>
</manifest>`;
  const zipBytes = await writeZip([
    { name: 'imsmanifest.xml', data: enc.encode(manifestXml) },
    { name: 'items/catalog-policy.xml', data: enc.encode(itemXml) },
  ]);

  const result = await parseQtiPackage(zipBytes);

  expect(result.warnings?.map((warning) => warning.code)).toStrictEqual(['CATALOG_ID_INVALID']);
});

testCase('parseQtiPackage does not hoist section options into part options', async () => {
  const itemXml = exportQti3TestItemXml('single_select', {
    title: 'Section Option Item',
    bodyHtml: '<p>Body</p>',
    promptHtml: '<p>Prompt</p>',
    choices: [
      { id: 'A', text: 'One' },
      { id: 'B', text: 'Two' },
    ],
    correctId: 'A',
    shuffle: false,
  }, { identifier: 'section-option-item' });

  const testXml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="test-1" title="Nested Section Options">
  <qti-test-part identifier="part-1" navigation-mode="nonlinear" submission-mode="individual">
    <qti-assessment-section identifier="section-1" title="Section 1" visible="true">
      <qti-time-limits min-time="30" max-time="300"/>
      <qti-rubric-block view="candidate" use="instructions"><qti-content-body><p>Section-only rubric</p></qti-content-body></qti-rubric-block>
      <qti-test-feedback identifier="section-feedback" outcome-identifier="FEEDBACK" access="atEnd" show-hide="show">
        <qti-content-body><p>Section feedback</p></qti-content-body>
      </qti-test-feedback>
      <qti-assessment-item-ref identifier="item-ref-1" href="items/section-option-item.xml"/>
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`;

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1">
  <resources>
    <resource identifier="test-1" type="imsqti_test_xmlv3p0" href="assessment.xml">
      <file href="assessment.xml"/>
      <dependency identifierref="item-1"/>
    </resource>
    <resource identifier="item-1" type="imsqti_item_xmlv3p0" href="items/section-option-item.xml">
      <file href="items/section-option-item.xml"/>
    </resource>
  </resources>
</manifest>`;

  const zipBytes = await writeZip([
    { name: 'imsmanifest.xml', data: enc.encode(manifestXml) },
    { name: 'assessment.xml', data: enc.encode(testXml) },
    { name: 'items/section-option-item.xml', data: enc.encode(itemXml) },
  ]);

  const result = await parseQtiPackage(zipBytes);
  expect(result.parts.length).toStrictEqual(1);
  expect(result.parts[0].placements.length).toStrictEqual(2);
  expect(result.parts[0].placements[0]).toStrictEqual({
    content: { kind: 'text', text: 'Section-only rubric' },
    refIdentifier: 'section-1',
  });
  expect(result.parts[0].options?.timeLimits).toStrictEqual(undefined);
  expect(result.parts[0].options?.instructionsHtml).toStrictEqual(undefined);
  expect(result.parts[0].options?.feedback).toStrictEqual(undefined);
});

testCase(
  'single-select XML preserves data-ssml and data-reading-type through import parsing',
  () => {
    const xml = exportQti3TestItemXml('single_select', {
      title: 'SSML prompt',
      bodyHtml:
        '<p><span data-ssml=\'{"break":{"time":"1s"}}\' data-reading-type="screen-reader">Pause</span></p>',
      promptHtml:
        '<span data-ssml=\'{"sub":{"alias":"Froyd"}}\' data-reading-type="computer-read-aloud">Freud</span>',
      choices: [
        { id: 'A', text: 'Option A' },
        { id: 'B', text: 'Option B' },
      ],
      correctId: 'A',
    }, { identifier: 'item-ssml' });

    expect(xml).toContain('data-ssml=');
    expect(xml).toContain('data-reading-type="computer-read-aloud"');
    expect(xml).toContain('data-reading-type="screen-reader"');

    const parsed = parseItemXml(xml);
    expect(parsed.draft.promptHtml ?? '').toContain('data-ssml=');
    expect(parsed.draft.promptHtml ?? '').toContain('data-reading-type="computer-read-aloud"');
    expect(parsed.draft.bodyHtml ?? '').toContain('data-ssml=');
    expect(parsed.draft.bodyHtml ?? '').toContain('data-reading-type="screen-reader"');
  },
);

testCase('a QTI choice prompt is sufficient question content without a separate body', () => {
  const item = exportQti3TestItemXml('single_select', {
    title: 'Prompt-only question',
    promptHtml: '<p>Which is correct?</p>',
    choices: [{ id: 'A', text: 'Yes' }, { id: 'B', text: 'No' }],
    correctId: 'A',
  }, { identifier: 'prompt-only' });
  const draft = draftOfType<SingleSelectDraft>(parseItemXml(item), 'single_select');
  expect(validateSingleSelect(draft)).toStrictEqual([]);
  if (!(validateSingleSelect({ ...draft, bodyHtml: '', promptHtml: '' }).length > 0)) {
    expect.unreachable(
      "Expected validateSingleSelect({ ...draft, bodyHtml: '', promptHtml: '' }).length > 0",
    );
  }
});
