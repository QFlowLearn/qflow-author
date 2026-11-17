import { expect, test as testCase } from 'vitest';

import { importedQuestionPlacements } from '../lib/import/types.ts';

import { detectImportAdapter } from '../lib/import/registry.ts';
import { writeZip } from '../lib/zip.ts';

const enc = new TextEncoder();

testCase('import detection routes QTI 2.2 package to qti21 adapter', async () => {
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <resources>
    <resource identifier="item-1" type="imsqti_item_xmlv2p2" href="items/item-1.xml">
      <file href="items/item-1.xml"/>
    </resource>
  </resources>
</manifest>`;

  const itemXml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p2"
  identifier="ITEM_1"
  title="QTI 2.2 Item"
  adaptive="false"
  timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse>
      <value>CHOICE_1</value>
    </correctResponse>
  </responseDeclaration>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
      <prompt>Select one.</prompt>
      <simpleChoice identifier="CHOICE_1">A</simpleChoice>
      <simpleChoice identifier="CHOICE_2">B</simpleChoice>
    </choiceInteraction>
  </itemBody>
</assessmentItem>`;

  const zipBytes = await writeZip([
    { name: 'imsmanifest.xml', data: enc.encode(manifestXml) },
    { name: 'items/item-1.xml', data: enc.encode(itemXml) },
  ]);

  const source = {
    filename: 'qti2p2-item.zip',
    bytes: zipBytes,
    mime: 'application/zip',
  };

  const detection = await detectImportAdapter(source);
  expect(detection.adapter.id).toStrictEqual('qti21');

  const result = await detection.adapter.parse(source, detection.sniff.hint);
  expect(result.items.length).toStrictEqual(1);
  expect(result.parts.length).toStrictEqual(1);
  expect(importedQuestionPlacements(result.parts[0].placements)[0].href).toStrictEqual(
    'items/item-1.xml',
  );
});
