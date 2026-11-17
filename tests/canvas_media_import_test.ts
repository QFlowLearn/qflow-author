import { discoverQtiPackageContentAssets } from '@longsightgroup/qti3-core';
import { writeQti3PackageFilesResult } from '@longsightgroup/qti3-writer';
import { parseQtiPackageEntries } from '../lib/import/adapters/qti3/parse_package.ts';
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import { collectImportedAssetReferenceKeys } from '../lib/import/imported_asset_references.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { prepareQuestionXmlDownload } from '../lib/export/question_xml_download.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';

const path = 'web_resources/map image.png';
const mediaResource =
  `<resource identifier="MEDIA" type="webcontent" href="${path}"><file href="${path}"/></resource>`;
const png = new Uint8Array(
  await readFile(new URL('./fixtures/import/qti21/hotspot_package/map.png', import.meta.url)),
);
function withImage(reference: string): string {
  return canvasChoiceXml().replace(
    'Which city is in France?',
    `<![CDATA[<p>Which city is in France?</p><img src="${reference}" alt="Map"/>]]>`,
  );
}

test('Canvas media in separate webcontent resources survives native quiz import, preview and export', async () => {
  for (
    const reference of [
      '$IMS-CC-FILEBASE$/map%20image.png',
      '%24IMS-CC-FILEBASE%24/map%20image.png',
      '$IMS-CC-FILEBASE$/map%20image.png?download=1#map',
      '../web_resources/map%20image.png',
    ]
  ) {
    const source = {
      filename: 'media.imscc',
      bytes: await canvasCartridge({
        ccXml: '<questestinterop/>',
        nativeXml: withImage(reference),
        extraResources: mediaResource,
        extraFiles: [
          { name: path, data: png },
          { name: 'web_resources/unreferenced.png', data: png },
        ],
      }),
    };
    const imported = await imsccAdapter.parse(source);
    expect(imported.items).toHaveLength(1);
    expect(imported.assets).toHaveLength(1);
    expect(imported.assets[0].path).toBe(path);
    expect(imported.assets[0].data).toEqual(png);
    const item = imported.items[0];
    expect(item.draft.bodyHtml).not.toContain('IMS-CC-FILEBASE');
    expect([...collectImportedAssetReferenceKeys(item.draft, item.href)]).toContain(path);
    expect(
      buildMigrationAnalysis(
        imported,
        { adapter: imsccAdapter, sniff: await imsccAdapter.sniff(source) },
        { _tag: 'Assessment' },
      ).items[0].readiness,
    ).not.toBe('blocked');
    const preview = buildQtiPreviewXml(item.draft);
    const exported = prepareQuestionXmlDownload(item.draft, item.identifier);
    if (!preview.ok) expect.unreachable('Expected usable question preview');
    expect(preview.xml).toContain('map%20image.png');
    expect(exported).toMatchObject({ ok: true });
    if (!exported.ok) throw new Error('Expected question export');
    expect(exported.xml).toContain('map%20image.png');
    const packaged = writeQti3PackageFilesResult({
      identifier: 'CANVAS_MEDIA',
      title: 'Canvas media',
      items: [{
        kind: 'xml',
        path: item.href,
        identifier: item.identifier,
        xml: exported.xml,
        assets: imported.assets.map((asset) => ({ path: asset.path, data: asset.data })),
      }],
    });
    if (!packaged.ok) expect.unreachable('Expected usable question package');
    const reopened = await parseQtiPackageEntries(packaged.files);
    expect(reopened.assets[0].data).toEqual(png);
    expect(reopened.items[0].draft.bodyHtml).toContain('map%20image.png');
    if (reference.includes('?download')) expect(item.draft.bodyHtml).toContain('?download=1#map');
  }
});

test('Canvas matimage URI references use the same manifest media resolution', async () => {
  const nativeXml = canvasChoiceXml().replace(
    '</presentation>',
    '<material><matimage uri="$IMS-CC-FILEBASE$/map%20image.png"/></material></presentation>',
  );
  const imported = await imsccAdapter.parse({
    filename: 'image.imscc',
    bytes: await canvasCartridge({
      ccXml: '<questestinterop/>',
      nativeXml,
      extraResources: mediaResource,
      extraFiles: [{ name: path, data: png }],
    }),
  });
  expect(imported.assets.map((asset) => asset.path)).toContain(path);
  expect(imported.items[0].draft.bodyHtml).not.toContain('IMS-CC-FILEBASE');
});

