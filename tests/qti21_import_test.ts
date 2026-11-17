import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';
import { createItemSession, parseQtiXml, type QtiValue } from '@longsightgroup/qti3-core';
import { buildItemXmlFromPreparedDraft, prepareDriverDraft } from '../lib/qti_build.ts';

import { join } from 'node:path';
import { qti21Adapter } from '../lib/import/adapters/qti21.ts';
import { detectImportAdapter } from '../lib/import/registry.ts';
import { writeZip, type ZipEntry } from '../lib/zip.ts';

const QTI21_CHOICE = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item1" title="Simple Choice" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>B</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>Who was the first President of the United States?</p>
    <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1" shuffle="false">
      <simpleChoice identifier="A">Thomas Jefferson</simpleChoice>
      <simpleChoice identifier="B">George Washington</simpleChoice>
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

const QTI21_INLINE = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item2" title="Inline Choice" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE_1" cardinality="single" baseType="identifier">
    <correctResponse><value>B</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>Select
      <inlineChoiceInteraction responseIdentifier="RESPONSE_1" shuffle="false">
        <inlineChoice identifier="A">Thomas Jefferson</inlineChoice>
        <inlineChoice identifier="B">George Washington</inlineChoice>
      </inlineChoiceInteraction>
      to complete the sentence.
    </p>
  </itemBody>
  <responseProcessing>
    <setOutcomeValue identifier="SCORE"><baseValue baseType="float">0</baseValue></setOutcomeValue>
    <responseCondition><responseIf><and>
      <not><isNull><variable identifier="RESPONSE_1"/></isNull></not>
      <match><variable identifier="RESPONSE_1"/><correct identifier="RESPONSE_1"/></match>
    </and><setOutcomeValue identifier="SCORE"><baseValue baseType="float">1</baseValue></setOutcomeValue>
    </responseIf></responseCondition>
  </responseProcessing>
