import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';
import { importedQuestionPlacements } from '../lib/import/types.ts';

import { blackboardAdapter } from '../lib/import/adapters/blackboard.ts';
import { writeZip } from '../lib/zip.ts';
import { blackboardOrganizationPackage } from './helpers/blackboard_organization_package.ts';
import { parseImportedOrganizationGroups } from '../lib/import/organization_groups.ts';

const MANIFEST = new URL('fixtures/import/blackboard/imsmanifest.xml', import.meta.url).pathname;
const POOL = new URL('fixtures/import/blackboard/res00001.dat', import.meta.url).pathname;

testCase('Blackboard import: parses legacy POOL .dat export', async () => {
  const bytes = await _fs.readFile(POOL);
  const result = await blackboardAdapter.parse({
    filename: 'res00001.dat',
    bytes,
    mime: 'application/xml',
  });

  expect(result.items.length).toStrictEqual(6);
  expect(result.organizationGroups).toStrictEqual([{
    id: 'blackboard-pool-1',
    title: 'test quiz',
    hrefs: result.items.map((item) => item.href),
  }]);
  const types = result.items.map((item) => item.draft.type);
  expect(types.filter((type) => type === 'multi_select').length).toStrictEqual(1);
  expect(types.filter((type) => type === 'single_select').length).toStrictEqual(2);
  expect(types.filter((type) => type === 'extended_text').length).toStrictEqual(1);
  expect(types.filter((type) => type === 'text_entry').length).toStrictEqual(1);
  expect(types.filter((type) => type === 'match').length).toStrictEqual(1);

  const first = result.items[0].draft as {
    type?: string;
    correctIds?: string[];
    choices?: Array<{ id: string }>;
  };
  expect(first.type).toStrictEqual('multi_select');
  expect(first.correctIds?.length).toStrictEqual(4);
  expect(first.choices?.length).toStrictEqual(6);

  const match = result.items.find((item) => item.draft.type === 'match')?.draft as {
    correctPairs?: Array<{ sourceId: string; targetId: string }>;
  };
  expect(match.correctPairs?.length).toStrictEqual(4);
});

testCase('Blackboard import: parses Blackboard zip package via manifest resource', async () => {
  const [manifest, pool] = await Promise.all([_fs.readFile(MANIFEST), _fs.readFile(POOL)]);

  const bytes = await writeZip([
    { name: 'imsmanifest.xml', data: manifest },
    { name: 'res00001/res00001.dat', data: pool },
  ]);

  const result = await blackboardAdapter.parse({
    filename: 'blackboard-export.zip',
    bytes,
    mime: 'application/zip',
  });

  expect(result.items.length).toStrictEqual(6);
  expect(result.parts.length).toStrictEqual(1);
  expect(result.parts[0].placements.length).toStrictEqual(6);
  expect(result.assets.length).toStrictEqual(0);
  expect(result.organizationGroups[0].title).toStrictEqual('test quiz');
});

testCase('Blackboard preserves separate named pools without changing delivery parts', async () => {
  for (const titles of [['Biology/Cells', 'Physics/Energy'], ['Same name', 'Same name']]) {
    const source = {
      filename: 'pools.zip',
      bytes: await blackboardOrganizationPackage(titles),
      mime: 'application/zip',
    };
    const result = await blackboardAdapter.parse(source);
    expect(result.items.length).toStrictEqual(2);
    expect(new Set(result.items.map((item) => item.href)).size).toStrictEqual(2);
    expect(result.parts.length).toStrictEqual(1);
    expect(result.parts[0].title).toStrictEqual('Part 1');
    expect(importedQuestionPlacements(result.parts[0].placements).map((p) => p.href)).toStrictEqual(
      result.items.map((item) => item.href),
    );
    expect(parseImportedOrganizationGroups(result.organizationGroups)).toStrictEqual(
      result.organizationGroups,
    );
    expect(result.organizationGroups).toStrictEqual(titles.map((title, i) => ({
      id: `blackboard-pool-${i + 1}`,
      title,
      hrefs: [result.items[i].href],
    })));
    expect((await blackboardAdapter.parse(source)).organizationGroups).toStrictEqual(
      result.organizationGroups,
    );
  }
});

testCase('Blackboard unnamed pools do not acquire invented categories', async () => {
  const result = await blackboardAdapter.parse({
    filename: 'Biology-Chapter-1.zip',
    bytes: await blackboardOrganizationPackage(['', '   ']),
    mime: 'application/zip',
  });
  expect(result.items.length).toStrictEqual(2);
  expect(result.organizationGroups).toStrictEqual([]);
});

testCase(
  'Blackboard import: supports questestinterop questions.dat without POOL root',
  async () => {
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns:bb="http://www.blackboard.com/content-packaging/" identifier="man00001">
  <resources>
    <resource
      bb:file="questions.dat"
      identifier="questions"
      type="assessment/x-bb-qti-pool"
      xml:base="questions" />
  </resources>
</manifest>`;

    const qti12Dat = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop>
  <assessment title="Legacy Blackboard DAT">
    <section>
      <item ident="Q1" title="Simple Choice">
        <presentation>
          <material><mattext>Pick one.</mattext></material>
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
    </section>
  </assessment>
</questestinterop>`;

    const bytes = await writeZip([
      { name: 'imsmanifest.xml', data: new TextEncoder().encode(manifest) },
      { name: 'questions.dat', data: new TextEncoder().encode(qti12Dat) },
    ]);

    const result = await blackboardAdapter.parse({
      filename: 'blackboard-questestinterop-dat.zip',
      bytes,
      mime: 'application/zip',
    });

    expect(result.items.length).toStrictEqual(1);
    expect(result.items[0].draft.type).toStrictEqual('single_select');
    expect(result.title).toStrictEqual('Simple Choice');
  },
);