test('missing, undeclared and escaping Canvas media are never silently dropped or reinterpreted', async () => {
  for (
    const reference of [
      '$IMS-CC-FILEBASE$/missing.png',
      '$IMS-CC-FILEBASE$/../web_resources/map%20image.png',
      '$IMS-CC-FILEBASE$/%2e%2e/web_resources/map%20image.png',
      '$IMS-CC-FILEBASE$/map%ZZ.png',
    ]
  ) {
    const bytes = await canvasCartridge({
      ccXml: canvasChoiceXml('9'),
      nativeXml: withImage(reference),
      extraResources: mediaResource,
      extraFiles: [{ name: path, data: png }],
    });
    await expect(imsccAdapter.parse({ filename: 'broken.imscc', bytes })).rejects.toThrow(
      'No assessment items',
    );
  }
  const bytes = await canvasCartridge({
    ccXml: '<questestinterop/>',
    nativeXml: withImage('$IMS-CC-FILEBASE$/map%20image.png'),
    extraResources: mediaResource,
  });
  await expect(imsccAdapter.parse({ filename: 'missing.imscc', bytes })).rejects.toThrow(
    'No assessment items',
  );
});

test('package media URL decoding validates encoded paths before resolving them', () => {
  const sourcePath = 'items/question.xml';
  for (
    const reference of [
      '%2Fprivate.png',
      '..%2F..%2Fprivate.png',
      '%68ttps%3A%2F%2Fexample.org%2Fprivate.png',
      'bad%ZZ.png',
      'bad%00.png',
      '..%5Cprivate.png',
    ]
  ) {
    const result = discoverQtiPackageContentAssets(
      `<qti-assessment-item><img src="${reference}"/></qti-assessment-item>`,
      sourcePath,
    );
    expect(result.hrefs).toHaveLength(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  }
  expect(
    discoverQtiPackageContentAssets(
      '<qti-assessment-item><img src="../web_resources/map%20image.png?download=1#map"/></qti-assessment-item>',
      sourcePath,
    ).hrefs,
  ).toEqual([path]);
});

test('encoded filename punctuation is retained as filename data rather than URL routing', () => {
  const result = discoverQtiPackageContentAssets(
    '<qti-assessment-item><img src="../web_resources/map%23image%3F.png?download=1#map"/></qti-assessment-item>',
    'items/question.xml',
  );
  expect(result.hrefs).toEqual(['web_resources/map#image?.png']);
  expect(result.diagnostics).toHaveLength(0);
});

test('media failures remain visible while independent usable quiz resources import', async () => {
  const bytes = await canvasCartridge({
    ccXml: '<questestinterop/>',
    nativeXml: withImage('$IMS-CC-FILEBASE$/map%20image.png'),
    extraResources:
      `${mediaResource}<resource identifier="SECOND" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="SECOND.xml"/></resource>`,
    extraFiles: [{ name: 'SECOND.xml', data: new TextEncoder().encode(canvasChoiceXml('2')) }],
  });
  const source = { filename: 'partial.imscc', bytes };
  const imported = await imsccAdapter.parse(source);
  expect(imported.items).toHaveLength(1);
  expect(imported.items[0].draft.maximumScore).toBe(2);
  const analysis = buildMigrationAnalysis(
    imported,
    { adapter: imsccAdapter, sniff: await imsccAdapter.sniff(source) },
    { _tag: 'Assessment' },
  );
  expect(
    analysis.items[0].warnings.some((warning) =>
      warning.message.includes('media file') && warning.message.includes('missing')
    ),
  ).toBe(true);
});

test('ambiguous Canvas file-base names require source correction', async () => {
  const bytes = await canvasCartridge({
    ccXml: '<questestinterop/>',
    nativeXml: withImage('$IMS-CC-FILEBASE$/map%20image.png'),
    extraResources:
      `${mediaResource}<resource identifier="OTHER_MEDIA" type="webcontent" href="map image.png"><file href="map image.png"/></resource>`,
    extraFiles: [{ name: path, data: png }, { name: 'map image.png', data: png }],
  });
  await expect(imsccAdapter.parse({ filename: 'ambiguous.imscc', bytes })).rejects.toThrow(
    'No assessment items',
  );
});

test('a Canvas folder named web_resources resolves inside the file-base namespace', async () => {
  const nestedPath = 'web_resources/web_resources/map image.png';
  const nativeXml = withImage('$IMS-CC-FILEBASE$/web_resources/map%20image.png').replace(
    '</p>',
    '<img src="$IMS-CC-FILEBASE$/map%20image.png" alt="Root map"/></p>',
  );
  const imported = await imsccAdapter.parse({
    filename: 'nested.imscc',
    bytes: await canvasCartridge({
      ccXml: '<questestinterop/>',
      nativeXml,
      extraResources:
        `${mediaResource}<resource identifier="NESTED" type="webcontent" href="${nestedPath}"><file href="${nestedPath}"/></resource>`,
      extraFiles: [{ name: path, data: png }, { name: nestedPath, data: png }],
    }),
  });
  expect(imported.items[0].draft.bodyHtml).toContain(
    '../web_resources/web_resources/map%20image.png',
  );
  expect(imported.items[0].draft.bodyHtml).toContain('../web_resources/map%20image.png');
  expect(imported.assets.map((asset) => asset.path).sort()).toEqual([path, nestedPath].sort());
});