</assessmentItem>`;

const QTI21_HOTTEXT = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item3" title="Hottext" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="identifier">
    <correctResponse><value>H1</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <hottextInteraction responseIdentifier="RESPONSE" maxChoices="1">
      <p>The first President was <hottext identifier="H1">George Washington</hottext>.</p>
      <p>The second President was <hottext identifier="H2">John Adams</hottext>.</p>
    </hottextInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

const QTI21_HOTSPOT = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item4" title="Hotspot" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>HS1</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>Select the first region on the map.</p>
    <hotspotInteraction responseIdentifier="RESPONSE" maxChoices="1">
      <object data="map.png" type="image/png" alt="USA map"/>
      <hotspotChoice identifier="HS1" shape="rect" coords="10,10,20,20"/>
      <hotspotChoice identifier="HS2" shape="circle" coords="30,30,10"/>
    </hotspotInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

const QTI21_GAPMATCH = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item5" title="Gap Match" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="directedPair">
    <correctResponse>
      <value>CHOICE1 GAP1</value>
      <value>CHOICE2 GAP2</value>
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <gapMatchInteraction responseIdentifier="RESPONSE" shuffle="true">
      <p>The first President was <gap identifier="GAP1"/>.</p>
      <p>The third President was <gap identifier="GAP2"/>.</p>
      <gapText identifier="CHOICE1">George Washington</gapText>
      <gapText identifier="CHOICE2">Thomas Jefferson</gapText>
    </gapMatchInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

const QTI21_ASSOCIATE = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item6" title="Associate" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="pair">
    <correctResponse>
      <value>A B</value>
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>Connect each president to the matching description.</p>
    <associateInteraction responseIdentifier="RESPONSE" shuffle="false">
      <simpleAssociableChoice identifier="A" matchMax="1">George Washington</simpleAssociableChoice>
      <simpleAssociableChoice identifier="B" matchMax="1">First President</simpleAssociableChoice>
      <simpleAssociableChoice identifier="C" matchMax="1">John Adams</simpleAssociableChoice>
      <simpleAssociableChoice identifier="D" matchMax="1">Second President</simpleAssociableChoice>
    </associateInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

const QTI21_GRAPHIC_GAP = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item7" title="Graphic Gap Match" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="directedPair">
    <correctResponse>
      <value>CHOICE1 T1</value>
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>Label the marked location.</p>
    <graphicGapMatchInteraction responseIdentifier="RESPONSE">
      <prompt>Place the label.</prompt>
      <object data="map.png" type="image/png" alt="Map"/>
      <gapText identifier="CHOICE1">Washington</gapText>
      <associableHotspot identifier="T1" shape="rect" coords="10,10,20,20" matchMax="1"/>
    </graphicGapMatchInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

const QTI21_GRAPHIC_ASSOCIATE = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item8" title="Graphic Associate" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="pair">
    <correctResponse>
      <value>A B</value>
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>Connect the locations.</p>
    <graphicAssociateInteraction responseIdentifier="RESPONSE">
      <prompt>Draw lines between points.</prompt>
      <object data="map.png" type="image/png" alt="Map"/>
      <associableHotspot identifier="A" shape="circle" coords="10,10,5" matchMax="1"/>
      <associableHotspot identifier="B" shape="circle" coords="30,30,5" matchMax="1"/>
    </graphicAssociateInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

const QTI21_GRAPHIC_ORDER = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item9" title="Graphic Order" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="ordered" baseType="identifier">
    <correctResponse>
      <value>H1</value>
      <value>H2</value>
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>Order the points.</p>
    <graphicOrderInteraction responseIdentifier="RESPONSE" maxChoices="2">
      <prompt>Order the highlighted locations.</prompt>
      <object data="map.png" type="image/png" alt="Map"/>
      <hotspotChoice identifier="H1" shape="rect" coords="10,10,20,20" hotspotLabel="First"/>
      <hotspotChoice identifier="H2" shape="rect" coords="30,30,40,40" hotspotLabel="Second"/>
    </graphicOrderInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

const QTI21_SLIDER = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item10" title="Slider" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="integer"><correctResponse><value>40</value></correctResponse></responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>Set the value to forty.</p>
    <sliderInteraction responseIdentifier="RESPONSE" lowerBound="0" upperBound="100" step="10"/>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

testCase('QTI 2.1 import: simple choice item maps to single select', async () => {
  const result = await qti21Adapter.parse({
    filename: 'choice.xml',
    bytes: new TextEncoder().encode(QTI21_CHOICE),
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  const item = result.items[0];
  expect(item.xml).toContain('<qti-choice-interaction');
  const draft = item.draft as unknown as {
    type?: string;
    correctId?: string;
    choices?: Array<{ id: string }>;
  };
  expect(draft.type).toStrictEqual('single_select');
  expect(draft.correctId).toStrictEqual('B');
  expect(draft.choices?.length).toStrictEqual(2);
});

testCase('QTI 2.1 import: slider maps to slider', async () => {
  const result = await qti21Adapter.parse({
    filename: 'unsupported.xml',
    bytes: new TextEncoder().encode(QTI21_SLIDER),
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(1);
  expect(result.items[0].draft.type).toStrictEqual('slider');
  expect(result.warnings?.some((warning) => warning.code === 'UNSUPPORTED_ITEM_STUBBED') ?? false)
    .toStrictEqual(false);
});

testCase('QTI 2.1 import: inline choice item maps to inline_choice', async () => {
  const result = await qti21Adapter.parse({
    filename: 'inline.xml',
    bytes: new TextEncoder().encode(QTI21_INLINE),
    mime: 'application/xml',
  });

  const draft = result.items[0].draft as unknown as {
    type?: string;
    inlineChoices?: Array<{ id: string }>;
  };
  expect(draft.type).toStrictEqual('inline_choice');
  expect(draft.inlineChoices?.length).toStrictEqual(1);
});

testCase('QTI 2.1 import: hottext item maps to hottext', async () => {
  const result = await qti21Adapter.parse({
    filename: 'hottext.xml',
    bytes: new TextEncoder().encode(QTI21_HOTTEXT),
    mime: 'application/xml',
  });

  const draft = result.items[0].draft as unknown as {
    type?: string;
    hottexts?: Array<{ id: string }>;
  };
  expect(draft.type).toStrictEqual('hottext');
  expect(draft.hottexts?.length).toStrictEqual(2);
});

testCase('QTI 2.1 import: hotspot item maps to hotspot', async () => {
  const result = await qti21Adapter.parse({
    filename: 'hotspot.xml',
    bytes: new TextEncoder().encode(QTI21_HOTSPOT),
    mime: 'application/xml',
  });

  const draft = result.items[0].draft as unknown as {
    type?: string;
    choices?: Array<{ id: string }>;
  };
  expect(draft.type).toStrictEqual('hotspot');
  expect(draft.choices?.length).toStrictEqual(2);
});

testCase('QTI 2.1 import: gap match maps to gap_match', async () => {
  const result = await qti21Adapter.parse({
    filename: 'gapmatch.xml',
    bytes: new TextEncoder().encode(QTI21_GAPMATCH),
    mime: 'application/xml',
  });

  const draft = result.items[0].draft as unknown as {
    type?: string;
    gapChoices?: Array<{ id: string }>;
    gaps?: Array<{ id: string }>;
  };
  expect(draft.type).toStrictEqual('gap_match');
  expect(draft.gapChoices?.length).toStrictEqual(2);
  expect(draft.gaps?.length).toStrictEqual(2);
});

testCase('QTI 2.1 import: associate maps to associate', async () => {
  const result = await qti21Adapter.parse({
    filename: 'associate.xml',
    bytes: new TextEncoder().encode(QTI21_ASSOCIATE),
    mime: 'application/xml',
  });

  const draft = result.items[0].draft as unknown as {
    type?: string;
    choices?: Array<{ id: string }>;
    correctPairs?: Array<{ sourceId: string }>;
  };
  expect(draft.type).toStrictEqual('associate');
  expect(draft.choices?.length).toStrictEqual(4);
  expect(draft.correctPairs?.length).toStrictEqual(1);
});

testCase('QTI 2.1 import: graphic gap match maps to graphic_gap_match', async () => {
  const result = await qti21Adapter.parse({
    filename: 'graphic-gap.xml',
    bytes: new TextEncoder().encode(QTI21_GRAPHIC_GAP),
    mime: 'application/xml',
  });

  const draft = result.items[0].draft as unknown as {
    type?: string;
    choices?: Array<{ id: string }>;
    targets?: Array<{ id: string }>;
    correctPairs?: Array<{ choiceId: string }>;
    graphicBackgroundSrc?: string;
  };
  expect(draft.type).toStrictEqual('graphic_gap_match');
  expect(draft.graphicBackgroundSrc).toStrictEqual('map.png');
  expect(draft.choices?.length).toStrictEqual(1);
  expect(draft.targets?.length).toStrictEqual(1);
  expect(draft.correctPairs?.length).toStrictEqual(1);
});

testCase('QTI 2.1 import: graphic associate maps to graphic_associate', async () => {
  const result = await qti21Adapter.parse({
    filename: 'graphic-associate.xml',
    bytes: new TextEncoder().encode(QTI21_GRAPHIC_ASSOCIATE),
    mime: 'application/xml',
  });

  const draft = result.items[0].draft as unknown as {
    type?: string;
    graphicAssociateHotspots?: Array<{ id: string }>;
    graphicAssociateCorrectPairs?: Array<{ sourceId: string }>;
    graphicAssociateBackgroundSrc?: string;
  };
  expect(draft.type).toStrictEqual('graphic_associate');
  expect(draft.graphicAssociateBackgroundSrc).toStrictEqual('map.png');
  expect(draft.graphicAssociateHotspots?.length).toStrictEqual(2);
  expect(draft.graphicAssociateCorrectPairs?.length).toStrictEqual(1);
});

testCase('QTI 2.1 import: graphic order maps to graphic_order', async () => {
  const result = await qti21Adapter.parse({
    filename: 'graphic-order.xml',
    bytes: new TextEncoder().encode(QTI21_GRAPHIC_ORDER),
    mime: 'application/xml',
  });

  const draft = result.items[0].draft as unknown as {
    type?: string;
    graphicOrderHotspots?: Array<{ id: string }>;
    graphicOrderBackgroundSrc?: string;
    graphicOrderCorrectOrder?: string[];
  };
  expect(draft.type).toStrictEqual('graphic_order');
  expect(draft.graphicOrderBackgroundSrc).toStrictEqual('map.png');
  expect(draft.graphicOrderHotspots?.length).toStrictEqual(2);
  expect(draft.graphicOrderCorrectOrder?.length).toStrictEqual(2);
});

testCase('QTI 2.1 import: package fixtures for inline, hottext, hotspot, graphic', async () => {
  const base = new URL('fixtures/import/qti21/', import.meta.url).pathname;
  const packages = [
    { dir: 'inline_choice_package', expectAssets: 0 },
    { dir: 'hottext_package', expectAssets: 0 },
    { dir: 'hotspot_package', expectAssets: 1 },
    { dir: 'graphic_gap_match_package', expectAssets: 1 },
    { dir: 'graphic_associate_package', expectAssets: 1 },
    { dir: 'graphic_order_package', expectAssets: 1 },
  ];

  for (const pkg of packages) {
    const dir = join(base, pkg.dir);
    const entries: ZipEntry[] = [];
    for (const name of ['imsmanifest.xml', 'assessmentTest.xml', 'item1.xml', 'map.png']) {
      try {
        const data = await _fs.readFile(join(dir, name));
        entries.push({ name, data });
      } catch (_err) {
        // ignore missing optional files (e.g., map.png for non-hotspot packages)
      }
    }
    const zip = await writeZip(entries);
    const result = await qti21Adapter.parse({
      filename: `${pkg.dir}.zip`,
      bytes: zip,
      mime: 'application/zip',
    });
    expect(result.items.length).toStrictEqual(1);
    expect(result.assets.length).toStrictEqual(pkg.expectAssets);
  }
});

testCase('QTI 2.x import: nested-manifest package is rejected clearly', async () => {
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <resources>
    <resource identifier="item-1" type="imsqti_item_xmlv2p0" href="./item1.xml"/>
  </resources>
</manifest>`;

  const item = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item1" title="QTI 2.0 Choice" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p0">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>B</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
      <simpleChoice identifier="A">A</simpleChoice>
      <simpleChoice identifier="B">B</simpleChoice>
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

  const zip = await writeZip([
    { name: 'moodle_export/imsmanifest.xml', data: new TextEncoder().encode(manifest) },
    { name: 'moodle_export/item1.xml', data: new TextEncoder().encode(item) },
  ]);

  await expect(
    Promise.resolve().then(() =>
      detectImportAdapter({
        filename: 'moodle_qti20.zip',
        bytes: zip,
        mime: 'application/zip',
      })
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof Error && caught.message.includes('qti21: package-manifest-missing')
  );
});

