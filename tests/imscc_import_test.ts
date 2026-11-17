import { expect, test as testCase } from 'vitest';

import { importedQuestionPlacements } from '../lib/import/types.ts';

import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { writeZip } from '../lib/zip.ts';
import { blackboardOrganizationPackage } from './helpers/blackboard_organization_package.ts';
import { parseImportedOrganizationGroups } from '../lib/import/organization_groups.ts';

testCase(
  'IMSCC preserves source groups when resource item paths and group IDs collide',
  async () => {
    for (const titles of [['Biology/Cells', 'Physics/Energy'], ['Same name', 'Same name']]) {
      const source = {
        filename: 'course.imscc',
        bytes: await blackboardOrganizationPackage(titles, 'imscc'),
        mime: 'application/zip',
      };
      expect((await imsccAdapter.sniff(source)).supported).toStrictEqual(true);
      const result = await imsccAdapter.parse(source);
      expect(result.items.length).toStrictEqual(2);
      expect(new Set(result.items.map((i) => i.href)).size).toStrictEqual(2);
      expect(result.items[1].href).toStrictEqual(result.items[0].href.replace(/\.xml$/, '_2.xml'));
      expect(new Set(result.items.map((i) => i.identifier)).size).toStrictEqual(2);
      expect(result.parts.map((p) => p.title)).toStrictEqual(['Part 1', 'Part 1']);
      expect(
        result.parts.flatMap((p) => importedQuestionPlacements(p.placements).map((r) => r.href)),
      ).toStrictEqual(result.items.map((i) => i.href));
      expect(result.organizationGroups).toStrictEqual(titles.map((title, i) => ({
        id: `imscc-resource-${i + 1}-group-1`,
        title,
        hrefs: [result.items[i].href],
      })));
      expect(parseImportedOrganizationGroups(result.organizationGroups)).toStrictEqual(
        result.organizationGroups,
      );
      expect((await imsccAdapter.parse(source)).organizationGroups).toStrictEqual(
        result.organizationGroups,
      );
    }
  },
);

testCase(
  'IMSCC does not invent source groups from delivery parts when pools have no titles',
  async () => {
    const result = await imsccAdapter.parse({
      filename: 'Biology-chapters.imscc',
      bytes: await blackboardOrganizationPackage(['', '   '], 'imscc'),
      mime: 'application/zip',
    });
    expect(result.items.length).toStrictEqual(2);
    expect(result.parts.length).toStrictEqual(2);
    expect(result.organizationGroups).toStrictEqual([]);
  },
);

testCase('IMSCC import: parses manifest resources and imports multiple assessments', async () => {
  const qti12 = new TextEncoder().encode(multiItemQti12());

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" identifier="cc-1">
  <metadata>
    <schema>IMS Common Cartridge</schema>
    <schemaversion>1.3.0</schemaversion>
  </metadata>
  <resources>
    <resource identifier="quiz-1" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment" href="assessment/quiz1.xml">
      <file href="assessment/quiz1.xml" />
      <file href="web_resources/diagram.png" />
    </resource>
    <resource identifier="quiz-2" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment" href="assessment/quiz2.xml">
      <file href="assessment/quiz2.xml" />
    </resource>
  </resources>
</manifest>`;

  const bytes = await writeZip([
    { name: 'imsmanifest.xml', data: new TextEncoder().encode(manifestXml) },
    { name: 'assessment/quiz1.xml', data: qti12 },
    { name: 'assessment/quiz2.xml', data: qti12 },
    { name: 'web_resources/diagram.png', data: new Uint8Array([1, 2, 3]) },
  ]);

  const result = await imsccAdapter.parse({
    filename: 'course.imscc',
    bytes,
    mime: 'application/zip',
  });

  expect(result.items.length).toStrictEqual(4);
  expect(result.parts.length).toStrictEqual(2);
  expect(result.assets.length).toStrictEqual(1);
  expect(result.assets[0].path).toStrictEqual('web_resources/diagram.png');
  expect(result.items.every((item) => item.draft.type === 'single_select')).toStrictEqual(true);
});

testCase(
  'IMSCC import: migrates one multi-item QTI 1.2 resource with unique item hrefs',
  async () => {
    const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1" identifier="cc-1">
  <metadata>
    <schema>IMS Common Cartridge</schema>
    <schemaversion>1.3.0</schemaversion>
  </metadata>
  <resources>
    <resource identifier="quiz-1" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment" href="assessment/quiz.xml">
      <file href="assessment/quiz.xml" />
      <file href="assessment/map.png" />
    </resource>
  </resources>
</manifest>`;
    const bytes = await writeZip([
      { name: 'imsmanifest.xml', data: new TextEncoder().encode(manifestXml) },
      { name: 'assessment/quiz.xml', data: new TextEncoder().encode(multiItemQti12()) },
      { name: 'assessment/map.png', data: new Uint8Array([1, 2, 3]) },
    ]);

    const result = await imsccAdapter.parse({
      filename: 'course.imscc',
      bytes,
      mime: 'application/zip',
    });

    expect(result.items.length).toStrictEqual(2);
    expect(result.parts.length).toStrictEqual(1);
    expect(
      importedQuestionPlacements(result.parts[0].placements).map((placement) => placement.href),
    ).toStrictEqual([
      'assessment/quiz_first12.xml',
      'assessment/quiz_second12.xml',
    ]);
    expect(result.items.map((item) => item.href)).toStrictEqual([
      'assessment/quiz_first12.xml',
      'assessment/quiz_second12.xml',
    ]);
    expect(result.assets.map((asset) => asset.path)).toStrictEqual(['assessment/map.png']);
  },
);

function multiItemQti12(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop>
  <item ident="first12" title="First">
    <presentation>
      <material><mattext>Pick first.</mattext></material>
      <response_lid ident="RESPONSE" rcardinality="Single">
        <render_choice>
          <response_label ident="A"><material><mattext>A</mattext></material></response_label>
          <response_label ident="B"><material><mattext>B</mattext></material></response_label>
        </render_choice>
      </response_lid>
    </presentation>
    <resprocessing>
      <outcomes><decvar varname="SCORE" defaultval="0" /></outcomes>
      <respcondition continue="No"><conditionvar><varequal respident="RESPONSE">A</varequal></conditionvar><setvar action="Set" varname="SCORE">1</setvar></respcondition>
    </resprocessing>
  </item>
  <item ident="second12" title="Second">
    <presentation>
      <material><mattext>Pick second.</mattext></material>
      <response_lid ident="RESPONSE" rcardinality="Single">
        <render_choice>
          <response_label ident="A"><material><mattext>A</mattext></material></response_label>
          <response_label ident="B"><material><mattext>B</mattext></material></response_label>
        </render_choice>
      </response_lid>
    </presentation>
    <resprocessing>
      <outcomes><decvar varname="SCORE" defaultval="0" /></outcomes>
      <respcondition continue="No"><conditionvar><varequal respident="RESPONSE">B</varequal></conditionvar><setvar action="Set" varname="SCORE">1</setvar></respcondition>
    </resprocessing>
  </item>
</questestinterop>`;
}
