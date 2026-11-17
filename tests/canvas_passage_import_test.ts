import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
import { importedQuestionPlacements } from '../lib/import/types.ts';

function passage(id: string, text: string): string {
  return `<item ident="${id}" title="Reading"><itemmetadata><qtimetadata>
    <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>text_only_question</fieldentry></qtimetadatafield>
    <qtimetadatafield><fieldlabel>passage</fieldlabel><fieldentry>true</fieldentry></qtimetadatafield>
    <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>0</fieldentry></qtimetadatafield>
    </qtimetadata></itemmetadata><presentation><material><mattext texttype="text/html"><![CDATA[${text}]]></mattext></material></presentation></item>`;
}
const reading = '<p>Read <strong>this passage</strong> first.</p><p>Then answer the question.</p>';
test('Canvas text-only passages remain ordered unscored content and never become bank questions', async () => {
  const xml = canvasChoiceXml().replace(
    '<item ident="CHOICE"',
    `${passage('BEFORE', reading)}<item ident="CHOICE"`,
  ).replace('</item></section>', `</item>${passage('AFTER', '<p>End of section.</p>')}</section>`);
  const source = { filename: 'passage.xml', bytes: new TextEncoder().encode(xml) };
  const direct = await qti12Adapter.parse(source);
  const cartridge = await imsccAdapter.parse({
    filename: 'passage.imscc',
    bytes: await canvasCartridge({ ccXml: '<questestinterop/>', nativeXml: xml }),
  });
  for (const imported of [direct, cartridge]) {
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0].draft.type).toBe('single_select');
    expect(imported.parts[0].placements).toEqual([
      { content: { kind: 'text', text: 'Read this passage first.\nThen answer the question.' } },
      { href: imported.items[0].href },
      { content: { kind: 'text', text: 'End of section.' } },
    ]);
    expect(importedQuestionPlacements(imported.parts[0].placements)).toHaveLength(1);
    expect(imported.organizationGroups.flatMap((group) => group.hrefs)).toEqual([
      imported.items[0].href,
    ]);
    expectImportedScore(imported, { RESPONSE: 'A' }, 3);
    expect(imported.warnings?.some((w) => w.message.includes('Text formatting is simplified')))
      .toBe(true);
  }
  const analysis = await analyzeImport(qti12Adapter, direct, source);
  expect(analysis.items).toHaveLength(1);
  expect(analysis.parts[0]).toMatchObject({ placements: direct.parts[0].placements });
});
test('passage-only Canvas sources import content without synthesizing a response', async () => {
  const xml = `<questestinterop><assessment ident="READING"><section ident="S">${
    passage('READING', reading)
  }</section></assessment></questestinterop>`;
  for (
    const imported of [
      await qti12Adapter.parse({ filename: 'reading.xml', bytes: new TextEncoder().encode(xml) }),
      await imsccAdapter.parse({
        filename: 'reading.imscc',
        bytes: await canvasCartridge({ ccXml: '<questestinterop/>', nativeXml: xml }),
      }),
    ]
  ) {
    expect(imported.items).toHaveLength(0);
    expect(imported.parts[0].placements[0]).toMatchObject({ content: { kind: 'text' } });
    expect(imported.organizationGroups).toHaveLength(0);
  }
});
test('a passage label cannot conceal actual responses or scoring', async () => {
  const source = {
    filename: 'invalid.xml',
    bytes: new TextEncoder().encode(
      canvasChoiceXml().replace('multiple_choice_question', 'text_only_question').replace(
        '<fieldentry>3</fieldentry>',
        '<fieldentry>0</fieldentry>',
      ).replace(
        '</qtimetadata>',
        '<qtimetadatafield><fieldlabel>passage</fieldlabel><fieldentry>true</fieldentry></qtimetadatafield></qtimetadata>',
      ),
    ),
  };
  const imported = await qti12Adapter.parse(source);
  expect((await analyzeImport(qti12Adapter, imported, source)).items[0].readiness).toBe('blocked');
});

test('Canvas passage images keep their reading position and packaged bytes', async () => {
  const png = new Uint8Array(
    await readFile(new URL('./fixtures/import/qti21/hotspot_package/map.png', import.meta.url)),
  );
  const xml = `<questestinterop><assessment ident="QUIZ"><section ident="S">${
    passage(
      'MAP',
      '<p>Before the map.</p><p><img src="$IMS-CC-FILEBASE$/map.png" alt="Map of Europe"></p><p>After the map.</p>',
    )
  }</section></assessment></questestinterop>`;
  const imported = await imsccAdapter.parse({
    filename: 'reading.imscc',
    bytes: await canvasCartridge({
      ccXml: '<questestinterop/>',
      nativeXml: xml,
      extraResources:
        '<resource identifier="MEDIA" type="webcontent" href="web_resources/map.png"><file href="web_resources/map.png"/></resource>',
      extraFiles: [{ name: 'web_resources/map.png', data: png }],
    }),
  });
  expect(imported.items).toHaveLength(0);
  expect(imported.parts[0].placements).toEqual([
    { content: { kind: 'text', text: 'Before the map.' } },
    {
      content: {
        kind: 'image',
        src: 'web_resources/map.png',
        alt: 'Map of Europe',
        longDescription: '',
      },
    },
    { content: { kind: 'text', text: 'After the map.' } },
  ]);
  expect(imported.assets.find((asset) => asset.path === 'web_resources/map.png')?.data).toEqual(
    png,
  );
});