testCase('QTI 2.1 import: BOM-prefixed manifest and item in zip import successfully', async () => {
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <resources>
    <resource identifier="item-1" type="imsqti_item_xmlv2p1" href="./item1.xml"/>
  </resources>
</manifest>`;

  const item = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item1" title="QTI 2.1 Choice" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>B</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
      <simpleChoice identifier="A">A</simpleChoice>
      <simpleChoice identifier="B">B</simpleChoice>
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

  const zip = await writeZip([
    { name: 'imsmanifest.xml', data: new TextEncoder().encode(`\uFEFF${manifest}`) },
    { name: 'item1.xml', data: new TextEncoder().encode(`\uFEFF${item}`) },
  ]);

  const result = await qti21Adapter.parse({
    filename: 'qti20_bom.zip',
    bytes: zip,
    mime: 'application/zip',
  });

  expect(result.items.length).toStrictEqual(1);
  expect(result.parts.length).toStrictEqual(1);
  expect(result.items[0].draft.type).toStrictEqual('single_select');
});

testCase('QTI 2.x import: nested manifest href mismatch is rejected clearly', async () => {
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <resources>
    <resource
      identifier="category91-question6198"
      type="imsqti_item_xmlv2p0"
      href="./category91-question6198.xml"/>
  </resources>
</manifest>`;

  const item = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="item1" title="QTI 2.0 Choice" xmlns="http://www.imsglobal.org/xsd/imsqti_v2p0">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>B</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
      <simpleChoice identifier="A">A</simpleChoice>
      <simpleChoice identifier="B">B</simpleChoice>
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

  const zip = await writeZip([
    { name: 'moodle_export/imsmanifest.xml', data: new TextEncoder().encode(manifest) },
    { name: 'moodle_export/question6198.xml', data: new TextEncoder().encode(item) },
  ]);

  await expect(
    Promise.resolve().then(() =>
      detectImportAdapter({
        filename: 'moodle_qti20_href_mismatch.zip',
        bytes: zip,
        mime: 'application/zip',
      })
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof Error && caught.message.includes('qti21: package-manifest-missing')
  );
});

testCase('QTI 2.x import: rejects malformed XML before identifier repairs', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem identifier="question6207" title="Malformed HTML Choice" xmlns="http://www.imsglobal.org/xsd/imsqti_item_v2p0">
  <responseDeclaration identifier="question6207multichoice" cardinality="single" baseType="identifier">
    <correctResponse><value>26073</value></correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <itemBody>
    <p>
      Prompt text
      <a href="http://example.test">
        <IMG SRC="http://example.test/img.gif" BORDER=0 ALIGN="absmiddle">
      </a>
    </p>
    <choiceInteraction responseIdentifier="question6207multichoice" maxChoices="1">
      <simpleChoice identifier="26070">Choice A</simpleChoice>
      <simpleChoice identifier="26073">Choice B</simpleChoice>
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;

  // qti3 0.10.5 uses a fail-closed XML parser; safe repairs do not authorize
  // guessing structure or correct answers from mismatched HTML/XML tags.
  await expect(
    Promise.resolve().then(() =>
      qti21Adapter.parse({
        filename: 'malformed_qti20_item.xml',
        bytes: new TextEncoder().encode(xml),
        mime: 'application/xml',
      })
    ),
  ).rejects.toSatisfy((caught: unknown) =>
    caught instanceof Error && caught.message.includes('Failed to parse XML')
  );
});

