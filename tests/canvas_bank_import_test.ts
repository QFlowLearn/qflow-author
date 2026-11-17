import { expect, test } from 'vitest';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import { writeZip } from '../lib/zip.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';

const bankPath = 'non_cc_assessments/BANK.xml.qti';
const bankResource =
  `<resource identifier="BANK" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${bankPath}"><file href="${bankPath}"/></resource>`;
const bankXml = canvasChoiceXml('4').replace(
  /<assessment[^>]*><section[^>]*>/,
  '<objectbank ident="BANK"><qtimetadata><qtimetadatafield><fieldlabel>bank_title</fieldlabel><fieldentry>Practice bank</fieldentry></qtimetadatafield></qtimetadata>',
).replace('</section></assessment>', '</objectbank>').replaceAll('CHOICE', 'BANK_CHOICE');
const encode = (value: string) => new TextEncoder().encode(value);

test('Canvas standalone banks import alongside quizzes without duplicating native dependencies', async () => {
  const bytes = await canvasCartridge({
    ccXml: '<questestinterop/>',
    nativeXml: canvasChoiceXml('3'),
    extraResources: bankResource,
    extraFiles: [{ name: bankPath, data: encode(bankXml) }],
  });
  const source = { filename: 'canvas.imscc', bytes };
  const imported = await imsccAdapter.parse(source);
  expect(imported.items).toHaveLength(2);
  expect(imported.items.map((item) => item.identifier)).toEqual(['CHOICE', 'BANK_CHOICE']);
  expect(imported.items.map((item) => item.draft.maximumScore)).toEqual([3, 4]);
  expect(imported.organizationGroups.map((group) => group.title)).toContain('Practice bank');
  expect(
    buildMigrationAnalysis(
      imported,
      { adapter: imsccAdapter, sniff: await imsccAdapter.sniff(source) },
      { _tag: 'Assessment' },
    ).items.every((item) => item.readiness !== 'blocked'),
  ).toBe(true);
});

test('a cartridge containing only an explicitly declared Canvas bank is supported', async () => {
  const bytes = await writeZip([
    {
      name: 'imsmanifest.xml',
      data: encode(
        `<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"><resources>${bankResource}</resources></manifest>`,
      ),
    },
    { name: bankPath, data: encode(bankXml) },
  ]);
  const imported = await imsccAdapter.parse({ filename: 'banks.imscc', bytes });
  expect(imported.items).toHaveLength(1);
  expect(imported.items[0].draft).toMatchObject({
    type: 'single_select',
    maximumScore: 4,
    correctId: 'A',
  });
});

test('missing or invalid declared banks are disclosed while usable quiz questions survive', async () => {
  for (const data of [undefined, encode('<questestinterop><assessment/></questestinterop>')]) {
    const bytes = await canvasCartridge({
      ccXml: '<questestinterop/>',
      nativeXml: canvasChoiceXml(),
      extraResources: bankResource,
      extraFiles: data ? [{ name: bankPath, data }] : [],
    });
    const source = { filename: 'broken-bank.imscc', bytes };
    const imported = await imsccAdapter.parse(source);
    expect(imported.items).toHaveLength(1);
    expect(
      imported.warnings?.some((warning) =>
        warning.code === 'IMSCC_RESOURCE_UNSUPPORTED' && warning.message.includes('BANK')
      ),
    ).toBe(true);
    const analysis = buildMigrationAnalysis(
      imported,
      { adapter: imsccAdapter, sniff: await imsccAdapter.sniff(source) },
      { _tag: 'Assessment' },
    );
    expect(
      analysis.items[0].warnings.some((warning) => warning.code === 'IMSCC_RESOURCE_UNSUPPORTED'),
    ).toBe(true);
  }
});