// These answers are authored independently of the importer and writer. Both artifacts
// must execute the same grading contract, including unanswered and partial responses.
testCase(
  'QTI 2.1 import and QFlow re-export preserve executable grading across interactions',
  async () => {
    const cases: ReadonlyArray<{ xml: string; correct: QtiValue; wrong: QtiValue }> = [
      { xml: QTI21_CHOICE, correct: 'B', wrong: 'A' },
      { xml: QTI21_INLINE, correct: 'B', wrong: 'A' },
      { xml: QTI21_HOTTEXT, correct: ['H1'], wrong: ['H2'] },
      { xml: QTI21_HOTSPOT, correct: 'HS1', wrong: 'HS2' },
      { xml: QTI21_GAPMATCH, correct: ['CHOICE1 GAP1', 'CHOICE2 GAP2'], wrong: ['CHOICE1 GAP1'] },
      { xml: QTI21_ASSOCIATE, correct: ['A B'], wrong: ['A C'] },
      { xml: QTI21_GRAPHIC_GAP, correct: ['CHOICE1 T1'], wrong: [] },
      { xml: QTI21_GRAPHIC_ASSOCIATE, correct: ['A B'], wrong: [] },
      { xml: QTI21_GRAPHIC_ORDER, correct: ['H1', 'H2'], wrong: ['H2', 'H1'] },
      { xml: QTI21_SLIDER, correct: 40, wrong: 50 },
    ];
    for (const example of cases) {
      const imported = await qti21Adapter.parse({
        filename: 'graded.xml',
        mime: 'application/xml',
        bytes: new TextEncoder().encode(example.xml),
      });
      const item = imported.items[0];
      if (!(item.draft.type)) expect.unreachable('Expected item.draft.type');
      const prepared = prepareDriverDraft(item.draft);
      if (!(prepared.ok)) expect.unreachable(`${item.title}: ${JSON.stringify(prepared)}`);
      const built = buildItemXmlFromPreparedDraft(prepared.prepared, {
        identifier: item.identifier,
      });
      if (!(built.ok)) expect.unreachable(`${item.title}: ${JSON.stringify(built)}`);
      const exported = built.xml;
      for (const xml of [item.xml, exported]) {
        const parsed = parseQtiXml(xml);
        if (!(parsed.ok && parsed.document)) {
          expect.unreachable(`${item.title}: ${JSON.stringify(parsed.diagnostics)}`);
        }
        const responseId = parsed.document.item.responseDeclarations[0].identifier;
        for (
          const [answer, expected] of [[example.correct, 1], [example.wrong, 0], [null, 0]] as const
        ) {
          const session = createItemSession(parsed.document);
          session.beginAttempt();
          session.respond(responseId, answer);
          const scored = session.score();
          expect(scored.outcomes.SCORE, `${item.title}: ${JSON.stringify(answer)}`).toStrictEqual(
            expected,
          );
        }
      }
    }
  },
);
